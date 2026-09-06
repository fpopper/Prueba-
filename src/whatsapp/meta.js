// Cliente de la WhatsApp Cloud API de Meta.
//
// Responsabilidades:
//   1. validar que el webhook viene realmente de Meta (firma HMAC)
//   2. normalizar los mensajes entrantes (texto, audio, foto, botones)
//   3. mandar las respuestas, incluyendo botoneras y listas
//   4. descargar los audios que manda el vendedor
import crypto from 'node:crypto';
import { config, whatsappConfigurado } from '../config.js';

const BASE = 'https://graph.facebook.com';

// Limites de la API de Meta. Si se pasan, rechaza el mensaje entero.
export const LIMITES = {
  cuerpoInteractivo: 1024,
  tituloBoton: 20,
  tituloFila: 24,
  descripcionFila: 72,
  botones: 3,
  filas: 10,
  texto: 4096,
};

// Meta firma cada webhook con el App Secret. Sin esta validacion cualquiera que
// conozca la URL puede inyectar visitas falsas en la base.
export function firmaValida(cuerpoCrudo, cabeceraFirma) {
  if (!config.whatsapp.appSecret) return true; // sin secreto configurado no se valida
  if (!cabeceraFirma) return false;

  const esperada = `sha256=${crypto
    .createHmac('sha256', config.whatsapp.appSecret)
    .update(cuerpoCrudo)
    .digest('hex')}`;

  const a = Buffer.from(esperada);
  const b = Buffer.from(String(cabeceraFirma));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Extrae de la estructura anidada de Meta los mensajes que nos interesan.
export function extraerMensajes(cuerpo) {
  const mensajes = [];
  for (const entrada of cuerpo?.entry || []) {
    for (const cambio of entrada?.changes || []) {
      const valor = cambio?.value;
      if (!valor?.messages) continue;
      const perfiles = new Map((valor.contacts || []).map((c) => [c.wa_id, c.profile?.name]));

      for (const m of valor.messages) {
        const respuestaBoton = m.interactive?.button_reply || m.interactive?.list_reply;
        mensajes.push({
          waMessageId: m.id,
          telefono: m.from,
          nombrePerfil: perfiles.get(m.from) || null,
          tipo: m.type,
          texto:
            m.text?.body ||
            m.button?.text ||
            respuestaBoton?.title ||
            m.image?.caption ||
            '',
          // Cuando contesta con un boton, el id es la respuesta sin ambigüedad.
          opcionId: respuestaBoton?.id || null,
          caption: m.image?.caption || null,
          mediaId: m.audio?.id || m.image?.id || m.document?.id || m.video?.id || null,
          esAudio: m.type === 'audio',
          esNotaDeVoz: Boolean(m.audio?.voice),
          mimeAudio: m.audio?.mime_type || null,
          latitud: m.location?.latitude ?? null,
          longitud: m.location?.longitude ?? null,
        });
      }
    }
  }
  return mensajes;
}

// --- Envio -------------------------------------------------------------------

async function llamar(cuerpo) {
  if (!whatsappConfigurado) {
    console.warn('[whatsapp] sin credenciales, no se envia:', JSON.stringify(cuerpo).slice(0, 120));
    return null;
  }
  const url = `${BASE}/${config.whatsapp.version}/${config.whatsapp.phoneNumberId}/messages`;
  const respuesta = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.whatsapp.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...cuerpo }),
  });

  if (!respuesta.ok) {
    console.error('[whatsapp] error al enviar:', respuesta.status, await respuesta.text());
    return null;
  }
  return respuesta.json();
}

function recortar(texto, largo) {
  const t = String(texto ?? '');
  return t.length <= largo ? t : `${t.slice(0, largo - 1)}…`;
}

export async function enviarTexto(telefono, texto) {
  return llamar({
    recipient_type: 'individual',
    to: telefono,
    type: 'text',
    text: { preview_url: false, body: recortar(texto, LIMITES.texto) },
  });
}

/**
 * Manda un mensaje del bot. Segun lo que traiga:
 *   { texto }                     -> mensaje de texto
 *   { texto, botones: [...] }     -> botonera (hasta 3)
 *   { texto, lista: {...} }       -> lista desplegable (hasta 10)
 *
 * El cuerpo de un mensaje interactivo no puede pasar de 1024 caracteres. Si el
 * texto es mas largo (por ejemplo la ficha del cliente), se manda primero como
 * texto suelto y despues la botonera con una linea corta.
 */
export async function enviarMensaje(telefono, mensaje) {
  const opciones = mensaje.botones || mensaje.lista?.filas;

  if (!opciones?.length) {
    return enviarTexto(telefono, mensaje.texto);
  }

  let cuerpo = mensaje.texto;
  if (cuerpo.length > LIMITES.cuerpoInteractivo) {
    await enviarTexto(telefono, cuerpo);
    cuerpo = 'Elegí una opción 👇';
  }

  if (mensaje.botones) {
    return llamar({
      to: telefono,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: cuerpo },
        action: {
          buttons: mensaje.botones.slice(0, LIMITES.botones).map((b) => ({
            type: 'reply',
            reply: { id: b.id, title: recortar(b.titulo, LIMITES.tituloBoton) },
          })),
        },
      },
    });
  }

  return llamar({
    to: telefono,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: cuerpo },
      action: {
        button: recortar(mensaje.lista.boton || 'Elegir', LIMITES.tituloBoton),
        sections: [
          {
            title: 'Opciones',
            rows: mensaje.lista.filas.slice(0, LIMITES.filas).map((f) => ({
              id: f.id,
              title: recortar(f.titulo, LIMITES.tituloFila),
              ...(f.descripcion ? { description: recortar(f.descripcion, LIMITES.descripcionFila) } : {}),
            })),
          },
        ],
      },
    },
  });
}

// --- Descarga de audios ------------------------------------------------------

/**
 * Baja un archivo que mando el vendedor. Meta lo entrega en dos pasos: primero
 * se pide la URL con el media id, despues se descarga con el mismo token.
 * @returns {Promise<{buffer: Buffer, mime: string} | null>}
 */
export async function descargarMedia(mediaId) {
  if (!whatsappConfigurado || !mediaId) return null;

  const cabeceras = { Authorization: `Bearer ${config.whatsapp.token}` };

  const meta = await fetch(`${BASE}/${config.whatsapp.version}/${mediaId}`, { headers: cabeceras });
  if (!meta.ok) {
    console.error('[whatsapp] no se pudo pedir la URL del media:', meta.status);
    return null;
  }
  const { url, mime_type: mime } = await meta.json();

  const archivo = await fetch(url, { headers: cabeceras });
  if (!archivo.ok) {
    console.error('[whatsapp] no se pudo bajar el media:', archivo.status);
    return null;
  }

  return { buffer: Buffer.from(await archivo.arrayBuffer()), mime: mime || 'audio/ogg' };
}

// Marca el mensaje como leido (los tildes azules) y muestra "escribiendo…".
// Es cosmetico, pero cuando el bot tarda en transcribir un audio le da al
// vendedor la señal de que lo esta procesando.
export async function marcarLeido(waMessageId, escribiendo = false) {
  if (!whatsappConfigurado || !waMessageId) return;
  try {
    await llamar({
      status: 'read',
      message_id: waMessageId,
      ...(escribiendo ? { typing_indicator: { type: 'text' } } : {}),
    });
  } catch (error) {
    console.error('[whatsapp] no se pudo marcar como leido:', error.message);
  }
}
