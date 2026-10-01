// Importador del maestro de clientes de Mirol -> ficha del cliente.
//
//   npm run importar-clientes -- CLIENTES.xlsx
//
// El archivo que exporta Mirol trae 117 columnas y 3.471 clientes, de las
// cuales 38 tienen contenido real. El mapeo completo, con por que se usa cada
// una y por que las otras no, esta en docs/mirol-clientes.md.
//
// Mirol sigue siendo el maestro: este importador copia, no interpreta. La unica
// excepcion es `particularidades`, que el vendedor edita desde el WhatsApp y
// por eso no se pisa si ya tiene algo cargado.
//
// Mirol exporta .xls (formato viejo de Excel). Hay que guardarlo como .xlsx o
// .csv desde Excel: el lector del proyecto no abre el binario de Excel 97.
import fs from 'node:fs';
import { ejecutar, consultarUna, enTransaccion } from '../db/db.js';
import { normalizarTexto } from '../negocio/reglas.js';
import { aFecha, parsearCsv } from './normalizar.js';
import { leerHoja } from './xlsx.js';

// Codigos de jurisdiccion de AFIP, los mismos que usa Mirol en PciaCod.
export const PROVINCIAS = {
  A: 'Salta',
  B: 'Buenos Aires',
  C: 'CABA',
  D: 'San Luis',
  E: 'Entre Ríos',
  F: 'La Rioja',
  G: 'Santiago del Estero',
  H: 'Chaco',
  J: 'San Juan',
  K: 'Catamarca',
  L: 'La Pampa',
  M: 'Mendoza',
  N: 'Misiones',
  P: 'Formosa',
  Q: 'Neuquén',
  R: 'Río Negro',
  S: 'Santa Fe',
  T: 'Tucumán',
  U: 'Chubut',
  V: 'Tierra del Fuego',
  W: 'Corrientes',
  X: 'Córdoba',
  Y: 'Jujuy',
  Z: 'Santa Cruz',
};

// La actividad del cliente vive en TipCliCod. La tabla de codigos esta en
// Mirol y todavia no la tenemos: estos cinco se dedujeron de los nombres de
// los clientes de cada grupo y estan a confirmar con Comercial. Los otros 17
// codigos se guardan sin traducir en actividad_codigo, para no inventar.
export const TIPOS_CLIENTE = {
  60: 'Distribuidor eléctrico',
  61: 'Distribuidora eléctrica',
  62: 'Contratista electromecánico',
  63: 'Cooperativa eléctrica',
  64: 'Industria',
};

// Las marcas que el vendedor escribe en CliObser y que no son una
// particularidad sino una alerta: cambian, y mostrarlas como dato fijo
// envejece mal. Se separan para que la ficha las muestre como nota del
// vendedor, fechada, y no como una caracteristica del cliente.
const MARCAS_RIESGO = [
  { patron: /\bNO\s*VENDER\b/i, marca: 'NO VENDER' },
  { patron: /\bINCOBRABLE\b/i, marca: 'INCOBRABLE' },
  { patron: /\bCERR[OÓ]\b/i, marca: 'CERRÓ' },
  { patron: /\bFC\s*PEND/i, marca: 'FACTURA PENDIENTE' },
];

// "30+5", "32+5+3", "28+5": es la bonificacion en cascada escrita a mano.
// No se copia a la ficha: el descuento vive en Mirol (CliCodBon).
const DESCUENTO = /^\s*\+?\d{1,2}(\s*\+\s*\d{1,2})+\s*%?\s*$/;

const CONDICIONES_PAGO = [/PAGO\s*ANTICIPADO/i, /^ANTICIPADO$/i, /FACTURAR\s*D[OÓ]LAR/i];

// Un CUIT que no identifica a nadie. Mirol los usa como relleno.
const CUIT_RELLENO = /^(00|55)-/;

// Una misma localidad escrita de quince formas distintas no se puede agrupar.
// Estas son las que aparecen mas de tres veces en el maestro; el resto se
// normaliza por forma (mayusculas, sin acentos, sin puntos).
const ALIAS_LOCALIDAD = new Map(
  Object.entries({
    'CAP FED': 'CABA',
    'CAP FEDERAL': 'CABA',
    'CAPITAL FED': 'CABA',
    'CAPITAL FEDERAL': 'CABA',
    'CAPITAL FEDERA': 'CABA',
    'CAPITAL FERERAL': 'CABA',
    'CAP FERERAL': 'CABA',
    CAPITAL: 'CABA',
    'CIUDAD DE BUENOS AIRES': 'CABA',
    CABA: 'CABA',
    'SGO DEL ESTERO': 'Santiago del Estero',
    'SGO ESTERO': 'Santiago del Estero',
  })
);

export function normalizarLocalidad(valor) {
  const crudo = String(valor ?? '').trim();
  if (!crudo) return null;
  const plano = crudo
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const alias = ALIAS_LOCALIDAD.get(plano);
  if (alias) return alias;
  // Capitalizacion prolija: "SAN MARTIN" -> "San Martin".
  return plano
    .toLowerCase()
    .replace(/(^|[\s'-])([a-záéíóúñ])/g, (_, sep, letra) => sep + letra.toUpperCase());
}

// CliObser es un campo libre donde conviven tres cosas: las marcas de riesgo,
// los descuentos y las observaciones de verdad. Las separa para que cada una
// vaya a donde corresponde.
export function separarObservacion(texto) {
  const crudo = String(texto ?? '').trim();
  const vacio = { particularidades: null, marcas: [], condicionPago: null };
  if (!crudo) return vacio;

  const marcas = MARCAS_RIESGO.filter((m) => m.patron.test(crudo)).map((m) => m.marca);
  const condicionPago = CONDICIONES_PAGO.some((p) => p.test(crudo)) ? crudo : null;

  let resto = crudo;
  for (const m of MARCAS_RIESGO) resto = resto.replace(m.patron, '');
  resto = resto.replace(/[-\s.]+$/, '').replace(/^[-\s.]+/, '').trim();

  if (DESCUENTO.test(resto)) resto = '';
  if (condicionPago && !marcas.length && resto === crudo) resto = '';

  return {
    particularidades: resto || null,
    marcas,
    condicionPago,
  };
}

// "MARIO (CEL.1549942925)" o "SR. ANIBAL (15-57022751)": en 50 casos el
// telefono viene metido adentro del nombre del contacto.
export function separarContacto(texto) {
  const crudo = String(texto ?? '').trim();
  if (!crudo) return null;
  const m = crudo.match(/^(.*?)[\s(/-]*(?:CEL\.?|TEL\.?)?\s*([\d][\d\s.-]{6,})\)?\s*$/i);
  if (m && m[1].trim()) {
    return { nombre: limpiar(m[1]), telefono: m[2].replace(/[\s.]/g, '') };
  }
  return { nombre: limpiar(crudo), telefono: null };
}

function limpiar(s) {
  return String(s).replace(/[\s(/-]+$/, '').replace(/\s+/g, ' ').trim();
}

function texto(fila, columna) {
  const v = fila[columna];
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function entero(fila, columna) {
  const s = texto(fila, columna);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// Mirol arrastra fechas de migracion con valores imposibles (hay altas con
// fecha 1902). Cualquier cosa anterior a la fundacion de FACBSA es basura.
const PRIMERA_FECHA_CREIBLE = '1950-01-01';

function fechaAlta(fila) {
  const f = aFecha(fila.CliFec);
  if (!f || f < PRIMERA_FECHA_CREIBLE) return null;
  return f;
}

export function mapearCliente(fila) {
  const codigo = texto(fila, 'CliNum');
  const nombre = texto(fila, 'CliNom');
  if (!codigo || !nombre) return null;

  const cuit = texto(fila, 'CliCuit');
  const tipo = entero(fila, 'TipCliCod');
  const obs = separarObservacion(texto(fila, 'CliObser'));
  const lugarEntrega = texto(fila, 'CliLugEnt');

  const particularidades = [obs.particularidades, lugarEntrega ? `Entrega: ${lugarEntrega}` : null]
    .filter(Boolean)
    .join(' · ');

  const contactos = [];
  for (const [i, columna] of ['CliCon1', 'CliCon2', 'CliCon3'].entries()) {
    const c = separarContacto(texto(fila, columna));
    if (c) contactos.push({ ...c, principal: i === 0 });
  }

  return {
    codigo,
    nombre,
    nombreBusqueda: normalizarTexto(nombre),
    cuit: cuit && !CUIT_RELLENO.test(cuit) ? cuit : null,
    actividad: tipo !== null ? TIPOS_CLIENTE[tipo] || null : null,
    actividadCodigo: tipo !== null ? String(tipo) : null,
    direccion: texto(fila, 'CliDir'),
    localidad: normalizarLocalidad(texto(fila, 'CliLoc')),
    provincia: PROVINCIAS[(texto(fila, 'PciaCod') || '').toUpperCase()] || null,
    telefono: texto(fila, 'CliTel1'),
    email: texto(fila, 'CliEmail'),
    clienteDesde: fechaAlta(fila),
    condicionPago: obs.condicionPago,
    particularidades: particularidades || null,
    marcas: obs.marcas,
    agente: texto(fila, 'AgeNum'),
    contactos,
  };
}

function leerFilas(ruta, opciones = {}) {
  const filas = ruta.toLowerCase().endsWith('.csv')
    ? parsearCsv(fs.readFileSync(ruta, 'utf8'))
    : leerHoja(ruta, opciones.hoja ?? 0);
  if (!filas.length) throw new Error('El archivo no tiene filas.');

  const encabezados = filas[0].map((h) => String(h ?? '').trim());
  if (!encabezados.includes('CliNum')) {
    throw new Error(
      'No parece el maestro de clientes de Mirol: falta la columna CliNum. ' +
        'Exportalo de nuevo, o guardalo como .xlsx/.csv si es un .xls viejo.'
    );
  }
  return filas.slice(1).map((f) => {
    const obj = {};
    encabezados.forEach((h, i) => {
      if (h) obj[h] = f[i];
    });
    return obj;
  });
}

export function importarClientes(db, ruta, opciones = {}) {
  const filas = leerFilas(ruta, opciones);
  const resumen = {
    leidos: filas.length,
    nuevos: 0,
    actualizados: 0,
    contactos: 0,
    sinCuit: 0,
    sinActividad: 0,
    conMarcas: 0,
    codigosDeActividadSinTraducir: new Map(),
  };

  enTransaccion(db, () => {
    for (const fila of filas) {
      const c = mapearCliente(fila);
      if (!c) continue;

      if (!c.cuit) resumen.sinCuit++;
      if (!c.actividad) {
        resumen.sinActividad++;
        if (c.actividadCodigo) {
          const n = resumen.codigosDeActividadSinTraducir.get(c.actividadCodigo) || 0;
          resumen.codigosDeActividadSinTraducir.set(c.actividadCodigo, n + 1);
        }
      }
      if (c.marcas.length) resumen.conMarcas++;

      const existente = consultarUna(db, 'SELECT id FROM clientes WHERE codigo = ?', [c.codigo]);

      if (existente) {
        // particularidades NO se pisa: el vendedor la edita desde el WhatsApp
        // y esa version es la mas fresca. Solo se completa si esta vacia.
        ejecutar(
          db,
          `UPDATE clientes SET nombre = ?, nombre_busqueda = ?, cuit = COALESCE(?, cuit),
                  actividad = COALESCE(?, actividad), actividad_codigo = COALESCE(?, actividad_codigo),
                  direccion = COALESCE(?, direccion), localidad = COALESCE(?, localidad),
                  provincia = COALESCE(?, provincia), telefono = COALESCE(?, telefono),
                  email = COALESCE(?, email), cliente_desde = COALESCE(?, cliente_desde),
                  condicion_pago = COALESCE(?, condicion_pago),
                  particularidades = COALESCE(NULLIF(particularidades, ''), ?),
                  marcas = ?, actualizado_en = datetime('now')
             WHERE id = ?`,
          [
            c.nombre, c.nombreBusqueda, c.cuit, c.actividad, c.actividadCodigo,
            c.direccion, c.localidad, c.provincia, c.telefono, c.email,
            c.clienteDesde, c.condicionPago, c.particularidades,
            c.marcas.join(' · ') || null, existente.id,
          ]
        );
        resumen.actualizados++;
        resumen.contactos += sincronizarContactos(db, existente.id, c.contactos);
      } else {
        const r = ejecutar(
          db,
          `INSERT INTO clientes (codigo, nombre, nombre_busqueda, cuit, actividad, actividad_codigo,
                                 direccion, localidad, provincia, telefono, email, cliente_desde,
                                 condicion_pago, particularidades, marcas)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            c.codigo, c.nombre, c.nombreBusqueda, c.cuit, c.actividad, c.actividadCodigo,
            c.direccion, c.localidad, c.provincia, c.telefono, c.email, c.clienteDesde,
            c.condicionPago, c.particularidades, c.marcas.join(' · ') || null,
          ]
        );
        resumen.nuevos++;
        resumen.contactos += sincronizarContactos(db, Number(r.lastInsertRowid), c.contactos);
      }
    }
  });

  return resumen;
}

// Los contactos de Mirol son una semilla: un nombre suelto, sin cargo ni rol.
// Se cargan si no existen, pero nunca se pisa uno que ya tenga cargo o rol
// puesto desde el chat: esa version sabe mas que el maestro.
function sincronizarContactos(db, clienteId, contactos) {
  let nuevos = 0;
  for (const c of contactos) {
    const existe = consultarUna(
      db,
      'SELECT id FROM cliente_contactos WHERE cliente_id = ? AND nombre = ?',
      [clienteId, c.nombre]
    );
    if (existe) continue;
    ejecutar(
      db,
      `INSERT INTO cliente_contactos (cliente_id, nombre, telefono, principal, estado)
       VALUES (?, ?, ?, ?, 'A_CONFIRMAR')`,
      [clienteId, c.nombre, c.telefono, c.principal ? 1 : 0]
    );
    nuevos++;
  }
  return nuevos;
}
