// Posicionamiento de la competencia en el punto de venta.
//
// Saber "vi Genrod en el mostrador" no sirve para decidir nada. Lo que la
// direccion necesita poder preguntarle a la base es otra cosa:
//
//   ¿Quien nos compite en tomacables, en cuantas cuentas, y a que precio?
//   ¿Cuanto del consumo de esta cuenta se lo lleva otro y por que?
//   ¿Donde nos estan sacando volumen sin que lo veamos en la facturacion?
//
// Por eso la competencia no se releva como texto libre: se releva por
// competidor y por familia de producto, con una escala de participacion, una
// de precio y un motivo. Asi se puede sumar entre visitas.
//
// Igual que con las familias de producto, un competidor que no esta en el
// catalogo NO se inventa ni se fuerza dentro de otro: se guarda con el nombre
// que dijo el vendedor y queda marcado para que lo valide Comercial.
import { normalizarTexto } from './reglas.js';

// --- Catalogo de competidores ------------------------------------------------
// Lista inicial, PENDIENTE DE VALIDAR CON COMERCIAL. Agregar acá los que
// realmente aparecen en la calle; los alias son las formas en que los nombran
// los vendedores y los clientes.
// Competidores reales de FACBSA, confirmados por Comercial el 7/9/2026.
//
// `alias` son las formas en que puede aparecer el nombre: como lo escribe un
// vendedor apurado y, sobre todo, como sale de la transcripcion de un audio.
// Son variantes de escritura y de pronunciacion, no marcas distintas.
//
// `familias` dice en que productos compite cada uno. Se completa SOLO con lo que
// confirma Comercial: deducirlo del nombre seria adivinar. Un competidor sin
// familias cargadas funciona igual, pero el asistente no lo puede sugerir.
//
// `principalEn` marca las familias donde ese competidor es el que mas nos pelea.
// Sirve para el orden: cuando el asistente le tira nombres al vendedor, el
// primero tiene que ser el que mas probablemente escuche.
export const COMPETIDORES = [
  {
    nombre: 'GEN ROD',
    alias: ['gen rod', 'genrod', 'gen-rod', 'jen rod'],
    familias: ['JABALINAS LISAS', 'TOMACABLES', 'SOLDADURA EXOTERMICA'],
  },
  {
    nombre: 'ARGENJAB',
    alias: ['argenjab', 'argen jab', 'argenjav', 'argen yab'],
    familias: ['JABALINAS LISAS', 'TOMACABLES'],
  },
  {
    nombre: 'METAL CE',
    alias: ['metal ce', 'metalce', 'metal se', 'metal ce.'],
    familias: ['JABALINAS LISAS', 'TOMACABLES'],
    principalEn: ['TOMACABLES'],
  },
  { nombre: 'METALI', alias: ['metali', 'metalli', 'metaly', 'metalie'], familias: ['JABALINAS LISAS'] },
  { nombre: 'PRIOLO', alias: ['priolo', 'priollo', 'priolo hnos', 'priolo hermanos'], familias: ['JABALINAS LISAS'] },
];

/**
 * Lleva lo que dijo el vendedor al nombre canonico del competidor.
 * @returns {{competidor: string, conocido: boolean}}
 */
export function normalizarCompetidor(texto) {
  const crudo = String(texto ?? '').trim();
  if (!crudo) return { competidor: 'SIN IDENTIFICAR', conocido: false };

  const normal = normalizarTexto(crudo).toLowerCase();
  for (const c of COMPETIDORES) {
    if (c.alias.some((a) => normal.includes(a))) return { competidor: c.nombre, conocido: true };
  }
  return { competidor: normalizarTexto(crudo), conocido: false };
}

/**
 * Quienes compiten en una familia, con el principal primero: es el nombre que el
 * vendedor tiene mas chance de reconocer, y el orden importa porque al vendedor
 * se le nombran solo los primeros.
 */
export function competidorEsperado(familia) {
  const compiten = COMPETIDORES.filter((c) => c.familias.includes(familia));
  const esPrincipal = (c) => (c.principalEn || []).includes(familia);
  return [...compiten.filter(esPrincipal), ...compiten.filter((c) => !esPrincipal(c))].map(
    (c) => c.nombre
  );
}

// --- Escalas -----------------------------------------------------------------
// Escalas cerradas, con un valor numerico al lado. Sin ese numero no se puede
// promediar nada entre cuentas; sin la etiqueta, el vendedor no la contesta.
// Los titulos no pasan de 20 caracteres: es el limite de un boton de WhatsApp.

export const PARTICIPACION = [
  { etiqueta: 'Todo se lo compran', valor: 1.0 },
  { etiqueta: 'La mayor parte', valor: 0.75 },
  { etiqueta: 'Mitad y mitad', valor: 0.5 },
  { etiqueta: 'Una parte chica', valor: 0.25 },
  { etiqueta: 'Casi nada', valor: 0.1 },
];

export const PRECIO_RELATIVO = [
  { etiqueta: 'Mucho más barato', valor: -0.2 },
  { etiqueta: 'Algo más barato', valor: -0.08 },
  { etiqueta: 'Parecido al nuestro', valor: 0 },
  { etiqueta: 'Algo más caro', valor: 0.08 },
  { etiqueta: 'No lo sabe', valor: null },
];

// Por que le compran a otro. Es la palanca: cada motivo se corrige distinto.
export const MOTIVOS = [
  { etiqueta: 'Precio', accion: 'Revisar lista y descuentos para esa cuenta.' },
  { etiqueta: 'Entrega o stock', accion: 'Problema de abastecimiento, no comercial. Va a Producción.' },
  { etiqueta: 'Plazo de pago', accion: 'Evaluar condiciones con Administración.' },
  { etiqueta: 'Costumbre o relación', accion: 'Es el más recuperable: depende de frecuencia de visita.' },
  { etiqueta: 'Lo pide el pliego', accion: 'Es una homologación pendiente, no una pérdida comercial.' },
  { etiqueta: 'No nos conocían', accion: 'Falla de cobertura: la cuenta nunca fue trabajada.' },
];

const etiquetas = (escala) => escala.map((e) => e.etiqueta);
export const OPCIONES_PARTICIPACION = etiquetas(PARTICIPACION);
export const OPCIONES_PRECIO = etiquetas(PRECIO_RELATIVO);
export const OPCIONES_MOTIVO = etiquetas(MOTIVOS);

function valorDe(escala, etiqueta) {
  const item = escala.find((e) => e.etiqueta.toLowerCase() === String(etiqueta ?? '').trim().toLowerCase());
  return item ? item.valor : null;
}

/**
 * Valida y normaliza un registro de competencia antes de guardarlo.
 * @returns {{ok: true, fila: object} | {ok: false, error: string}}
 */
export function validarRegistro(entrada) {
  const { competidor, conocido } = normalizarCompetidor(entrada.competidor);
  if (competidor === 'SIN IDENTIFICAR') {
    return { ok: false, error: 'Falta el nombre del proveedor de la competencia.' };
  }

  const familia = normalizarTexto(entrada.familia || '');
  if (!familia) {
    return { ok: false, error: 'Falta la familia de producto en la que nos compite.' };
  }

  if (entrada.participacion && valorDe(PARTICIPACION, entrada.participacion) === null) {
    return { ok: false, error: `participacion tiene que ser una de: ${OPCIONES_PARTICIPACION.join(' | ')}` };
  }
  if (entrada.motivo && !OPCIONES_MOTIVO.some((m) => m.toLowerCase() === String(entrada.motivo).toLowerCase())) {
    return { ok: false, error: `motivo tiene que ser uno de: ${OPCIONES_MOTIVO.join(' | ')}` };
  }
  if (entrada.precio_relativo && !OPCIONES_PRECIO.some((p) => p.toLowerCase() === String(entrada.precio_relativo).toLowerCase())) {
    return { ok: false, error: `precio_relativo tiene que ser uno de: ${OPCIONES_PRECIO.join(' | ')}` };
  }

  return {
    ok: true,
    fila: {
      competidor,
      competidorCrudo: String(entrada.competidor).trim(),
      competidorConocido: conocido ? 1 : 0,
      familia,
      participacion: entrada.participacion || null,
      participacionValor: valorDe(PARTICIPACION, entrada.participacion),
      precioRelativo: entrada.precio_relativo || null,
      precioValor: valorDe(PRECIO_RELATIVO, entrada.precio_relativo),
      motivo: entrada.motivo || null,
      volumen: entrada.volumen || null,
      observacion: entrada.observacion || null,
    },
  };
}

// --- Lectura -----------------------------------------------------------------

/**
 * Resume lo relevado en un cliente, para mostrarlo en la ficha de la proxima
 * visita: la competencia que ya conocemos no se vuelve a preguntar de cero.
 */
export function resumirPorCliente(filas) {
  return filas.map((f) => {
    const partes = [`${f.competidor} en ${f.familia}`];
    if (f.participacion) partes.push(f.participacion.toLowerCase());
    if (f.precio_relativo && f.precio_relativo !== 'No lo sabe') partes.push(f.precio_relativo.toLowerCase());
    if (f.motivo) partes.push(`por ${f.motivo.toLowerCase()}`);
    return partes.join(' · ');
  });
}

/**
 * Agrega lo relevado en toda la cartera. Es la vista que le sirve a la
 * direccion: donde nos compite cada uno y cuanto pesa.
 */
export function resumirCartera(filas) {
  const porCompetidor = new Map();
  const porFamilia = new Map();

  for (const f of filas) {
    const c = porCompetidor.get(f.competidor) || {
      competidor: f.competidor, cuentas: new Set(), familias: new Set(),
      participacion: [], precio: [], motivos: new Map(),
    };
    c.cuentas.add(f.cliente_id);
    c.familias.add(f.familia);
    if (f.participacion_valor !== null) c.participacion.push(f.participacion_valor);
    if (f.precio_valor !== null && f.precio_valor !== undefined) c.precio.push(f.precio_valor);
    if (f.motivo) c.motivos.set(f.motivo, (c.motivos.get(f.motivo) || 0) + 1);
    porCompetidor.set(f.competidor, c);

    const fam = porFamilia.get(f.familia) || { familia: f.familia, cuentas: new Set(), competidores: new Map() };
    fam.cuentas.add(f.cliente_id);
    fam.competidores.set(f.competidor, (fam.competidores.get(f.competidor) || 0) + 1);
    porFamilia.set(f.familia, fam);
  }

  const promedio = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  const competidores = [...porCompetidor.values()]
    .map((c) => ({
      competidor: c.competidor,
      cuentas: c.cuentas.size,
      familias: [...c.familias],
      participacionPromedio: promedio(c.participacion),
      brechaPrecioPromedio: promedio(c.precio),
      motivoPrincipal: [...c.motivos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
    }))
    .sort((a, b) => b.cuentas - a.cuentas);

  const familias = [...porFamilia.values()]
    .map((f) => ({
      familia: f.familia,
      cuentas: f.cuentas.size,
      competidorPrincipal: [...f.competidores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      competidores: [...f.competidores.keys()],
    }))
    .sort((a, b) => b.cuentas - a.cuentas);

  const sinClasificar = [...new Set(filas.filter((f) => !f.competidor_conocido).map((f) => f.competidor))];

  return { competidores, familias, sinClasificar, registros: filas.length };
}
