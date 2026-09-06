// Transcripcion de las notas de voz que manda el vendedor.
//
// Claude no procesa audio, asi que la transcripcion la hace un servicio de
// speech-to-text aparte. Estan implementados dos proveedores; se elige con
// TRANSCRIPCION_PROVEEDOR en el .env. Si no hay ninguno configurado, el bot no
// se rompe: avisa que no pudo escuchar el audio y sigue por texto.
//
// Ambos manejan bien el español rioplatense. Referencia de costo (2026):
//   openai   ~USD 0,006 por minuto
//   deepgram ~USD 0,004 por minuto
// Un vendedor con 8 visitas diarias y audios de 1 minuto son centavos por dia.
import { config } from '../config.js';

export class ErrorTranscripcion extends Error {}

/**
 * @param {Buffer} audio
 * @param {string} mime  ej: 'audio/ogg; codecs=opus' (lo que manda WhatsApp)
 * @returns {Promise<{texto: string, proveedor: string}>}
 */
export async function transcribir(audio, mime = 'audio/ogg') {
  const proveedor = config.transcripcion.proveedor;

  if (proveedor === 'ninguno' || !proveedor) {
    throw new ErrorTranscripcion('No hay proveedor de transcripcion configurado.');
  }
  if (!audio?.length) {
    throw new ErrorTranscripcion('El audio llego vacio.');
  }

  if (proveedor === 'openai') return { ...(await conOpenai(audio, mime)), proveedor };
  if (proveedor === 'deepgram') return { ...(await conDeepgram(audio, mime)), proveedor };

  throw new ErrorTranscripcion(`Proveedor de transcripcion desconocido: ${proveedor}`);
}

export function transcripcionDisponible() {
  const { proveedor, clave } = config.transcripcion;
  return proveedor !== 'ninguno' && Boolean(clave);
}

function extensionDe(mime) {
  if (/ogg|opus/i.test(mime)) return 'ogg';
  if (/mpeg|mp3/i.test(mime)) return 'mp3';
  if (/mp4|m4a|aac/i.test(mime)) return 'm4a';
  if (/wav/i.test(mime)) return 'wav';
  if (/webm/i.test(mime)) return 'webm';
  return 'ogg';
}

async function conOpenai(audio, mime) {
  const { clave, modelo } = config.transcripcion;
  if (!clave) throw new ErrorTranscripcion('Falta TRANSCRIPCION_API_KEY.');

  const formulario = new FormData();
  formulario.append('file', new Blob([audio], { type: mime }), `nota.${extensionDe(mime)}`);
  formulario.append('model', modelo || 'whisper-1');
  formulario.append('language', 'es');
  // El contexto le mejora bastante la transcripcion de los terminos del rubro.
  formulario.append('prompt', PISTAS_DE_VOCABULARIO);

  const respuesta = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${clave}` },
    body: formulario,
  });

  if (!respuesta.ok) {
    throw new ErrorTranscripcion(`Transcripcion fallida (${respuesta.status}): ${await respuesta.text()}`);
  }

  const datos = await respuesta.json();
  return { texto: String(datos.text || '').trim() };
}

async function conDeepgram(audio, mime) {
  const { clave, modelo } = config.transcripcion;
  if (!clave) throw new ErrorTranscripcion('Falta TRANSCRIPCION_API_KEY.');

  const parametros = new URLSearchParams({
    model: modelo || 'nova-3',
    language: 'es',
    punctuate: 'true',
    smart_format: 'true',
  });

  const respuesta = await fetch(`https://api.deepgram.com/v1/listen?${parametros}`, {
    method: 'POST',
    headers: { Authorization: `Token ${clave}`, 'Content-Type': mime },
    body: audio,
  });

  if (!respuesta.ok) {
    throw new ErrorTranscripcion(`Transcripcion fallida (${respuesta.status}): ${await respuesta.text()}`);
  }

  const datos = await respuesta.json();
  const texto = datos?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
  return { texto: texto.trim() };
}

// Vocabulario del rubro. Sin esto, "jabalina" y "tomacable" salen mal escritos
// muy seguido, y despues no hay forma de buscarlos en los relevamientos.
const PISTAS_DE_VOCABULARIO = [
  'FACBSA, conductores bimetalicos, puesta a tierra.',
  'Productos: jabalinas lisas, tomacables, cable IRAM 2467, pararrayos,',
  'soldadura exotermica, cargas aluminotermicas, conectores a compresion,',
  'conjuntos, morseteria, seccion 10/14 y 16/18.',
  'Competencia y clientes del rubro electrico argentino.',
].join(' ');
