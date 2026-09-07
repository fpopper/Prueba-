// Deteccion de columnas y normalizacion de filas del archivo de ventas.
//
// El sistema legacy exporta con encabezados que cambian de un reporte a otro,
// asi que en vez de asumir posiciones fijas buscamos cada columna por una lista
// de alias. Si alguna no aparece, el importador lo avisa en vez de importar
// datos mal mapeados.
import { grupoAgente, normalizarFamilia, normalizarTexto } from '../negocio/reglas.js';
import { serialAFecha } from './xlsx.js';

export const ALIAS_COLUMNAS = {
  cliente: ['cliente', 'razon social', 'razón social', 'nombre cliente', 'nombre', 'cuenta'],
  codigo: ['codigo cliente', 'código cliente', 'cod cliente', 'cod. cliente', 'codigo', 'código', 'cod'],
  cuit: ['cuit', 'cuit/cuil', 'documento'],
  fecha: ['fecha', 'fecha comprobante', 'fecha factura', 'fecha emision', 'fecha emisión', 'periodo'],
  agente: ['agente', 'vendedor', 'representante', 'comisionista'],
  canal: ['canal', 'tipo cliente', 'rubro cliente', 'segmento comercial', 'actividad'],
  familia: ['familia', 'familia producto', 'linea', 'línea', 'rubro', 'rubro producto', 'grupo articulo'],
  articulo: ['articulo', 'artículo', 'producto', 'descripcion', 'descripción', 'detalle', 'codigo articulo'],
  cantidad: ['cantidad', 'cant', 'cant.', 'unidades', 'qty'],
  importe: ['importe neto', 'neto', 'importe', 'total', 'facturacion', 'facturación', 'monto', 'subtotal'],
  localidad: ['localidad', 'ciudad'],
  provincia: ['provincia', 'estado'],
  // Cuenta corriente. Opcionales: si el reporte no las trae, el bot no muestra
  // nada de cobranza en vez de inventarlo.
  deuda: ['deuda vencida', 'saldo vencido', 'vencido', 'deuda', 'saldo deudor'],
  condicionPago: ['condicion de pago', 'condición de pago', 'condicion pago', 'forma de pago', 'plazo de pago'],
};

// Devuelve { mapeo: {campo: indice}, faltantes: [campo] }
export function detectarColumnas(encabezados) {
  const normalizados = encabezados.map((h) => normalizarTexto(h).toLowerCase());
  const mapeo = {};

  for (const [campo, alias] of Object.entries(ALIAS_COLUMNAS)) {
    // Primero coincidencia exacta, despues que empiece igual, despues que contenga.
    let indice = normalizados.findIndex((h) => alias.includes(h));
    if (indice === -1) indice = normalizados.findIndex((h) => alias.some((a) => h.startsWith(a)));
    if (indice === -1) indice = normalizados.findIndex((h) => alias.some((a) => h.includes(a)));
    if (indice !== -1) mapeo[campo] = indice;
  }

  const obligatorias = ['cliente', 'fecha', 'importe'];
  const faltantes = obligatorias.filter((c) => mapeo[c] === undefined);
  return { mapeo, faltantes };
}

// Encuentra la fila de encabezados: el archivo suele traer titulo, logo y
// filas en blanco antes de la tabla.
export function buscarFilaEncabezado(filas, maximoEscaneo = 15) {
  let mejor = { indice: -1, encontradas: 0 };
  for (let i = 0; i < Math.min(filas.length, maximoEscaneo); i++) {
    const { mapeo } = detectarColumnas(filas[i] || []);
    const encontradas = Object.keys(mapeo).length;
    if (encontradas > mejor.encontradas) mejor = { indice: i, encontradas };
  }
  return mejor.encontradas >= 3 ? mejor.indice : -1;
}

// --- Conversores -------------------------------------------------------------

export function aNumero(valor) {
  if (valor === null || valor === undefined || valor === '') return 0;
  if (typeof valor === 'number') return valor;
  let texto = String(valor).trim().replace(/\$|\s/g, '');
  const negativo = /^\(.*\)$/.test(texto); // el sistema exporta negativos entre parentesis
  texto = texto.replace(/[()]/g, '');

  if (texto.includes(',')) {
    // Formato argentino con decimales: 1.234.567,89 -> el punto es de miles.
    texto = texto.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(texto)) {
    // Solo puntos y todos los grupos de 3 digitos: son separadores de miles
    // (45.000 son cuarenta y cinco mil, no cuarenta y cinco).
    texto = texto.replace(/\./g, '');
  }

  const n = Number(texto);
  if (!Number.isFinite(n)) return 0;
  return negativo ? -Math.abs(n) : n;
}

export function aFecha(valor) {
  if (!valor) return null;
  const texto = String(valor).trim();

  // Numero de serie de Excel
  if (/^\d{5}(\.\d+)?$/.test(texto)) return serialAFecha(texto);

  // ISO
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // dd/mm/aaaa o dd-mm-aaaa
  const arg = texto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (arg) {
    const [, d, m, a] = arg;
    const anio = a.length === 2 ? `20${a}` : a;
    return `${anio}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const fecha = new Date(texto);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString().slice(0, 10);
}

/** Convierte una fila cruda del archivo en un registro de venta normalizado. */
export function normalizarFila(fila, mapeo) {
  const col = (campo) => (mapeo[campo] !== undefined ? fila[mapeo[campo]] : null);

  const nombreCliente = String(col('cliente') ?? '').trim();
  if (!nombreCliente) return null;

  const fecha = aFecha(col('fecha'));
  if (!fecha) return null;

  const familiaCruda = String(col('familia') ?? col('articulo') ?? '').trim();
  const { familia, clasificada } = normalizarFamilia(familiaCruda);
  const agente = String(col('agente') ?? '').trim() || null;

  return {
    cliente: {
      nombre: nombreCliente,
      nombreBusqueda: normalizarTexto(nombreCliente),
      codigo: String(col('codigo') ?? '').trim() || null,
      cuit: String(col('cuit') ?? '').trim() || null,
      canal: String(col('canal') ?? '').trim().toUpperCase() || null,
      localidad: String(col('localidad') ?? '').trim() || null,
      provincia: String(col('provincia') ?? '').trim() || null,
      deuda: mapeo.deuda !== undefined ? aNumero(col('deuda')) : null,
      condicionPago: String(col('condicionPago') ?? '').trim() || null,
    },
    venta: {
      fecha,
      agente,
      agenteGrupo: grupoAgente(agente),
      canal: String(col('canal') ?? '').trim().toUpperCase() || null,
      familia,
      familiaCruda: familiaCruda || null,
      familiaClasificada: clasificada,
      articulo: String(col('articulo') ?? '').trim() || null,
      cantidad: aNumero(col('cantidad')),
      importe: aNumero(col('importe')),
    },
  };
}

// Parser CSV que respeta comillas. Detecta si el separador es ; o ,
export function parsearCsv(texto) {
  const limpio = texto.replace(/^﻿/, '');
  const primeraLinea = limpio.split('\n')[0] || '';
  const separador = (primeraLinea.match(/;/g) || []).length >= (primeraLinea.match(/,/g) || []).length ? ';' : ',';

  const filas = [];
  let campo = '';
  let fila = [];
  let entreComillas = false;

  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (entreComillas) {
      if (c === '"' && limpio[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') {
        entreComillas = false;
      } else {
        campo += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === separador) {
      fila.push(campo);
      campo = '';
    } else if (c === '\n') {
      fila.push(campo.replace(/\r$/, ''));
      filas.push(fila);
      fila = [];
      campo = '';
    } else {
      campo += c;
    }
  }
  if (campo !== '' || fila.length) {
    fila.push(campo.replace(/\r$/, ''));
    filas.push(fila);
  }
  return filas.filter((f) => f.some((c) => String(c).trim() !== ''));
}
