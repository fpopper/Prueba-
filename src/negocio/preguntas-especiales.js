// Motor de preguntas especiales.
//
// Esta es la parte que hace que el chat valga la pena: en vez de mandarle a
// todos los vendedores el mismo cuestionario, mira la situacion real del
// cliente en la base y decide que tiene que preguntar ADEMAS de lo de rutina.
//
// Cada regla declara:
//   id        identificador estable (queda guardado en la respuesta, para poder
//             medir despues cuantas veces se disparo y que contestaron)
//   nivel     CRITICO | ALERTA | OPORTUNIDAD | INFO  -> define la prioridad
//   aplica    funcion sobre la ficha del cliente
//   pregunta  lo que se le pide al vendedor
//   motivo    por que se la estamos pidiendo (se le muestra, para que entienda
//             el pedido y no lo conteste de compromiso)
//   tipo      texto | opciones | numero
import { competidorEsperado } from './competencia.js';

// Cuantos competidores se le nombran al vendedor como pista. Mas de tres deja
// de ser una ayuda para acordarse y pasa a ser una lista que no lee.
const MAX_PISTAS = 3;

function pista(familia, encabezado) {
  const esperados = competidorEsperado(familia).slice(0, MAX_PISTAS);
  return esperados.length ? ` ${encabezado} ${esperados.join(', ')}.` : '';
}
import {
  CAIDA_CHURN,
  CONCENTRACION_ALERTA,
  MINIMO_JABALINAS_PARA_GAP,
  RATIO_GAP_INVERTIDO,
  RATIO_TOMACABLES_OBJETIVO,
  SEGMENTOS_CON_ALERTA_CHURN,
  plazosInactividad,
  pesos,
  porcentaje,
  unidades,
} from './reglas.js';

// Cuantas preguntas especiales se le pueden pedir como maximo a un vendedor en
// una visita. Mas que esto y deja de contestarlas en serio.
export const MAX_PREGUNTAS_ESPECIALES = 4;

const PRIORIDAD = { CRITICO: 0, ALERTA: 1, OPORTUNIDAD: 2, INFO: 3 };

function tieneFamilia(ficha, patron) {
  return ficha.familias.some((f) => patron.test(f.familia));
}

export const REGLAS = [
  // --- Cobranza --------------------------------------------------------------
  {
    id: 'DEUDA_VENCIDA',
    nivel: 'CRITICO',
    aplica: (f) => Number(f.cliente.deudaVencida || 0) > 0,
    motivo: (f) =>
      `Tiene ${pesos(f.cliente.deudaVencida)} de deuda vencida` +
      `${f.cliente.condicionPago ? `, con condicion ${f.cliente.condicionPago}` : ''}. ` +
      'No se toma pedido nuevo sobre una cuenta vencida sin pasar por Administracion.',
    pregunta:
      '¿Que dijeron de la deuda vencida? ¿Hay fecha de pago comprometida o hay un problema de fondo?',
    tipo: 'texto',
  },

  // --- Riesgo de perder la cuenta -------------------------------------------
  {
    id: 'CHURN_CUENTA_CLAVE',
    nivel: 'CRITICO',
    aplica: (f) =>
      SEGMENTOS_CON_ALERTA_CHURN.includes(f.metricas.segmento) &&
      f.metricas.variacionTrim !== null &&
      f.metricas.variacionTrim <= -CAIDA_CHURN,
    motivo: (f) =>
      `Es segmento ${f.metricas.segmento} y cayo ${porcentaje(Math.abs(f.metricas.variacionTrim))} en el trimestre.`,
    pregunta:
      '¿Por que bajaron las compras? ¿Entro otro proveedor, se les freno la obra, o hubo un problema con nosotros?',
    tipo: 'texto',
  },
  {
    id: 'CLIENTE_DORMIDO',
    nivel: 'CRITICO',
    aplica: (f) =>
      f.metricas.diasSinComprar !== null &&
      f.metricas.diasSinComprar >= plazosInactividad(f.cliente.canal).dormido,
    motivo: (f) =>
      `No compra hace ${f.metricas.diasSinComprar} dias, y para ${f.cliente.canal || 'este canal'} ` +
      `el limite es ${plazosInactividad(f.cliente.canal).dormido}.`,
    pregunta: '¿Que pasa que dejaron de comprar? ¿A quien le estan comprando hoy y por que?',
    tipo: 'texto',
  },

  // --- Cross-selling: el gap de tomacables ----------------------------------
  {
    id: 'GAP_TOMACABLES',
    nivel: 'OPORTUNIDAD',
    aplica: (f) =>
      f.metricas.jabalinas >= MINIMO_JABALINAS_PARA_GAP && f.metricas.gapTomacablesU > 0,
    motivo: (f) =>
      `Compra ${unidades(f.metricas.jabalinas)} jabalinas y solo ${unidades(f.metricas.tomacables)} tomacables ` +
      `(ratio ${porcentaje(f.metricas.ratioTomacables)}, referencia ${porcentaje(RATIO_TOMACABLES_OBJETIVO)}). ` +
      `Gap estimado ${unidades(f.metricas.gapTomacablesU)} u. ≈ ${pesos(f.metricas.gapTomacablesPesos)}. ` +
      'Es una estimacion, no una demanda comprobada: confirmala en el cliente.',
    pregunta:
      '¿A quién le compran los tomacables, qué parte del consumo se lleva y a qué precio?' +
      // La pista sale sólo si Comercial ya definió quién compite en esta
      // familia. Sin eso, mejor no tirar nombres al aire.
      pista('TOMACABLES', 'Si no sabés el nombre, tanteá: en tomacables suele aparecer'),
    tipo: 'texto',
  },
  {
    id: 'GAP_INVERTIDO_JABALINAS',
    nivel: 'OPORTUNIDAD',
    aplica: (f) =>
      f.metricas.tomacables >= 10 &&
      f.metricas.ratioTomacables !== null &&
      f.metricas.ratioTomacables > RATIO_GAP_INVERTIDO,
    motivo: (f) =>
      `Compra mas tomacables que los que corresponderian a sus jabalinas (ratio ${porcentaje(f.metricas.ratioTomacables)}). ` +
      'Probablemente las jabalinas las compra en otro lado.',
    pregunta:
      '¿Dónde compran las jabalinas, qué parte del consumo y a qué precio contra el nuestro?' +
      pista('JABALINAS LISAS', 'Si no te lo dicen de entrada, tanteá: en jabalinas suele aparecer'),
    tipo: 'texto',
  },

  // --- Cross-selling: familias que no compra --------------------------------
  {
    id: 'SIN_CONJUNTOS',
    nivel: 'OPORTUNIDAD',
    aplica: (f) =>
      f.metricas.facturacion12m > 1_000_000 && !tieneFamilia(f, /CONJUNTO|^VARIOS/),
    motivo: () =>
      'No compra VARIOS (Conjuntos). Es la venta de solucion: mismo proyecto y precio similar que los componentes sueltos, pero mas valor percibido y menos costo operativo.',
    pregunta:
      '¿Le mostraste el conjunto armado en vez de los componentes sueltos? ¿Que dijo — precio, costumbre, o no lo conocia?',
    tipo: 'texto',
  },
  {
    id: 'PARARRAYOS_SUELTO',
    nivel: 'OPORTUNIDAD',
    aplica: (f) => tieneFamilia(f, /PARARRAYO/) && !tieneFamilia(f, /CONJUNTO|^VARIOS/),
    motivo: () => 'Compra pararrayos sueltos donde correspondería el sistema completo.',
    pregunta: '¿Quien les provee el resto del sistema de proteccion (bajada, puesta a tierra, contadores)?',
    tipo: 'texto',
  },
  {
    id: 'MIGRACION_JABALINA',
    nivel: 'OPORTUNIDAD',
    aplica: (f) => f.metricas.jabalinas >= MINIMO_JABALINAS_PARA_GAP,
    motivo: () =>
      'Las jabalinas de seccion 16/18 valen entre 2 y 4 veces mas que las de 10/14. Si la obra lo permite, es upgrade directo de facturacion.',
    pregunta:
      '¿Que seccion de jabalina usan (10/14 o 16/18) y quien define esa especificacion — el cliente, el pliego o el instalador?',
    tipo: 'texto',
  },

  // --- Segun canal -----------------------------------------------------------
  {
    id: 'HOMOLOGACION_ENERGIA',
    nivel: 'ALERTA',
    aplica: (f) => /ENERGIA/i.test(f.cliente.canal || ''),
    motivo: () =>
      'Es una distribuidora electrica: aca la compra pasa por licitacion o contrato marco y lo que manda es la homologacion.',
    pregunta:
      '¿Estamos homologados en su pliego? ¿Cuando abre la proxima licitacion o renovacion de contrato?',
    tipo: 'texto',
  },
  {
    id: 'DISTRIBUIDOR_STOCK',
    nivel: 'INFO',
    aplica: (f) => /DISTRIBUIDOR/i.test(f.cliente.canal || ''),
    motivo: () => 'Es reventa: lo que importa es la rotacion y que no se quede sin stock nuestro.',
    pregunta: '¿Cuanto stock nuestro tienen y cada cuanto reponen? ¿Que competencia tienen en gondola?',
    tipo: 'texto',
  },
  {
    id: 'CONSTRUCTORA_OBRA',
    nivel: 'INFO',
    aplica: (f) => /CONSTRUCTOR/i.test(f.cliente.canal || ''),
    motivo: () => 'Compra por proyecto: la demanda es discontinua y hay que anticipar la obra.',
    pregunta: '¿Que obras tienen en curso o adjudicadas para los proximos 6 meses y que volumen implican?',
    tipo: 'texto',
  },

  // --- Segun segmento --------------------------------------------------------
  {
    id: 'CONTRATO_MARCO',
    nivel: 'ALERTA',
    aplica: (f) => f.metricas.participacion >= CONCENTRACION_ALERTA,
    motivo: (f) =>
      `Concentra el ${porcentaje(f.metricas.participacion)} de la facturacion de FACBSA. La direccion quiere asegurarla con contrato marco.`,
    pregunta: '¿Estarian dispuestos a firmar un contrato marco anual con volumen y precio pactados?',
    tipo: 'texto',
  },
  {
    id: 'UPGRADE_B_A',
    nivel: 'OPORTUNIDAD',
    aplica: (f) => f.metricas.segmento === 'B',
    motivo: () =>
      'Segmento B: el objetivo definido es llevarlo a segmento A. Hay que encontrar la palanca concreta.',
    pregunta: '¿Que les tendriamos que dar para que nos compren el doble — precio, plazo, stock o servicio tecnico?',
    tipo: 'texto',
  },
  {
    id: 'PALANCA_C',
    nivel: 'OPORTUNIDAD',
    aplica: (f) => f.metricas.segmento === 'C',
    motivo: () => 'Segmento C es DESARROLLO: el modelo pide identificar la palanca de crecimiento del cliente.',
    pregunta: '¿Cual es el freno concreto para que compren mas: precio, entrega, surtido o que no nos conocen del todo?',
    tipo: 'texto',
  },
  {
    id: 'RENTABILIDAD_D',
    nivel: 'INFO',
    aplica: (f) => f.metricas.segmento === 'D',
    motivo: () =>
      'Segmento D: antes de invertir en desarrollarlo hay que ver si la cuenta se paga sola.',
    pregunta:
      '¿Tiene potencial real de crecer o conviene pasarlo a pedido minimo / mayorista? Justificalo en una linea.',
    tipo: 'opciones',
    opciones: ['Tiene potencial, desarrollarlo', 'Pasar a pedido minimo', 'Migrar a mayorista', 'Dar de baja'],
  },

  // --- Competencia ya conocida en la cuenta ----------------------------------
  {
    id: 'COMPETENCIA_CONOCIDA',
    nivel: 'ALERTA',
    aplica: (f) => (f.competencia || []).some((c) =>
      c.participacion === 'Todo se lo compran' || c.participacion === 'La mayor parte'),
    motivo: (f) => {
      const fuerte = (f.competencia || []).find((c) =>
        c.participacion === 'Todo se lo compran' || c.participacion === 'La mayor parte');
      return `En la visita anterior quedó que ${fuerte.competidor} se lleva ${String(fuerte.participacion).toLowerCase()} de ${fuerte.familia}` +
        `${fuerte.motivo ? `, por ${String(fuerte.motivo).toLowerCase()}` : ''}.`;
    },
    pregunta:
      '¿Sigue igual con ese proveedor o algo cambió? Si cambió, ¿qué se movió: el precio, la entrega o la relación?',
    tipo: 'texto',
  },

  // --- Cuentas compartidas y prospectos --------------------------------------
  {
    id: 'CUENTA_COMPARTIDA',
    nivel: 'INFO',
    aplica: (f) => f.metricas.cuentaCompartida && Boolean(f.metricas.agenteSecundario),
    motivo: (f) =>
      `La cuenta la trabajan dos agentes: ${f.metricas.agentePrincipal} y ${f.metricas.agenteSecundario} (${porcentaje(f.metricas.agenteSecundarioPct)}).`,
    pregunta: '¿Con quien de FACBSA trabajan habitualmente? ¿Saben que hay dos personas atendiendolos?',
    tipo: 'texto',
  },
  {
    id: 'PROSPECTO_NUEVO',
    nivel: 'ALERTA',
    aplica: (f) => f.esProspecto || f.metricas.facturacion12m === 0,
    motivo: () => 'No tiene historia de compra en el sistema: es prospecto o cuenta perdida.',
    pregunta:
      '¿Que compran hoy, a quien y que volumen mensual manejan? Es lo primero que necesitamos para saber si vale la pena.',
    tipo: 'texto',
  },
];

// Devuelve las preguntas especiales que corresponden a este cliente, ordenadas
// por criticidad y recortadas al maximo razonable.
export function preguntasEspeciales(ficha, maximo = MAX_PREGUNTAS_ESPECIALES) {
  if (!ficha) return [];
  const disparadas = [];

  for (const regla of REGLAS) {
    let aplica = false;
    try {
      aplica = Boolean(regla.aplica(ficha));
    } catch {
      // Una regla que falla por un dato faltante no puede tumbar el briefing.
      aplica = false;
    }
    if (!aplica) continue;
    disparadas.push({
      id: regla.id,
      nivel: regla.nivel,
      motivo: typeof regla.motivo === 'function' ? regla.motivo(ficha) : regla.motivo,
      pregunta: regla.pregunta,
      tipo: regla.tipo || 'texto',
      opciones: regla.opciones || null,
    });
  }

  disparadas.sort((a, b) => PRIORIDAD[a.nivel] - PRIORIDAD[b.nivel]);
  return disparadas.slice(0, maximo);
}

const ICONO = { CRITICO: '🔴', ALERTA: '🟠', OPORTUNIDAD: '🟢', INFO: 'ℹ️' };

// Texto que se le manda al vendedor ANTES de entrar, para que sepa que tiene
// que averiguar adentro.
export function formatearAvisoPreguntas(preguntas) {
  if (!preguntas.length) {
    return 'No hay nada especial para averiguar en este cliente. Con el relevamiento de rutina alcanza.';
  }
  const L = ['❗ *Averigua esto adentro* (te lo vuelvo a preguntar al salir):', ''];
  preguntas.forEach((p, i) => {
    L.push(`${ICONO[p.nivel] || '•'} *${i + 1}.* ${p.pregunta}`);
    L.push(`   _${p.motivo}_`);
    L.push('');
  });
  return L.join('\n').trim();
}
