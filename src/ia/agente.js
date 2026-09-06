// Agente conversacional.
//
// El vendedor habla como habla —por texto o por audio— y el agente entiende,
// busca en la base, le manda la ficha, escucha el relato de la visita y sólo
// repregunta lo que falta. No hay comandos ni menúes: la conversación es la
// interfaz.
//
// Lo que el agente NO hace: inventar números. Todo lo que toca datos pasa por
// las herramientas de src/ia/herramientas.js, y la ficha del cliente se le manda
// al vendedor tal cual sale de la base.
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { consultar, consultarUna, ejecutar } from '../db/db.js';
import { DEFINICIONES, ejecutarHerramienta } from './herramientas.js';

// Cuántos turnos de la charla se le mandan al modelo. Alcanza de sobra para una
// visita y mantiene el costo acotado.
const TURNOS_DE_CONTEXTO = 30;
// Tope de vueltas de herramientas en un mismo turno, por las dudas.
const MAX_VUELTAS = 6;

let cliente = null;
function clienteAnthropic() {
  // Sin clave explicita dejamos que el SDK resuelva las credenciales del
  // entorno (variable de entorno o perfil de `ant auth login`).
  if (!cliente) cliente = config.ia.clave ? new Anthropic({ apiKey: config.ia.clave }) : new Anthropic();
  return cliente;
}

/** Sólo para las pruebas: reemplaza el cliente de la API por uno simulado. */
export function inyectarCliente(simulado) {
  cliente = simulado;
}

// --- Herramienta de presentacion ---------------------------------------------
// Es la única que no toca datos: le deja al agente ofrecer una botonera de
// WhatsApp cuando la respuesta es una opción cerrada. Tocar un botón es mucho
// más rápido que escribir, sobre todo parado en la vereda de un cliente.
const RESPONDER_CON_OPCIONES = {
  name: 'responder_con_opciones',
  description:
    'Manda un mensaje con botones para que el vendedor elija tocando en vez de escribir. ' +
    'Usala siempre que la respuesta sea una opción cerrada: los puntos del relevamiento que ' +
    'tienen opciones_validas, o cuando hay que elegir entre varios clientes. Hasta 3 opciones ' +
    'salen como botones, de 4 a 10 como lista desplegable. Cada opción, 20 caracteres o menos. ' +
    'Después de llamarla, terminá el turno: el mensaje ya se envió.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'El mensaje, en tus palabras.' },
      opciones: {
        type: 'array',
        description: 'Entre 2 y 10 opciones, de 20 caracteres o menos cada una.',
        items: { type: 'string' },
      },
    },
    required: ['texto', 'opciones'],
    additionalProperties: false,
  },
};

const HERRAMIENTAS = [...DEFINICIONES, RESPONDER_CON_OPCIONES];

// --- Instrucciones -----------------------------------------------------------

const INSTRUCCIONES = `Sos el asistente de relevamiento de visitas de FACBSA, y hablás por WhatsApp con los vendedores que salen a la calle.

FACBSA fabrica conductores bimetálicos para instalaciones de puesta a tierra. Es líder del mercado argentino en productos normalizados IRAM. Sus familias principales son cable IRAM 2467, jabalinas lisas, tomacables, pararrayos, soldadura exotérmica y los conjuntos armados.

## Para qué existís

Antes de entrar al cliente, el vendedor te dice a quién va a visitar y vos le pasás la situación de esa cuenta y qué conviene averiguar adentro. Cuando sale, te cuenta cómo le fue —normalmente por audio— y vos registrás el relevamiento y le repreguntás sólo lo que falte.

## Cómo hablás

Sos un compañero de trabajo, no un formulario. Escribís en español rioplatense, de vos, breve y directo, como se escribe por WhatsApp: dos o tres líneas por mensaje, sin viñetas ni títulos salvo que estés listando algo de verdad. Nada de "estimado", "procederé a" ni jerga de sistema. No le digas "ingresá el dato" ni le hables de campos, formularios o registros: preguntale las cosas como se las preguntaría un jefe de ventas.

Nunca le pidas comandos. Si el vendedor escribe FIN, LISTO o algo así, entendelo y seguí.

## Cómo trabajás

1. Cuando menciona un cliente, buscalo con buscar_cliente aunque lo diga informal. Si hay uno solo, abrí la visita sin preguntar de más. Si hay varios, ofrecé la botonera para que elija.
2. Al abrir la visita el sistema le manda la ficha y las preguntas especiales. Ya las vio: no repitas los números ni la lista. Decile en una línea que vaya tranquilo y que después te cuente.
3. Cuando vuelve, escuchá todo lo que dice y registrá con registrar_respuestas cada cosa que hayas entendido, aunque sea parcial. Podés llamarla varias veces.
4. Fijate qué quedó pendiente y pedilo. De a una cosa por vez, con naturalidad, sin repetir lo que ya te contó. Si el punto tiene opciones_validas, ofrecelas con responder_con_opciones.
5. Cuando está todo, cerrá con cerrar_visita.

## Reglas que no se negocian

- Registrá sólo lo que el vendedor dijo. Si no lo dijo, está pendiente. Nunca completes un punto con lo que te parece probable.
- Los números de facturación, ranking, gaps y segmento salen de la base. No los repitas de memoria ni los estimes: si te pregunta por la situación del cliente, volvé a mirar los datos que te dio la herramienta.
- El gap de tomacables es una estimación comercial (1 tomacable cada 2 jabalinas), no una demanda comprobada. Si sale el tema, decilo así.
- Las preguntas especiales son las que pidió la oficina para ese cliente: no las dejes pasar. Si el vendedor no las pudo averiguar, registrá eso mismo como respuesta y seguí.
- Si el audio se entendió mal o vino cortado, decilo y pedile que repita esa parte.
- Si te habla de algo que no tiene nada que ver con las visitas, contestale corto y volvé al tema.`;

// --- Estado de la conversacion ----------------------------------------------

function historia(db, telefono) {
  const filas = consultar(
    db,
    `SELECT rol, contenido FROM turnos WHERE telefono = ? ORDER BY id DESC LIMIT ${TURNOS_DE_CONTEXTO}`,
    [telefono]
  );
  const mensajes = filas
    .reverse()
    .map((f) => ({ role: f.rol, content: JSON.parse(f.contenido) }));

  return recortarProlijo(mensajes);
}

// Al quedarnos con los ultimos N turnos podemos partir al medio un par
// tool_use / tool_result, y la API rechaza el pedido entero. Descartamos del
// principio hasta que arranque en un mensaje del vendedor que no sea el
// resultado de una herramienta.
function recortarProlijo(mensajes) {
  let desde = 0;
  while (desde < mensajes.length) {
    const m = mensajes[desde];
    const esResultadoDeHerramienta =
      Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result');
    if (m.role === 'user' && !esResultadoDeHerramienta) break;
    desde++;
  }
  return mensajes.slice(desde);
}

function guardarTurno(db, telefono, visitaId, rol, contenido) {
  ejecutar(db, 'INSERT INTO turnos (telefono, visita_id, rol, contenido) VALUES (?, ?, ?, ?)', [
    telefono,
    visitaId,
    rol,
    JSON.stringify(contenido),
  ]);
}

export function olvidarConversacion(db, telefono) {
  ejecutar(db, 'DELETE FROM turnos WHERE telefono = ?', [telefono]);
}

// Estado actual, que se le inyecta al modelo en cada turno. Va como mensaje de
// sistema al final de la conversación: no invalida el prefijo cacheado.
function estadoActual(db, contexto) {
  const L = [`Vendedor: ${contexto.vendedorNombre}.`];
  L.push(`Fecha y hora: ${new Date().toLocaleString('es-AR', { timeZone: config.zonaHoraria })}.`);

  if (!contexto.visitaId) {
    L.push('No hay ninguna visita abierta. Si menciona un cliente, buscalo y abrí la visita.');
    return L.join(' ');
  }

  const visita = consultarUna(db, 'SELECT * FROM visitas WHERE id = ?', [contexto.visitaId]);
  L.push(`Visita abierta en ${visita?.cliente_texto || 'un cliente'}.`);

  const respondidas = consultar(
    db,
    'SELECT pregunta_id, respuesta FROM respuestas WHERE visita_id = ? ORDER BY id',
    [contexto.visitaId]
  );

  if (respondidas.length) {
    L.push(
      `Ya registrado: ${respondidas.map((r) => `${r.pregunta_id}="${r.respuesta}"`).join('; ')}.`
    );
  } else {
    L.push('Todavía no registraste nada de esta visita.');
  }

  return L.join(' ');
}

// --- Bucle del agente --------------------------------------------------------

/**
 * Procesa un mensaje del vendedor y devuelve los mensajes a responder.
 * @returns {Promise<Array<{texto:string, botones?:Array, lista?:object}>>}
 */
export async function conversar(db, contexto, entradaUsuario) {
  const mensajes = historia(db, contexto.telefono);
  const bloqueUsuario = [{ type: 'text', text: entradaUsuario }];

  guardarTurno(db, contexto.telefono, contexto.visitaId, 'user', bloqueUsuario);
  mensajes.push({ role: 'user', content: bloqueUsuario });

  const salida = [];

  for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
    // El estado va como mensaje de sistema al final, después del turno del
    // usuario, que es donde la API lo acepta.
    const conEstado = [...mensajes, { role: 'system', content: estadoActual(db, contexto) }];
    const respuesta = await pedirAClaude(conEstado);

    if (respuesta.stop_reason === 'refusal') {
      salida.push({ texto: 'Eso no lo puedo procesar. Contame la visita y seguimos.' });
      break;
    }

    guardarTurno(db, contexto.telefono, contexto.visitaId, 'assistant', respuesta.content);
    mensajes.push({ role: 'assistant', content: respuesta.content });

    const texto = respuesta.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text.trim())
      .filter(Boolean)
      .join('\n\n');

    const llamadas = respuesta.content.filter((b) => b.type === 'tool_use');

    if (!llamadas.length) {
      if (texto) salida.push({ texto });
      break;
    }

    if (texto) salida.push({ texto });

    const resultados = [];
    let terminar = false;

    for (const llamada of llamadas) {
      if (llamada.name === 'responder_con_opciones') {
        salida.push(armarMensajeConOpciones(llamada.input));
        resultados.push({
          type: 'tool_result',
          tool_use_id: llamada.id,
          content: JSON.stringify({ enviado: true }),
        });
        terminar = true;
        continue;
      }

      const { resultado, mensajes: propios } = ejecutarHerramienta(
        db,
        contexto,
        llamada.name,
        llamada.input
      );
      if (propios?.length) salida.push(...propios);
      resultados.push({
        type: 'tool_result',
        tool_use_id: llamada.id,
        content: JSON.stringify(resultado),
      });
    }

    guardarTurno(db, contexto.telefono, contexto.visitaId, 'user', resultados);
    mensajes.push({ role: 'user', content: resultados });

    if (terminar) break;
  }

  return salida;
}

function armarMensajeConOpciones({ texto, opciones }) {
  const filas = (opciones || [])
    .slice(0, 10)
    .map((op, i) => ({ id: `op_${i + 1}`, titulo: String(op).slice(0, 20) }));

  if (!filas.length) return { texto };
  if (filas.length <= 3) return { texto, botones: filas };
  return { texto, lista: { boton: 'Elegir', filas } };
}

// --- Llamada a la API --------------------------------------------------------

async function pedirAClaude(mensajes) {
  const comun = {
    model: config.ia.modelo,
    max_tokens: 8000,
    system: [
      { type: 'text', text: INSTRUCCIONES, cache_control: { type: 'ephemeral' } },
    ],
    tools: HERRAMIENTAS,
    tool_choice: { type: 'auto' },
    output_config: { effort: config.ia.esfuerzo },
    messages: mensajes,
  };

  const api = clienteAnthropic();

  try {
    // Si el modelo declina una petición, la API la reintenta sola en un modelo
    // de respaldo en vez de dejar al vendedor sin respuesta.
    return await api.beta.messages.create({
      ...comun,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
  } catch (error) {
    if (!(error instanceof Anthropic.BadRequestError)) throw error;
    // Si la cuenta o el modelo no tienen habilitado el fallback, seguimos sin él.
    console.warn('[agente] sin fallback del servidor:', error.message);
    return api.messages.create(comun);
  }
}
