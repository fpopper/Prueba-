// Cliente de la WhatsApp Cloud API de Meta.
//
// Dos responsabilidades:
//   1. validar que el webhook viene realmente de Meta (firma HMAC)
//   2. mandar los mensajes de respuesta
import crypto from 'node:crypto';
import { config, whatsappConfigurado } from '../config.js';

const BASE = 'https://graph.facebook.com';

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
      const perfiles = new Map(
        (valor.contacts || []).map((c) => [c.wa_id, c.profile?.name])
      );
      for (const m of valor.messages) {
        mensajes.push({
          waMessageId: m.id,
          telefono: m.from,
          nombrePerfil: perfiles.get(m.from) || null,
          tipo: m.type,
          texto:
            m.text?.body ||
            m.button?.text ||
            m.interactive?.button_reply?.title ||
            m.interactive?.list_reply?.title ||
            m.image?.caption ||
            '',
          caption: m.image?.caption || null,
          mediaId: m.image?.id || m.document?.id || null,
          latitud: m.location?.latitude ?? null,
          longitud: m.location?.longitude ?? null,
        });
      }
    }
  }
  return mensajes;
}

export async function enviarTexto(telefono, texto) {
  if (!whatsappConfigurado) {
    console.warn('[whatsapp] sin credenciales configuradas, no se envia:', texto.slice(0, 60));
    return null;
  }

  const url = `${BASE}/${config.whatsapp.version}/${config.whatsapp.phoneNumberId}/messages`;
  const respuesta = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.whatsapp.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: telefono,
      type: 'text',
      text: { preview_url: false, body: texto },
    }),
  });

  if (!respuesta.ok) {
    const detalle = await respuesta.text();
    console.error('[whatsapp] error al enviar:', respuesta.status, detalle);
    return null;
  }
  return respuesta.json();
}

// Marca el mensaje como leido (los tildes azules). Es cosmetico pero le da al
// vendedor la señal de que el bot lo recibio.
export async function marcarLeido(waMessageId) {
  if (!whatsappConfigurado || !waMessageId) return;
  const url = `${BASE}/${config.whatsapp.version}/${config.whatsapp.phoneNumberId}/messages`;
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.whatsapp.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: waMessageId,
      }),
    });
  } catch (error) {
    console.error('[whatsapp] no se pudo marcar como leido:', error.message);
  }
}
