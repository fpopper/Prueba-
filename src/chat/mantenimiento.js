// Tareas de mantenimiento sobre las visitas abiertas.
//
// Un vendedor abre una visita y no siempre la cierra: se le acaba el dia, se
// queda sin señal, entra a otro cliente. Dos reglas, definidas por Comercial:
//
//   1. A las pocas horas se le recuerda que la tiene abierta (una sola vez).
//   2. Al final del dia, la visita se cierra sola como INCOMPLETA con lo que
//      alcanzo a cargar. Nada de lo relevado se pierde, y el panel las muestra
//      aparte para que la oficina sepa cuales quedaron a medias.
import { consultar, ejecutar } from '../db/db.js';

export const HORAS_PARA_RECORDAR = 3;
export const HORAS_PARA_CERRAR = 12;

/** Visitas abiertas hace mas de N horas a las que todavia no se les recordo. */
export function visitasParaRecordar(db, horas = HORAS_PARA_RECORDAR) {
  return consultar(
    db,
    `SELECT v.id, v.cliente_texto, s.telefono
     FROM visitas v
     JOIN vendedores ve ON ve.id = v.vendedor_id
     LEFT JOIN sesiones s ON s.visita_id = v.id
     WHERE v.estado = 'EN_CURSO'
       AND v.recordatorio_en IS NULL
       AND v.iniciada_en <= datetime('now', ?)`,
    [`-${Number(horas)} hours`]
  );
}

export function marcarRecordada(db, visitaId) {
  ejecutar(db, "UPDATE visitas SET recordatorio_en = datetime('now') WHERE id = ?", [visitaId]);
}

/**
 * Cierra como INCOMPLETA lo que quedo abierto demasiado tiempo.
 * @returns {number} cuantas se cerraron
 */
export function cerrarVisitasAbandonadas(db, horas = HORAS_PARA_CERRAR) {
  const abiertas = consultar(
    db,
    `SELECT id FROM visitas
     WHERE estado = 'EN_CURSO' AND iniciada_en <= datetime('now', ?)`,
    [`-${Number(horas)} hours`]
  );

  for (const v of abiertas) {
    ejecutar(
      db,
      "UPDATE visitas SET estado = 'INCOMPLETA', cerrada_en = datetime('now') WHERE id = ?",
      [v.id]
    );
    // El vendedor queda libre para arrancar la proxima visita.
    ejecutar(
      db,
      "UPDATE sesiones SET visita_id = NULL, estado = 'INICIO' WHERE visita_id = ?",
      [v.id]
    );
  }

  return abiertas.length;
}

/** Texto del recordatorio. Se manda dentro de las 24 h, no necesita plantilla. */
export function textoRecordatorio(cliente) {
  return (
    `Che, tenés la visita de *${cliente}* abierta desde hace un rato. ` +
    'Si ya saliste, contame cómo te fue y la cierro.'
  );
}
