// Maquina de estados de la conversacion.
//
// Flujo completo de una visita:
//
//   INICIO ──(escribe cliente)──> ELIGIENDO ──(elige)──┐
//      └────────────(un solo resultado)────────────────┤
//                                                      v
//                                                  EN_VISITA
//                                             (se manda la ficha +
//                                          las preguntas especiales)
//                                                      │
//                                                  (escribe FIN)
//                                                      v
//                                                  RELEVANDO
//                                            (una pregunta por vez)
//                                                      │
//                                                      v
//                                                   INICIO
//
// Todo el estado vive en la tabla `sesiones`, no en memoria: si el proceso se
// reinicia, el vendedor sigue donde estaba.
import { consultarUna, ejecutar, enTransaccion } from '../db/db.js';
import { buscarClientes, buscarVendedorPorTelefono, normalizarTelefono } from '../db/queries.js';
import { armarFicha, formatearFicha } from '../negocio/ficha-cliente.js';
import { formatearAvisoPreguntas, preguntasEspeciales } from '../negocio/preguntas-especiales.js';
import { armarCuestionario, formatearPregunta, validarRespuesta } from './cuestionario.js';
import { TEXTOS } from './textos.js';

export const ESTADOS = {
  INICIO: 'INICIO',
  ELIGIENDO: 'ELIGIENDO',
  EN_VISITA: 'EN_VISITA',
  RELEVANDO: 'RELEVANDO',
};

// --- Sesiones ----------------------------------------------------------------

function obtenerSesion(db, telefono, vendedorId) {
  let sesion = consultarUna(db, 'SELECT * FROM sesiones WHERE telefono = ?', [telefono]);
  if (!sesion) {
    ejecutar(db, 'INSERT INTO sesiones (telefono, vendedor_id, estado) VALUES (?, ?, ?)', [
      telefono,
      vendedorId,
      ESTADOS.INICIO,
    ]);
    sesion = consultarUna(db, 'SELECT * FROM sesiones WHERE telefono = ?', [telefono]);
  }
  return { ...sesion, contexto: parsearJson(sesion.contexto, {}) };
}

function guardarSesion(db, telefono, { estado, visitaId = null, contexto = {} }) {
  ejecutar(
    db,
    `UPDATE sesiones SET estado = ?, visita_id = ?, contexto = ?, actualizado_en = datetime('now')
     WHERE telefono = ?`,
    [estado, visitaId, JSON.stringify(contexto), telefono]
  );
}

function parsearJson(texto, porDefecto) {
  try {
    return JSON.parse(texto || '');
  } catch {
    return porDefecto;
  }
}

// --- Punto de entrada --------------------------------------------------------

/**
 * Procesa un mensaje entrante y devuelve la lista de mensajes a responder.
 * @param {object} db
 * @param {{telefono:string, texto?:string, tipo?:string, mediaId?:string, caption?:string, nombrePerfil?:string}} entrada
 * @returns {Array<{texto:string}>}
 */
export function procesarMensaje(db, entrada) {
  const telefono = normalizarTelefono(entrada.telefono);
  const vendedor = buscarVendedorPorTelefono(db, telefono);

  if (!vendedor) {
    return [{ texto: TEXTOS.noRegistrado(telefono) }];
  }

  const sesion = obtenerSesion(db, telefono, vendedor.id);
  const texto = String(entrada.texto || '').trim();
  const comando = texto.toUpperCase();

  // Comandos globales, validos en cualquier estado.
  if (/^(AYUDA|HELP|MENU|\?)$/.test(comando)) {
    return [{ texto: TEXTOS.ayuda }];
  }
  if (/^(CANCELAR|ANULAR)$/.test(comando)) {
    return cancelar(db, telefono, sesion);
  }
  if (/^(ESTADO|DONDE ESTOY)$/.test(comando)) {
    return estadoActual(db, sesion, vendedor);
  }
  if (/^(FICHA|DATOS|SITUACION)$/.test(comando) && sesion.visita_id) {
    return mostrarFicha(db, sesion);
  }

  switch (sesion.estado) {
    case ESTADOS.ELIGIENDO:
      return elegirCliente(db, telefono, sesion, vendedor, texto);
    case ESTADOS.EN_VISITA:
      return durantVisita(db, telefono, sesion, vendedor, texto);
    case ESTADOS.RELEVANDO:
      return responderPregunta(db, telefono, sesion, vendedor, entrada);
    case ESTADOS.INICIO:
    default:
      return declararCliente(db, telefono, sesion, vendedor, texto, entrada);
  }
}

// --- Estado INICIO: el vendedor declara a quien va a visitar -----------------

function declararCliente(db, telefono, sesion, vendedor, texto) {
  if (!texto) {
    return [{ texto: TEXTOS.bienvenida(primerNombre(vendedor.nombre)) }];
  }

  // Saludo suelto: no lo tomamos como nombre de cliente.
  if (/^(hola|buenas|buen dia|buenos dias|buenas tardes|ok|dale|si|hey)$/i.test(texto)) {
    return [{ texto: TEXTOS.bienvenida(primerNombre(vendedor.nombre)) }];
  }

  // Prospecto que no esta en el sistema.
  const nuevo = texto.match(/^(NUEVO|PROSPECTO)\s+(.+)$/i);
  if (nuevo) {
    return abrirVisita(db, telefono, vendedor, { clienteId: null, clienteTexto: nuevo[2].trim() });
  }

  const candidatos = buscarClientes(db, texto);

  if (candidatos.length === 0) {
    return [{ texto: TEXTOS.sinResultados(texto) }];
  }

  if (candidatos.length === 1) {
    return abrirVisita(db, telefono, vendedor, { clienteId: candidatos[0].id });
  }

  guardarSesion(db, telefono, {
    estado: ESTADOS.ELIGIENDO,
    contexto: { candidatos: candidatos.map((c) => c.id), busqueda: texto },
  });

  const lista = candidatos
    .map((c, i) => {
      const detalle = [c.codigo, c.segmento ? `Seg. ${c.segmento}` : null, c.localidad]
        .filter(Boolean)
        .join(' · ');
      return `*${i + 1}.* ${c.nombre}${detalle ? `\n     _${detalle}_` : ''}`;
    })
    .join('\n');

  return [{ texto: `${TEXTOS.elegirCliente}\n\n${lista}` }];
}

// --- Estado ELIGIENDO --------------------------------------------------------

function elegirCliente(db, telefono, sesion, vendedor, texto) {
  if (/^(OTRO|OTRA|BUSCAR|NO)$/i.test(texto)) {
    guardarSesion(db, telefono, { estado: ESTADOS.INICIO, contexto: {} });
    return [{ texto: TEXTOS.pedirCliente }];
  }

  const candidatos = sesion.contexto.candidatos || [];
  const numero = Number(texto);

  if (!Number.isInteger(numero) || numero < 1 || numero > candidatos.length) {
    // Puede ser que en vez de elegir haya escrito otro nombre: buscamos de nuevo.
    if (texto.length >= 3 && !/^\d+$/.test(texto)) {
      guardarSesion(db, telefono, { estado: ESTADOS.INICIO, contexto: {} });
      return declararCliente(db, telefono, { ...sesion, estado: ESTADOS.INICIO }, vendedor, texto);
    }
    return [{ texto: `Elegí un número del 1 al ${candidatos.length}, o escribí OTRO para buscar de nuevo.` }];
  }

  return abrirVisita(db, telefono, vendedor, { clienteId: candidatos[numero - 1] });
}

// --- Apertura de la visita: aca se manda la ficha y el briefing --------------

function abrirVisita(db, telefono, vendedor, { clienteId, clienteTexto = null }) {
  const ficha = clienteId ? armarFicha(db, clienteId) : null;
  const especiales = ficha
    ? preguntasEspeciales(ficha)
    : preguntasEspeciales(fichaVacia(clienteTexto));

  const visitaId = enTransaccion(db, () => {
    const res = ejecutar(
      db,
      `INSERT INTO visitas (vendedor_id, cliente_id, cliente_texto, es_prospecto, estado,
                            iniciada_en, ficha_snapshot, preguntas_especiales)
       VALUES (?, ?, ?, ?, 'EN_CURSO', datetime('now'), ?, ?)`,
      [
        vendedor.id,
        clienteId,
        clienteTexto || ficha?.cliente.nombre || null,
        clienteId ? 0 : 1,
        ficha ? JSON.stringify(ficha) : null,
        JSON.stringify(especiales),
      ]
    );
    return Number(res.lastInsertRowid);
  });

  guardarSesion(db, telefono, {
    estado: ESTADOS.EN_VISITA,
    visitaId,
    contexto: { especiales },
  });

  const salida = [];

  if (ficha) {
    salida.push({ texto: formatearFicha(ficha) });
  } else {
    salida.push({
      texto:
        `📋 *${clienteTexto}* — cliente nuevo\n\n` +
        'No está en el sistema, así que no tengo historia de compra. Lo cargo como prospecto.',
    });
  }

  salida.push({ texto: formatearAvisoPreguntas(especiales) });
  salida.push({ texto: TEXTOS.enVisita });

  return salida;
}

function fichaVacia(nombre) {
  return {
    cliente: { id: null, codigo: null, nombre, canal: null },
    metricas: {
      facturacion12m: 0,
      variacionTrim: null,
      participacion: 0,
      segmento: null,
      diasSinComprar: null,
      jabalinas: 0,
      tomacables: 0,
      ratioTomacables: null,
      gapTomacablesU: 0,
      gapTomacablesPesos: 0,
      cuentaCompartida: false,
      agenteSecundario: null,
    },
    familias: [],
    esProspecto: true,
    alertas: [],
    ultimasVisitas: [],
  };
}

// --- Estado EN_VISITA: esperando que salga -----------------------------------

function durantVisita(db, telefono, sesion, vendedor, texto) {
  if (/^(FIN|LISTO|TERMINE|TERMINÉ|SALI|SALÍ|YA ESTA|YA ESTÁ|FINALIZAR)$/i.test(texto.trim())) {
    return arrancarRelevamiento(db, telefono, sesion);
  }

  const visita = consultarUna(db, 'SELECT * FROM visitas WHERE id = ?', [sesion.visita_id]);
  return [{ texto: TEXTOS.visitaAbierta(visita?.cliente_texto || 'el cliente') }];
}

function mostrarFicha(db, sesion) {
  const visita = consultarUna(db, 'SELECT * FROM visitas WHERE id = ?', [sesion.visita_id]);
  const ficha = parsearJson(visita?.ficha_snapshot, null);
  if (!ficha) return [{ texto: 'De este cliente no tengo ficha cargada.' }];
  const especiales = parsearJson(visita?.preguntas_especiales, []);
  return [{ texto: formatearFicha(ficha) }, { texto: formatearAvisoPreguntas(especiales) }];
}

// --- Estado RELEVANDO --------------------------------------------------------

function arrancarRelevamiento(db, telefono, sesion) {
  const visita = consultarUna(db, 'SELECT * FROM visitas WHERE id = ?', [sesion.visita_id]);
  const especiales = parsearJson(visita?.preguntas_especiales, []);
  const preguntas = armarCuestionario(especiales);

  guardarSesion(db, telefono, {
    estado: ESTADOS.RELEVANDO,
    visitaId: sesion.visita_id,
    contexto: { preguntas, indice: 0 },
  });

  return [
    { texto: TEXTOS.arrancaRelevamiento(preguntas.length) },
    { texto: formatearPregunta(preguntas[0], 1, preguntas.length) },
  ];
}

function responderPregunta(db, telefono, sesion, vendedor, entrada) {
  const preguntas = sesion.contexto.preguntas || [];
  const indice = sesion.contexto.indice || 0;
  const pregunta = preguntas[indice];

  if (!pregunta) {
    return cerrarVisita(db, telefono, sesion);
  }

  const validacion = validarRespuesta(pregunta, entrada);
  if (!validacion.ok) {
    return [
      { texto: `⚠️ ${validacion.error}` },
      { texto: formatearPregunta(pregunta, indice + 1, preguntas.length) },
    ];
  }

  ejecutar(
    db,
    `INSERT INTO respuestas (visita_id, pregunta_id, pregunta_texto, origen, regla_id,
                             respuesta, respuesta_valor, media_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sesion.visita_id,
      pregunta.id,
      pregunta.texto,
      pregunta.origen,
      pregunta.reglaId,
      validacion.respuesta,
      validacion.valor,
      entrada.mediaId || null,
    ]
  );

  const siguiente = indice + 1;

  if (siguiente >= preguntas.length) {
    return cerrarVisita(db, telefono, { ...sesion, contexto: { preguntas, indice: siguiente } });
  }

  guardarSesion(db, telefono, {
    estado: ESTADOS.RELEVANDO,
    visitaId: sesion.visita_id,
    contexto: { preguntas, indice: siguiente },
  });

  return [{ texto: formatearPregunta(preguntas[siguiente], siguiente + 1, preguntas.length) }];
}

function cerrarVisita(db, telefono, sesion) {
  const visita = consultarUna(db, 'SELECT * FROM visitas WHERE id = ?', [sesion.visita_id]);

  ejecutar(
    db,
    `UPDATE visitas SET estado = 'COMPLETA', cerrada_en = datetime('now') WHERE id = ?`,
    [sesion.visita_id]
  );

  guardarSesion(db, telefono, { estado: ESTADOS.INICIO, visitaId: null, contexto: {} });

  return [
    { texto: resumenVisita(db, sesion.visita_id) },
    { texto: TEXTOS.cierre(visita?.cliente_texto || 'el cliente') },
  ];
}

// Resumen que se le devuelve al vendedor: sirve de comprobante y de control.
function resumenVisita(db, visitaId) {
  const filas = db
    .prepare(
      `SELECT pregunta_id, pregunta_texto, respuesta, origen FROM respuestas
       WHERE visita_id = ? ORDER BY id`
    )
    .all(visitaId);

  const L = ['📝 *Resumen de lo que cargaste*', ''];
  for (const f of filas) {
    const marca = f.origen === 'especial' ? '❗' : '•';
    L.push(`${marca} ${acortar(f.pregunta_texto, 60)}`);
    L.push(`   → ${f.respuesta || '(sin respuesta)'}`);
  }
  return L.join('\n');
}

function acortar(texto, largo) {
  const t = String(texto || '');
  return t.length <= largo ? t : `${t.slice(0, largo - 1)}…`;
}

// --- Comandos globales -------------------------------------------------------

function cancelar(db, telefono, sesion) {
  if (!sesion.visita_id) {
    guardarSesion(db, telefono, { estado: ESTADOS.INICIO, visitaId: null, contexto: {} });
    return [{ texto: TEXTOS.nadaQueCancelar }];
  }
  ejecutar(
    db,
    `UPDATE visitas SET estado = 'CANCELADA', cerrada_en = datetime('now') WHERE id = ?`,
    [sesion.visita_id]
  );
  guardarSesion(db, telefono, { estado: ESTADOS.INICIO, visitaId: null, contexto: {} });
  return [{ texto: TEXTOS.cancelado }];
}

function estadoActual(db, sesion, vendedor) {
  if (sesion.estado === ESTADOS.INICIO) {
    return [{ texto: `${primerNombre(vendedor.nombre)}, no tenés ninguna visita abierta.\n\n${TEXTOS.pedirCliente}` }];
  }
  const visita = sesion.visita_id
    ? consultarUna(db, 'SELECT * FROM visitas WHERE id = ?', [sesion.visita_id])
    : null;

  if (sesion.estado === ESTADOS.EN_VISITA) {
    return [{ texto: TEXTOS.visitaAbierta(visita?.cliente_texto || 'el cliente') }];
  }
  if (sesion.estado === ESTADOS.RELEVANDO) {
    const preguntas = sesion.contexto.preguntas || [];
    const indice = sesion.contexto.indice || 0;
    return [
      {
        texto:
          `Estás cargando el relevamiento de *${visita?.cliente_texto || 'el cliente'}*.\n` +
          `Vas por la pregunta ${indice + 1} de ${preguntas.length}.`,
      },
      preguntas[indice]
        ? { texto: formatearPregunta(preguntas[indice], indice + 1, preguntas.length) }
        : { texto: TEXTOS.ayuda },
    ];
  }
  return [{ texto: TEXTOS.pedirCliente }];
}

function primerNombre(nombre) {
  return String(nombre || '').split(' ')[0] || '';
}
