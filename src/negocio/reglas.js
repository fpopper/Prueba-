// Reglas de negocio de FACBSA, validadas contra el sistema de ventas.
// Este archivo es el unico lugar donde viven los umbrales: si Comercial cambia
// un criterio, se toca aca y todo el bot queda alineado.

// --- 1. Identidad de agentes -------------------------------------------------
// FACSA y FACBSA son la misma cosa: venta interna de la propia empresa.
export const VENTA_DIRECTA = ['FACBSA', 'FACSA', 'N.ANTONUCCI', 'SERGIO ELLERO'];

export function grupoAgente(agente) {
  if (!agente) return 'Sin agente';
  const normal = normalizarTexto(agente);
  const esDirecta = VENTA_DIRECTA.some((id) => normalizarTexto(id) === normal);
  return esDirecta ? 'Venta Directa' : 'Representante';
}

// Cuando una cuenta esta compartida, se atribuye al agente con mayor
// facturacion en los ultimos 12 meses. Al segundo se lo nombra si supera este
// porcentaje, para no reclamarle a una sola persona un gap que es de dos.
export const UMBRAL_AGENTE_SECUNDARIO = 0.25;

// --- 2. Canales --------------------------------------------------------------
export const CANALES_CONOCIDOS = ['EMPRESA ENERGIA', 'DISTRIBUIDOR', 'CONSTRUCTORA'];

// --- 3. Segmentacion de clientes --------------------------------------------
// Definida por PERCENTILES DE LA CARTERA, no por umbrales en pesos.
//
// Con la inflacion argentina una banda fija en pesos deja de significar nada en
// pocos meses: un cliente "sube" de segmento sin haber vendido una unidad mas.
// El corte es el mismo Pareto que ya usa la direccion para leer la cartera, asi
// que el segmento y el analisis hablan el mismo idioma.
//
//   A -> las cuentas que acumulan el primer 50% de la facturacion
//   B -> hasta el 80%
//   C -> hasta el 95%
//   D -> la cola
export const CORTES_PARETO = [
  { letra: 'A', hasta: 0.50, modelo: 'CLAVE', detalle: 'Contrato marco anual. Alerta de churn si cae mas de 15% en un trimestre.' },
  { letra: 'B', hasta: 0.80, modelo: 'ESTRATEGICO', detalle: 'Visita regular. Programa de upgrading hacia segmento A. Cross-selling activo.' },
  { letra: 'C', hasta: 0.95, modelo: 'DESARROLLO', detalle: 'Cross-selling y aumento de frecuencia. Identificar palanca de crecimiento.' },
  { letra: 'D', hasta: 1.00, modelo: 'REVISAR RENTABILIDAD', detalle: 'Evaluar pedido minimo o migrar a canal digital / mayorista.' },
];

export function modeloDeAtencion(letra) {
  return CORTES_PARETO.find((c) => c.letra === letra) || CORTES_PARETO[CORTES_PARETO.length - 1];
}

/**
 * Asigna el segmento a cada cuenta segun donde cae en el acumulado de la
 * facturacion de la cartera.
 * @param {Array<{id:*, facturacion:number}>} cuentas
 * @returns {Map<*, string>} id -> letra
 */
export function asignarSegmentos(cuentas) {
  const activas = cuentas.filter((c) => c.facturacion > 0).sort((a, b) => b.facturacion - a.facturacion);
  const total = activas.reduce((suma, c) => suma + c.facturacion, 0);
  const segmentos = new Map();

  // Una cuenta sin facturacion en el periodo no tiene posicion en la cartera.
  for (const c of cuentas) if (c.facturacion <= 0) segmentos.set(c.id, 'D');
  if (total <= 0) return segmentos;

  // Se recorre la cartera de mayor a menor asignando la banda actual, y recien
  // se pasa a la siguiente cuando el acumulado cruza el corte. Asi la cuenta
  // que cruza el 50% queda DENTRO de A, que es lo que significa "las cuentas
  // que acumulan el primer 50%", y con una sola cuenta activa esa cuenta es A.
  let acumulado = 0;
  let banda = 0;
  for (const cuenta of activas) {
    segmentos.set(cuenta.id, CORTES_PARETO[banda].letra);
    acumulado += cuenta.facturacion;
    while (banda < CORTES_PARETO.length - 1 && acumulado / total >= CORTES_PARETO[banda].hasta) {
      banda++;
    }
  }

  return segmentos;
}

// Caida trimestral que dispara alerta de churn. Aplica a A y a B: en B es donde
// todavia se puede revertir con una visita; cuando cae una A muchas veces ya es tarde.
export const CAIDA_CHURN = 0.15;
export const SEGMENTOS_CON_ALERTA_CHURN = ['A', 'B'];

// Una cuenta que supera estos porcentajes del total de la empresa es un riesgo
// de concentracion y merece contrato marco.
export const CONCENTRACION_ALERTA = 0.10;
export const CONCENTRACION_CRITICA = 0.20;

// Dias sin comprar a partir de los cuales el cliente se considera dormido.
// El plazo depende del canal porque el ciclo de compra no tiene nada que ver:
// una distribuidora electrica compra por licitacion, un distribuidor deberia
// reponer seguido, y una constructora compra por obra.
export const INACTIVIDAD_POR_CANAL = {
  'EMPRESA ENERGIA': { dormido: 120, perdido: 240 },
  DISTRIBUIDOR: { dormido: 60, perdido: 120 },
  CONSTRUCTORA: { dormido: 180, perdido: 365 },
};

// Para un canal que no esta en la tabla, o un cliente sin canal cargado.
export const INACTIVIDAD_POR_DEFECTO = { dormido: 90, perdido: 180 };

export function plazosInactividad(canal) {
  const clave = normalizarTexto(canal || '');
  return INACTIVIDAD_POR_CANAL[clave] || INACTIVIDAD_POR_DEFECTO;
}

// --- 4. Familias de producto -------------------------------------------------
// El rol comercial es una decision de negocio ya tomada. Una familia que no
// figure aca se reporta SIN CLASIFICAR: no se deduce el rol del volumen.
export const FAMILIAS = {
  'CABLE IRAM 2467': { rol: 'Motor de facturacion', peso: 0.39 },
  'JABALINAS LISAS': { rol: 'Producto ancla', peso: 0.17 },
  'VARIOS (CONJUNTOS)': { rol: 'Venta de solucion', peso: 0.16 },
  TOMACABLES: { rol: 'Complemento de jabalina', peso: null },
  PARARRAYOS: { rol: 'Sistema', peso: null },
  'SOLDADURA EXOTERMICA': { rol: 'Complemento', peso: null },
  'CONECTORES A COMPRESION': { rol: 'Complemento', peso: null },
  'CONECTORES DERIVACION POR PERFORACION': { rol: 'Linea en desarrollo (Intelli)', peso: null },
};

// Alias frecuentes del sistema legacy -> nombre canonico de familia.
const ALIAS_FAMILIA = [
  [/iram\s*2467|cable\s*iram|^cable/i, 'CABLE IRAM 2467'],
  [/jabalina.*lisa|^jabalina/i, 'JABALINAS LISAS'],
  [/varios.*conjunto|conjunto|^varios$/i, 'VARIOS (CONJUNTOS)'],
  [/toma\s*cable|tomacable/i, 'TOMACABLES'],
  [/pararrayo/i, 'PARARRAYOS'],
  [/exotermic|aluminotermic|soldadura/i, 'SOLDADURA EXOTERMICA'],
  [/compresi[oó]n/i, 'CONECTORES A COMPRESION'],
  [/perforaci[oó]n|derivad|intelli/i, 'CONECTORES DERIVACION POR PERFORACION'],
];

export function normalizarFamilia(texto) {
  if (!texto) return { familia: 'SIN CLASIFICAR', clasificada: false };
  const crudo = String(texto).trim();
  for (const [patron, canonica] of ALIAS_FAMILIA) {
    if (patron.test(crudo)) return { familia: canonica, clasificada: true };
  }
  const mayus = crudo.toUpperCase();
  if (FAMILIAS[mayus]) return { familia: mayus, clasificada: true };
  // No inventamos rol comercial: la familia se conserva con su nombre original
  // y queda marcada para que Comercial la valide.
  return { familia: mayus, clasificada: false };
}

export function rolFamilia(familia) {
  return FAMILIAS[familia]?.rol || 'SIN CLASIFICAR - validar con Comercial';
}

// --- 5. Cross-selling --------------------------------------------------------
// Los tomacables se asocian a JABALINAS, no a metros de cable. Es la correccion
// mas importante del modelo comercial.
// 1 tomacable cada 1,5 jabalinas (definido por Comercial, reemplaza al 0,50
// que se habia usado como hipotesis inicial de trabajo).
export const RATIO_TOMACABLES_OBJETIVO = 2 / 3;
// Por debajo de este volumen de jabalinas el ratio es ruido estadistico.
export const MINIMO_JABALINAS_PARA_GAP = 20;
// Mas tomacables que jabalinas: gap invertido. Probablemente las jabalinas se
// las compra a otro.
export const RATIO_GAP_INVERTIDO = 1.0;

export function calcularGapTomacables(jabalinas, tomacables, precioPromedioTomacable) {
  if (!jabalinas || jabalinas < MINIMO_JABALINAS_PARA_GAP) {
    return { aplica: false, ratio: null, gapUnidades: 0, gapPesos: 0 };
  }
  const ratio = jabalinas > 0 ? tomacables / jabalinas : null;
  const gapUnidades = Math.max(0, jabalinas * RATIO_TOMACABLES_OBJETIVO - tomacables);
  return {
    aplica: true,
    ratio,
    gapUnidades,
    gapPesos: gapUnidades * (precioPromedioTomacable || 0),
  };
}

// --- 6. Utilidades comunes ---------------------------------------------------
export function normalizarTexto(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function pesos(valor) {
  const n = Number(valor) || 0;
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
}

export function porcentaje(valor, decimales = 0) {
  if (valor === null || valor === undefined) return '-';
  return `${(Number(valor) * 100).toFixed(decimales).replace('.', ',')}%`;
}

export function unidades(valor) {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(Number(valor) || 0);
}
