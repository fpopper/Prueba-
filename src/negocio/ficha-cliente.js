// Arma la "situacion del cliente": lo que el vendedor necesita saber ANTES de
// entrar. Devuelve un objeto con los datos crudos (que se guarda como snapshot
// en la visita) y el texto formateado para WhatsApp.
import {
  familiasDelCliente,
  obtenerCliente,
  obtenerMetricas,
  contextoEmpresa,
  ultimasVisitas,
} from '../db/queries.js';
import {
  CAIDA_CHURN,
  CONCENTRACION_ALERTA,
  CONCENTRACION_CRITICA,
  DIAS_INACTIVO,
  DIAS_INACTIVO_GRAVE,
  RATIO_TOMACABLES_OBJETIVO,
  pesos,
  porcentaje,
  unidades,
} from './reglas.js';

export function armarFicha(db, clienteId) {
  const cliente = obtenerCliente(db, clienteId);
  if (!cliente) return null;

  const m = obtenerMetricas(db, clienteId) || {};
  const familias = familiasDelCliente(db, clienteId);
  const empresa = contextoEmpresa(db);
  const visitas = ultimasVisitas(db, clienteId);

  const variacionAnual = variacion(m.facturacion_12m, m.facturacion_12m_prev);
  const variacionTrim = variacion(m.facturacion_trim, m.facturacion_trim_prev);

  const ficha = {
    cliente: {
      id: cliente.id,
      codigo: cliente.codigo,
      nombre: cliente.nombre,
      canal: cliente.canal,
      localidad: cliente.localidad,
      provincia: cliente.provincia,
    },
    metricas: {
      facturacion12m: Number(m.facturacion_12m || 0),
      facturacion12mPrev: Number(m.facturacion_12m_prev || 0),
      facturacionTrim: Number(m.facturacion_trim || 0),
      facturacionTrimPrev: Number(m.facturacion_trim_prev || 0),
      variacionAnual,
      variacionTrim,
      participacion: Number(m.participacion || 0),
      ranking: m.ranking ?? null,
      segmento: m.segmento || null,
      modeloAtencion: m.modelo_atencion || null,
      ultimaCompra: m.ultima_compra || null,
      diasSinComprar: m.dias_sin_comprar ?? null,
      operaciones12m: Number(m.operaciones_12m || 0),
      ticketPromedio: Number(m.ticket_promedio || 0),
      jabalinas: Number(m.jabalinas_12m || 0),
      tomacables: Number(m.tomacables_12m || 0),
      ratioTomacables: m.ratio_tomacables ?? null,
      gapTomacablesU: Number(m.gap_tomacables_u || 0),
      gapTomacablesPesos: Number(m.gap_tomacables_pesos || 0),
      agentePrincipal: m.agente_principal || null,
      agenteSecundario: m.agente_secundario || null,
      agenteSecundarioPct: m.agente_secundario_pct ?? null,
      cuentaCompartida: Boolean(m.cuenta_compartida),
    },
    familias: familias.map((f) => ({
      familia: f.familia,
      cantidad: Number(f.cantidad_12m || 0),
      importe: Number(f.importe_12m || 0),
    })),
    empresa,
    ultimasVisitas: visitas,
    esProspecto: !m.cliente_id,
  };

  ficha.alertas = detectarAlertas(ficha);
  return ficha;
}

function variacion(actual, previo) {
  const a = Number(actual || 0);
  const p = Number(previo || 0);
  if (p === 0) return a > 0 ? null : 0; // sin base de comparacion
  return (a - p) / p;
}

// Alertas que van arriba de todo en el briefing: son las que cambian la
// conversacion que el vendedor tiene que tener adentro del cliente.
function detectarAlertas(ficha) {
  const alertas = [];
  const m = ficha.metricas;

  if (m.participacion >= CONCENTRACION_CRITICA) {
    alertas.push({
      nivel: 'CRITICO',
      texto: `Esta cuenta es el ${porcentaje(m.participacion)} de la facturacion total de FACBSA. Perderla seria un golpe estructural.`,
    });
  } else if (m.participacion >= CONCENTRACION_ALERTA) {
    alertas.push({
      nivel: 'ALERTA',
      texto: `Cuenta de alta concentracion: ${porcentaje(m.participacion)} del total de la empresa.`,
    });
  }

  if (m.segmento === 'A' && m.variacionTrim !== null && m.variacionTrim <= -CAIDA_CHURN) {
    alertas.push({
      nivel: 'CRITICO',
      texto: `Riesgo de churn: cuenta clave con caida de ${porcentaje(Math.abs(m.variacionTrim))} en el ultimo trimestre.`,
    });
  }

  if (m.diasSinComprar !== null && m.diasSinComprar >= DIAS_INACTIVO_GRAVE) {
    alertas.push({
      nivel: 'CRITICO',
      texto: `Sin comprar hace ${m.diasSinComprar} dias. Cuenta practicamente perdida.`,
    });
  } else if (m.diasSinComprar !== null && m.diasSinComprar >= DIAS_INACTIVO) {
    alertas.push({
      nivel: 'ALERTA',
      texto: `Sin comprar hace ${m.diasSinComprar} dias.`,
    });
  }

  if (m.gapTomacablesPesos > 0) {
    alertas.push({
      nivel: 'OPORTUNIDAD',
      texto: `Gap de tomacables estimado: ${unidades(m.gapTomacablesU)} u. ≈ ${pesos(m.gapTomacablesPesos)}.`,
    });
  }

  if (m.cuentaCompartida && m.agenteSecundario) {
    alertas.push({
      nivel: 'INFO',
      texto: `Cuenta compartida: ${m.agenteSecundario} tiene el ${porcentaje(m.agenteSecundarioPct)} de la facturacion.`,
    });
  }

  return alertas;
}

const ICONO_NIVEL = {
  CRITICO: '🔴',
  ALERTA: '🟠',
  OPORTUNIDAD: '🟢',
  INFO: 'ℹ️',
};

// --- Formato para WhatsApp ---------------------------------------------------

export function formatearFicha(ficha) {
  if (!ficha) return '';
  const m = ficha.metricas;
  const c = ficha.cliente;
  const L = [];

  L.push(`📋 *${c.nombre}*`);
  const ubicacion = [c.localidad, c.provincia].filter(Boolean).join(', ');
  const cabecera = [c.codigo ? `Cod. ${c.codigo}` : null, c.canal, ubicacion]
    .filter(Boolean)
    .join(' · ');
  if (cabecera) L.push(`_${cabecera}_`);
  L.push('');

  if (m.segmento) {
    const rank = m.ranking ? ` · #${m.ranking} del ranking` : '';
    // modeloAtencion viene como "CLAVE — detalle largo"; en el chat solo entra
    // la etiqueta, el detalle es para el reporte de oficina.
    const modelo = String(m.modeloAtencion || '').split(' — ')[0];
    L.push(`*Segmento ${m.segmento}* — ${modelo}${rank}`);
  }

  L.push(
    `💰 Facturacion 12m: *${pesos(m.facturacion12m)}*` +
      (m.participacion ? ` (${porcentaje(m.participacion, 1)} del total)` : '')
  );

  if (m.variacionAnual !== null) {
    L.push(`${flechaVariacion(m.variacionAnual)} vs 12m anteriores: ${porcentaje(m.variacionAnual)}`);
  }
  if (m.variacionTrim !== null) {
    L.push(`${flechaVariacion(m.variacionTrim)} ultimo trimestre: ${porcentaje(m.variacionTrim)}`);
  }

  if (m.ultimaCompra) {
    L.push(`🗓️ Ultima compra: ${formatearFecha(m.ultimaCompra)} (hace ${m.diasSinComprar} dias)`);
  } else {
    L.push('🗓️ Sin compras registradas en el periodo.');
  }

  if (m.operaciones12m) {
    L.push(`🧾 ${m.operaciones12m} operaciones · ticket promedio ${pesos(m.ticketPromedio)}`);
  }

  if (m.agentePrincipal) {
    L.push(`👤 Atiende: ${m.agentePrincipal}`);
  }

  // Que compra y que no compra: es lo que dispara la charla de cross-selling.
  if (ficha.familias.length) {
    L.push('');
    L.push('*Que compra:*');
    for (const f of ficha.familias.slice(0, 5)) {
      L.push(`• ${f.familia}: ${pesos(f.importe)}`);
    }
  }

  if (m.jabalinas >= 1) {
    const ratioTxt =
      m.ratioTomacables === null ? 'sin dato' : porcentaje(m.ratioTomacables);
    L.push('');
    L.push(
      `🔩 Jabalinas ${unidades(m.jabalinas)} u. · Tomacables ${unidades(m.tomacables)} u. ` +
        `(ratio ${ratioTxt}, objetivo ${porcentaje(RATIO_TOMACABLES_OBJETIVO)})`
    );
  }

  if (ficha.alertas.length) {
    L.push('');
    L.push('*Atencion:*');
    for (const a of ficha.alertas) {
      L.push(`${ICONO_NIVEL[a.nivel] || '•'} ${a.texto}`);
    }
  }

  if (ficha.ultimasVisitas.length) {
    const u = ficha.ultimasVisitas[0];
    L.push('');
    L.push(`🕘 Ultima visita relevada: ${formatearFecha(u.cerrada_en)} por ${u.vendedor}`);
  }

  return L.join('\n');
}

// Una variacion de medio punto o menos no es una tendencia: no le ponemos flecha.
function flechaVariacion(valor) {
  if (Math.abs(valor) < 0.005) return '▬';
  return valor > 0 ? '▲' : '▼';
}

export function formatearFecha(iso) {
  if (!iso) return '-';
  const soloFecha = String(iso).slice(0, 10);
  const [a, m, d] = soloFecha.split('-');
  if (!a || !m || !d) return String(iso);
  return `${d}/${m}/${a}`;
}
