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
// Bandas por facturacion anual en pesos nominales del periodo analizado.
export const SEGMENTOS = [
  {
    letra: 'A',
    desde: 50_000_000,
    hasta: Infinity,
    modelo: 'CLAVE',
    detalle: 'Contrato marco anual. Alerta de churn si cae mas de 15% en un trimestre.',
  },
  {
    letra: 'B',
    desde: 10_000_000,
    hasta: 50_000_000,
    modelo: 'ESTRATEGICO',
    detalle: 'Visita regular. Programa de upgrading hacia segmento A. Cross-selling activo.',
  },
  {
    letra: 'C',
    desde: 1_000_000,
    hasta: 10_000_000,
    modelo: 'DESARROLLO',
    detalle: 'Cross-selling y aumento de frecuencia. Identificar palanca de crecimiento.',
  },
  {
    letra: 'D',
    desde: 0,
    hasta: 1_000_000,
    modelo: 'REVISAR RENTABILIDAD',
    detalle: 'Evaluar pedido minimo de $1M o migrar a canal digital / mayorista.',
  },
];

export function segmentar(facturacion12m) {
  const banda = SEGMENTOS.find((s) => facturacion12m >= s.desde && facturacion12m < s.hasta);
  return banda || SEGMENTOS[SEGMENTOS.length - 1];
}

// Caida trimestral que dispara alerta de churn en cuentas clave.
export const CAIDA_CHURN = 0.15;

// Una cuenta que supera estos porcentajes del total de la empresa es un riesgo
// de concentracion y merece contrato marco.
export const CONCENTRACION_ALERTA = 0.15;
export const CONCENTRACION_CRITICA = 0.25;

// Dias sin comprar a partir de los cuales el cliente se considera dormido.
export const DIAS_INACTIVO = 90;
export const DIAS_INACTIVO_GRAVE = 180;

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
export const RATIO_TOMACABLES_OBJETIVO = 0.5; // 1 tomacable cada 2 jabalinas
// Por debajo de este volumen de jabalinas el ratio es ruido estadistico.
export const MINIMO_JABALINAS_PARA_GAP = 20;
// Ratio muy por encima del objetivo: posible gap invertido (compra las
// jabalinas en otro lado).
export const RATIO_GAP_INVERTIDO = 0.75;

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
