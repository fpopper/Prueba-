// Capa entre el transporte (WhatsApp o simulador) y el cerebro del bot.
//
// Responsabilidades:
//   - identificar al vendedor por su telefono
//   - transcribir las notas de voz antes de que las lea el agente
//   - elegir el modo: agente conversacional si hay clave de Claude, o el flujo
//     guiado (pregunta por pregunta) si no la hay
//   - log de mensajes e idempotencia, porque la Cloud API reintenta el webhook
import { config, iaConfigurada } from '../config.js';
import { consultarUna, ejecutar } from '../db/db.js';
import { buscarVendedorPorTelefono, normalizarTelefono } from '../db/queries.js';
import { conversar, olvidarConversacion } from '../ia/agente.js';
import { ErrorTranscripcion, transcribir, transcripcionDisponible } from '../ia/transcribir.js';
import { descargarMedia } from '../whatsapp/meta.js';
import { procesarMensaje } from './maquina-estados.js';
import { TEXTOS } from './textos.js';

export function yaProcesado(db, waMessageId) {
  if (!waMessageId) return false;
  return Boolean(
    consultarUna(db, 'SELECT 1 AS x FROM mensajes_procesados WHERE wa_message_id = ?', [waMessageId])
  );
}

export function marcarProcesado(db, waMessageId) {
  if (!waMessageId) return;
  ejecutar(db, 'INSERT OR IGNORE INTO mensajes_procesados (wa_message_id) VALUES (?)', [waMessageId]);
}

function registrar(db, telefono, direccion, { tipo = 'text', texto = '', payload = null, waMessageId = null }) {
  ejecutar(
    db,
    `INSERT INTO mensajes (telefono, direccion, tipo, texto, payload, wa_message_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [telefono, direccion, tipo, texto, payload ? JSON.stringify(payload) : null, waMessageId]
  );
}

export function modoActual() {
  return iaConfigurada ? 'agente' : 'guiado';
}

// --- Sesion ------------------------------------------------------------------

function obtenerSesion(db, telefono, vendedorId) {
  let sesion = consultarUna(db, 'SELECT * FROM sesiones WHERE telefono = ?', [telefono]);
  if (!sesion) {
    ejecutar(db, 'INSERT INTO sesiones (telefono, vendedor_id, estado) VALUES (?, ?, ?)', [
      telefono,
      vendedorId,
      'INICIO',
    ]);
    sesion = consultarUna(db, 'SELECT * FROM sesiones WHERE telefono = ?', [telefono]);
  }
  return sesion;
}

// La visita en curso se guarda en la sesion para que el agente la encuentre
// aunque se reinicie el servidor a mitad de una conversacion.
function guardarVisitaEnSesion(db, telefono, visitaId) {
  ejecutar(
    db,
    `UPDATE sesiones SET visita_id = ?, estado = ?, actualizado_en = datetime('now')
     WHERE telefono = ?`,
    [visitaId, visitaId ? 'EN_VISITA' : 'INICIO', telefono]
  );
}

// --- Audio -------------------------------------------------------------------

/**
 * Convierte una nota de voz en texto. Devuelve el texto transcripto o un
 * mensaje de error para mandarle al vendedor.
 */
async function textoDelAudio(db, entrada, telefono, visitaId) {
  if (!transcripcionDisponible()) {
    return {
      error:
        'Me llegó tu audio pero todavía no tengo habilitada la transcripción. ' +
        'Contámelo por escrito y lo cargo igual.',
    };
  }

  // El simulador manda el audio directo; WhatsApp manda un id para descargarlo.
  let archivo = entrada.audio
    ? { buffer: entrada.audio, mime: entrada.mimeAudio || 'audio/ogg' }
    : await descargarMedia(entrada.mediaId);

  if (!archivo?.buffer?.length) {
    return { error: 'No pude bajar el audio. ¿Me lo mandás de nuevo?' };
  }

  try {
    const { texto, proveedor } = await transcribir(archivo.buffer, archivo.mime);
    ejecutar(
      db,
      `INSERT INTO transcripciones (visita_id, telefono, media_id, texto, proveedor)
       VALUES (?, ?, ?, ?, ?)`,
      [visitaId, telefono, entrada.mediaId || null, texto, proveedor]
    );

    if (!texto) {
      return { error: 'El audio me llegó, pero no se entendió nada. ¿Lo repetís?' };
    }
    return { texto };
  } catch (error) {
    if (error instanceof ErrorTranscripcion) {
      console.error('[gestor] transcripcion:', error.message);
      return { error: 'No pude escuchar bien el audio. ¿Me lo contás por escrito?' };
    }
    throw error;
  }
}

// --- Punto de entrada --------------------------------------------------------

/**
 * Atiende un mensaje entrante y devuelve las respuestas a mandar.
 * Nunca lanza: si algo falla, responde con un mensaje de error y lo loguea.
 */
export async function atenderMensaje(db, entrada) {
  const telefono = normalizarTelefono(entrada.telefono);

  if (yaProcesado(db, entrada.waMessageId)) return [];

  registrar(db, telefono, 'entrante', {
    tipo: entrada.tipo || 'text',
    texto: entrada.texto || '',
    payload: { ...entrada, audio: undefined },
    waMessageId: entrada.waMessageId,
  });

  let respuestas;
  try {
    respuestas = await atender(db, telefono, entrada);
  } catch (error) {
    console.error('[gestor] error procesando mensaje:', error);
    respuestas = [{ texto: TEXTOS.errorInterno }];
  }

  for (const r of respuestas) {
    registrar(db, telefono, 'saliente', { texto: r.texto, payload: r.botones || r.lista || null });
  }

  marcarProcesado(db, entrada.waMessageId);
  return respuestas;
}

async function atender(db, telefono, entrada) {
  const vendedor = buscarVendedorPorTelefono(db, telefono);
  if (!vendedor) return [{ texto: TEXTOS.noRegistrado(telefono) }];

  const sesion = obtenerSesion(db, telefono, vendedor.id);

  // Un audio se transcribe siempre antes de decidir el modo: el resto del
  // sistema trabaja con texto.
  let entradaEfectiva = entrada;
  if (entrada.esAudio || entrada.tipo === 'audio') {
    const { texto, error } = await textoDelAudio(db, entrada, telefono, sesion.visita_id);
    if (error) return [{ texto: error }];
    entradaEfectiva = { ...entrada, texto, tipo: 'text', transcripto: true };
  }

  if (!iaConfigurada) {
    // Modo guiado: sin clave de Claude, el bot pregunta de a una.
    return procesarMensaje(db, { ...entradaEfectiva, telefono });
  }

  return atenderConAgente(db, telefono, vendedor, sesion, entradaEfectiva);
}

async function atenderConAgente(db, telefono, vendedor, sesion, entrada) {
  const contexto = {
    telefono,
    vendedorId: vendedor.id,
    vendedorNombre: vendedor.nombre,
    visitaId: sesion.visita_id || null,
  };

  const texto = construirEntrada(entrada);

  // Comando de escape para soporte: reinicia la charla sin borrar las visitas.
  if (/^\s*(reiniciar|empezar de cero)\s*$/i.test(texto)) {
    olvidarConversacion(db, telefono);
    guardarVisitaEnSesion(db, telefono, null);
    return [{ texto: `Listo ${vendedor.nombre.split(' ')[0]}, arrancamos de nuevo. ¿A qué cliente vas?` }];
  }

  const respuestas = await conversar(db, contexto, texto);

  // El agente puede haber abierto o cerrado una visita: lo persistimos.
  if ((sesion.visita_id || null) !== contexto.visitaId) {
    guardarVisitaEnSesion(db, telefono, contexto.visitaId);
  }

  return respuestas.length
    ? respuestas
    : [{ texto: 'Perdón, se me cruzaron los cables. ¿Me lo repetís?' }];
}

// Lo que ve el modelo como turno del vendedor. Le marcamos si vino de un audio
// o de un boton, porque cambia como tiene que interpretarlo.
function construirEntrada(entrada) {
  if (entrada.transcripto) {
    return `[el vendedor mandó un audio, esto es la transcripción]\n${entrada.texto}`;
  }
  if (entrada.tipo === 'image') {
    return `[el vendedor mandó una foto${entrada.caption ? `, con el texto: ${entrada.caption}` : ''}]`;
  }
  if (entrada.opcionId) {
    return `[tocó el botón] ${entrada.texto}`;
  }
  return entrada.texto || '';
}
