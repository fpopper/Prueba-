// Herramientas que el agente puede usar contra la base de FACBSA.
//
// El agente conversa en lenguaje natural, pero todo lo que toca datos pasa por
// aca. Dos motivos:
//   - los numeros del cliente los arma el codigo, no el modelo: la ficha se le
//     manda al vendedor tal cual sale de la base, sin que el modelo la reescriba
//   - lo que se guarda queda validado contra el cuestionario, asi el relevamiento
//     sigue siendo comparable entre visitas
import { consultarUna, ejecutar, enTransaccion } from '../db/db.js';
import { buscarClientes } from '../db/queries.js';
import { armarFicha, formatearFicha } from '../negocio/ficha-cliente.js';
import { formatearAvisoPreguntas, preguntasEspeciales } from '../negocio/preguntas-especiales.js';
import { armarCuestionario } from '../chat/cuestionario.js';
import { pesos } from '../negocio/reglas.js';

// --- Definiciones que ve el modelo -------------------------------------------
// strict: true garantiza que los argumentos validen contra el esquema.

export const DEFINICIONES = [
  {
    name: 'buscar_cliente',
    description:
      'Busca un cliente en la base de FACBSA por nombre, código o CUIT. Usala apenas el ' +
      'vendedor menciona a quién va a visitar, aunque lo diga de manera informal ' +
      '("estoy yendo a lo de Edesur"). Devuelve los candidatos que coinciden.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Lo que dijo el vendedor: nombre, código o CUIT.' },
      },
      required: ['texto'],
      additionalProperties: false,
    },
  },
  {
    name: 'abrir_visita',
    description:
      'Abre la visita al cliente elegido y le manda al vendedor la ficha con la situación ' +
      'de la cuenta y qué averiguar adentro. El sistema envía esos mensajes por su cuenta: ' +
      'no repitas los números de la ficha en tu respuesta. Para un cliente que no está en ' +
      'el sistema, pasá nombre_nuevo en vez de cliente_id.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        cliente_id: {
          type: ['integer', 'null'],
          description: 'Id del cliente devuelto por buscar_cliente.',
        },
        nombre_nuevo: {
          type: ['string', 'null'],
          description: 'Nombre del prospecto, sólo si no está en el sistema.',
        },
      },
      required: ['cliente_id', 'nombre_nuevo'],
      additionalProperties: false,
    },
  },
  {
    name: 'registrar_respuestas',
    description:
      'Guarda lo que el vendedor contó de la visita. Llamala apenas entendés algo, aunque ' +
      'sea parcial: podés llamarla varias veces a lo largo de la charla. Registrá sólo lo ' +
      'que el vendedor dijo de verdad, nunca lo que suponés. Devuelve qué falta todavía.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        respuestas: {
          type: 'array',
          description: 'Los datos que pudiste sacar de lo que dijo el vendedor.',
          items: {
            type: 'object',
            properties: {
              pregunta_id: { type: 'string', description: 'Id del punto del relevamiento.' },
              respuesta: {
                type: 'string',
                description:
                  'Lo que contestó, en sus palabras. En los puntos de opción cerrada, ' +
                  'usá exactamente una de las opciones válidas.',
              },
            },
            required: ['pregunta_id', 'respuesta'],
            additionalProperties: false,
          },
        },
      },
      required: ['respuestas'],
      additionalProperties: false,
    },
  },
  {
    name: 'cerrar_visita',
    description:
      'Cierra el relevamiento. Sólo cuando están cubiertos todos los puntos obligatorios, ' +
      'o cuando el vendedor dejó claro que algo no lo pudo averiguar y ya lo registraste así.',
    strict: true,
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'cancelar_visita',
    description: 'Anula la visita en curso, por ejemplo si el vendedor se equivocó de cliente.',
    strict: true,
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
];

// --- Ejecucion ---------------------------------------------------------------

/**
 * Ejecuta una herramienta.
 * @returns {{resultado: object, mensajes?: Array}} `mensajes` son los que el
 *   sistema manda directo al vendedor sin pasar por el modelo (la ficha).
 */
export function ejecutarHerramienta(db, contexto, nombre, argumentos) {
  switch (nombre) {
    case 'buscar_cliente':
      return herramientaBuscar(db, argumentos);
    case 'abrir_visita':
      return herramientaAbrir(db, contexto, argumentos);
    case 'registrar_respuestas':
      return herramientaRegistrar(db, contexto, argumentos);
    case 'cerrar_visita':
      return herramientaCerrar(db, contexto);
    case 'cancelar_visita':
      return herramientaCancelar(db, contexto);
    default:
      return { resultado: { error: `Herramienta desconocida: ${nombre}` } };
  }
}

function herramientaBuscar(db, { texto }) {
  const candidatos = buscarClientes(db, texto, 6);

  if (!candidatos.length) {
    return {
      resultado: {
        encontrados: 0,
        nota:
          'No hay ningún cliente que coincida. Puede ser un prospecto que todavía no está ' +
          'en el sistema: preguntale al vendedor si es un cliente nuevo y, si lo confirma, ' +
          'abrí la visita con nombre_nuevo.',
      },
    };
  }

  return {
    resultado: {
      encontrados: candidatos.length,
      clientes: candidatos.map((c) => ({
        cliente_id: c.id,
        nombre: c.nombre,
        codigo: c.codigo,
        canal: c.canal,
        localidad: c.localidad,
        segmento: c.segmento,
        facturacion_12m: pesos(c.facturacion_12m || 0),
      })),
      nota:
        candidatos.length === 1
          ? 'Hay uno solo: abrí la visita directamente, sin preguntar de más.'
          : 'Hay varios parecidos: preguntale al vendedor cuál es, con una botonera si entran.',
    },
  };
}

function herramientaAbrir(db, contexto, { cliente_id: clienteId, nombre_nuevo: nombreNuevo }) {
  if (contexto.visitaId) {
    return {
      resultado: {
        error: 'Ya hay una visita abierta. Cerrala o cancelala antes de abrir otra.',
      },
    };
  }
  if (!clienteId && !nombreNuevo) {
    return { resultado: { error: 'Necesito cliente_id o nombre_nuevo.' } };
  }

  const ficha = clienteId ? armarFicha(db, clienteId) : null;
  if (clienteId && !ficha) {
    return { resultado: { error: `No existe el cliente ${clienteId}.` } };
  }

  const especiales = ficha ? preguntasEspeciales(ficha) : [];
  const preguntas = armarCuestionario(especiales);

  const visitaId = enTransaccion(db, () => {
    const res = ejecutar(
      db,
      `INSERT INTO visitas (vendedor_id, cliente_id, cliente_texto, es_prospecto, estado,
                            iniciada_en, ficha_snapshot, preguntas_especiales)
       VALUES (?, ?, ?, ?, 'EN_CURSO', datetime('now'), ?, ?)`,
      [
        contexto.vendedorId,
        clienteId || null,
        nombreNuevo || ficha?.cliente.nombre || null,
        clienteId ? 0 : 1,
        ficha ? JSON.stringify(ficha) : null,
        JSON.stringify(especiales),
      ]
    );
    return Number(res.lastInsertRowid);
  });

  contexto.visitaId = visitaId;

  // La ficha se le manda al vendedor tal cual sale de la base. El modelo no la
  // reescribe: los numeros de una cuenta no se parafrasean.
  const mensajes = ficha
    ? [{ texto: formatearFicha(ficha) }, { texto: formatearAvisoPreguntas(especiales) }]
    : [
        {
          texto:
            `📋 *${nombreNuevo}* — cliente nuevo\n\n` +
            'No está en el sistema, así que no tengo historia de compra. Lo cargo como prospecto.',
        },
      ];

  return {
    mensajes,
    resultado: {
      visita_id: visitaId,
      cliente: ficha?.cliente.nombre || nombreNuevo,
      es_prospecto: !clienteId,
      ficha_enviada: true,
      puntos_del_relevamiento: preguntas.map(resumirPregunta),
      nota:
        'La ficha y las preguntas especiales ya se le mandaron al vendedor. No repitas ' +
        'los números. Decile en una o dos líneas que vaya tranquilo y que cuando salga te ' +
        'cuente cómo le fue, por audio si le queda más cómodo.',
    },
  };
}

function resumirPregunta(p) {
  return {
    pregunta_id: p.id,
    que_hay_que_saber: p.texto,
    obligatoria: p.obligatoria,
    origen: p.origen,
    ...(p.contexto ? { por_que: p.contexto } : {}),
    ...(p.opciones ? { opciones_validas: p.opciones } : {}),
  };
}

function preguntasDeLaVisita(db, visitaId) {
  const visita = consultarUna(db, 'SELECT * FROM visitas WHERE id = ?', [visitaId]);
  let especiales = [];
  try {
    especiales = JSON.parse(visita?.preguntas_especiales || '[]');
  } catch {
    especiales = [];
  }
  return armarCuestionario(especiales);
}

function herramientaRegistrar(db, contexto, { respuestas }) {
  if (!contexto.visitaId) {
    return { resultado: { error: 'No hay ninguna visita abierta todavía.' } };
  }

  const preguntas = preguntasDeLaVisita(db, contexto.visitaId);
  const porId = new Map(preguntas.map((p) => [p.id, p]));
  const guardadas = [];
  const rechazadas = [];

  enTransaccion(db, () => {
    for (const item of respuestas || []) {
      const pregunta = porId.get(item.pregunta_id);
      if (!pregunta) {
        rechazadas.push({ pregunta_id: item.pregunta_id, motivo: 'no existe ese punto' });
        continue;
      }

      let valor = null;
      if (pregunta.tipo === 'opciones') {
        valor =
          pregunta.opciones.find(
            (op) => op.toLowerCase() === String(item.respuesta).trim().toLowerCase()
          ) || null;
        if (!valor) {
          rechazadas.push({
            pregunta_id: item.pregunta_id,
            motivo: `tiene que ser exactamente una de: ${pregunta.opciones.join(' | ')}`,
          });
          continue;
        }
      }

      // Una respuesta nueva pisa la anterior: el vendedor puede corregirse.
      ejecutar(db, 'DELETE FROM respuestas WHERE visita_id = ? AND pregunta_id = ?', [
        contexto.visitaId,
        item.pregunta_id,
      ]);
      ejecutar(
        db,
        `INSERT INTO respuestas (visita_id, pregunta_id, pregunta_texto, origen, regla_id,
                                 respuesta, respuesta_valor)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          contexto.visitaId,
          pregunta.id,
          pregunta.texto,
          pregunta.origen,
          pregunta.reglaId,
          String(item.respuesta).trim(),
          valor,
        ]
      );
      guardadas.push(item.pregunta_id);
    }
  });

  const pendientes = puntosPendientes(db, contexto.visitaId, preguntas);

  return {
    resultado: {
      guardadas,
      ...(rechazadas.length ? { rechazadas } : {}),
      pendientes: pendientes.map(resumirPregunta),
      nota: pendientes.length
        ? 'Pedile lo que falta, de a una cosa por vez y en tus palabras. Si el punto tiene ' +
          'opciones cerradas, ofrecelas como botonera.'
        : 'Ya está todo lo obligatorio: confirmá con el vendedor y cerrá la visita.',
    },
  };
}

function puntosPendientes(db, visitaId, preguntas) {
  const respondidas = new Set(
    db
      .prepare('SELECT pregunta_id FROM respuestas WHERE visita_id = ?')
      .all(visitaId)
      .map((r) => r.pregunta_id)
  );
  return preguntas.filter((p) => p.obligatoria && !respondidas.has(p.id));
}

function herramientaCerrar(db, contexto) {
  if (!contexto.visitaId) {
    return { resultado: { error: 'No hay ninguna visita abierta.' } };
  }

  const preguntas = preguntasDeLaVisita(db, contexto.visitaId);
  const pendientes = puntosPendientes(db, contexto.visitaId, preguntas);

  if (pendientes.length) {
    return {
      resultado: {
        error: 'Todavía faltan puntos obligatorios, no la puedo cerrar.',
        pendientes: pendientes.map(resumirPregunta),
      },
    };
  }

  const visita = consultarUna(db, 'SELECT * FROM visitas WHERE id = ?', [contexto.visitaId]);
  ejecutar(db, `UPDATE visitas SET estado = 'COMPLETA', cerrada_en = datetime('now') WHERE id = ?`, [
    contexto.visitaId,
  ]);

  const mensajes = [{ texto: resumenVisita(db, contexto.visitaId) }];
  const cliente = visita?.cliente_texto || 'el cliente';
  contexto.visitaId = null;

  return {
    mensajes,
    resultado: {
      cerrada: true,
      cliente,
      nota:
        'Ya se le mandó el resumen de lo cargado. Agradecele en una línea y quedate ' +
        'disponible para el próximo cliente.',
    },
  };
}

function herramientaCancelar(db, contexto) {
  if (!contexto.visitaId) {
    return { resultado: { error: 'No hay ninguna visita abierta.' } };
  }
  ejecutar(db, `UPDATE visitas SET estado = 'CANCELADA', cerrada_en = datetime('now') WHERE id = ?`, [
    contexto.visitaId,
  ]);
  contexto.visitaId = null;
  return { resultado: { cancelada: true } };
}

// Resumen que se le devuelve al vendedor: sirve de comprobante y de control.
export function resumenVisita(db, visitaId) {
  const filas = db
    .prepare(
      `SELECT pregunta_texto, respuesta, origen FROM respuestas
       WHERE visita_id = ? ORDER BY id`
    )
    .all(visitaId);

  const L = ['📝 *Esto es lo que quedó cargado*', ''];
  for (const f of filas) {
    const marca = f.origen === 'especial' ? '❗' : '•';
    L.push(`${marca} ${acortar(f.pregunta_texto, 60)}`);
    L.push(`   → ${f.respuesta || '(sin respuesta)'}`);
  }
  L.push('');
  L.push('_Si algo quedó mal, decímelo y lo corrijo._');
  return L.join('\n');
}

function acortar(texto, largo) {
  const t = String(texto || '');
  return t.length <= largo ? t : `${t.slice(0, largo - 1)}…`;
}
