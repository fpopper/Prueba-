// Capa entre el transporte (WhatsApp o simulador) y la maquina de estados.
// Se encarga del log de mensajes y de que un mismo mensaje no se procese dos
// veces: la Cloud API reintenta el webhook si tarda en responder.
import { consultarUna, ejecutar } from '../db/db.js';
import { normalizarTelefono } from '../db/queries.js';
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
  ejecutar(db, 'INSERT OR IGNORE INTO mensajes_procesados (wa_message_id) VALUES (?)', [
    waMessageId,
  ]);
}

function registrar(db, telefono, direccion, { tipo = 'text', texto = '', payload = null, waMessageId = null }) {
  ejecutar(
    db,
    `INSERT INTO mensajes (telefono, direccion, tipo, texto, payload, wa_message_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [telefono, direccion, tipo, texto, payload ? JSON.stringify(payload) : null, waMessageId]
  );
}

/**
 * Atiende un mensaje entrante y devuelve las respuestas a mandar.
 * Nunca lanza: si algo falla, responde con un mensaje de error y lo loguea.
 */
export function atenderMensaje(db, entrada) {
  const telefono = normalizarTelefono(entrada.telefono);

  if (yaProcesado(db, entrada.waMessageId)) return [];

  registrar(db, telefono, 'entrante', {
    tipo: entrada.tipo || 'text',
    texto: entrada.texto || '',
    payload: entrada,
    waMessageId: entrada.waMessageId,
  });

  let respuestas;
  try {
    respuestas = procesarMensaje(db, { ...entrada, telefono });
  } catch (error) {
    console.error('[gestor] error procesando mensaje:', error);
    respuestas = [{ texto: TEXTOS.errorInterno }];
  }

  for (const r of respuestas) {
    registrar(db, telefono, 'saliente', { texto: r.texto });
  }

  marcarProcesado(db, entrada.waMessageId);
  return respuestas;
}
