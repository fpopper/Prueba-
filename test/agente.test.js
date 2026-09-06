// Pruebas del modo conversacional.
//
// La conversacion con Claude se prueba con un cliente simulado: no se llama a
// la API real. Lo que se verifica es el bucle del agente (que despache bien las
// herramientas, que mande la ficha sin pasarla por el modelo, que la botonera
// salga como corresponde) y las herramientas contra la base, que son donde
// estan las reglas de negocio.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, describe, before, after } from 'node:test';
import { abrirDb, cerrarDb, consultar, consultarUna } from '../src/db/db.js';
import { altaVendedor } from '../src/db/queries.js';
import { importar } from '../src/importador/importar.js';
import { conversar, inyectarCliente, olvidarConversacion } from '../src/ia/agente.js';
import { DEFINICIONES, ejecutarHerramienta } from '../src/ia/herramientas.js';
import { formatearPregunta } from '../src/chat/cuestionario.js';
import { extraerMensajes, LIMITES } from '../src/whatsapp/meta.js';

const TEL = '5491199887766';
let db;
let carpeta;
let vendedorId;

const VENTAS_CSV = `Codigo Cliente;Cliente;Canal;Fecha;Agente;Familia;Cantidad;Importe Neto
C-9001;METALURGICA DEL OESTE SA;DISTRIBUIDOR;2026-02-10;N.ANTONUCCI;JABALINAS LISAS;300;9600000
C-9001;METALURGICA DEL OESTE SA;DISTRIBUIDOR;2026-03-10;N.ANTONUCCI;TOMACABLES;20;230000
C-9001;METALURGICA DEL OESTE SA;DISTRIBUIDOR;2026-04-10;N.ANTONUCCI;CABLE IRAM 2467;400;7200000
`;

before(() => {
  carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'facbsa-agente-'));
  const csv = path.join(carpeta, 'ventas.csv');
  fs.writeFileSync(csv, VENTAS_CSV, 'utf8');
  importar(csv, { rutaDb: path.join(carpeta, 'test.db') });
  db = abrirDb(path.join(carpeta, 'test.db'));
  altaVendedor(db, { telefono: TEL, nombre: 'Vendedor Prueba', agente: 'N.ANTONUCCI' });
  vendedorId = consultarUna(db, 'SELECT id FROM vendedores WHERE telefono = ?', [TEL]).id;
});

after(() => {
  cerrarDb();
  fs.rmSync(carpeta, { recursive: true, force: true });
});

function contextoNuevo() {
  return { telefono: TEL, vendedorId, vendedorNombre: 'Vendedor Prueba', visitaId: null };
}

// --- Cliente simulado --------------------------------------------------------
// Devuelve, en orden, las respuestas que se le cargan. Guarda las peticiones
// para poder verificar que se le manda al modelo.
function clienteFalso(respuestas) {
  const peticiones = [];
  const crear = async (parametros) => {
    peticiones.push(parametros);
    const siguiente = respuestas.shift();
    if (!siguiente) throw new Error('el agente pidio mas respuestas de las previstas');
    return { stop_reason: siguiente.tool_use ? 'tool_use' : 'end_turn', content: siguiente.content };
  };
  return {
    peticiones,
    messages: { create: crear },
    beta: { messages: { create: crear } },
  };
}

const texto = (t) => ({ content: [{ type: 'text', text: t }] });
const usaHerramienta = (name, input, id = 'tu_1') => ({
  tool_use: true,
  content: [{ type: 'tool_use', id, name, input }],
});

describe('herramientas del agente', () => {
  test('buscar_cliente encuentra por nombre parcial', () => {
    const { resultado } = ejecutarHerramienta(db, contextoNuevo(), 'buscar_cliente', {
      texto: 'metalurgica',
    });
    assert.equal(resultado.encontrados, 1);
    assert.match(resultado.clientes[0].nombre, /METALURGICA/);
  });

  test('si no encuentra nada sugiere tratarlo como prospecto', () => {
    const { resultado } = ejecutarHerramienta(db, contextoNuevo(), 'buscar_cliente', {
      texto: 'una empresa que no existe',
    });
    assert.equal(resultado.encontrados, 0);
    assert.match(resultado.nota, /prospecto/i);
  });

  test('abrir_visita manda la ficha sin pasarla por el modelo', () => {
    const contexto = contextoNuevo();
    const cliente = consultarUna(db, 'SELECT id FROM clientes LIMIT 1');
    const { resultado, mensajes } = ejecutarHerramienta(db, contexto, 'abrir_visita', {
      cliente_id: cliente.id,
      nombre_nuevo: null,
    });

    assert.ok(contexto.visitaId, 'queda la visita abierta en el contexto');
    assert.equal(resultado.ficha_enviada, true);
    assert.match(mensajes[0].texto, /METALURGICA/);
    assert.match(mensajes[0].texto, /Facturacion 12m/);
    // El modelo recibe los puntos a cubrir, no los numeros de la ficha.
    assert.ok(resultado.puntos_del_relevamiento.length > 5);
    assert.ok(resultado.puntos_del_relevamiento.some((p) => p.origen === 'especial'));
  });

  test('registrar_respuestas rechaza una opcion que no existe', () => {
    const contexto = contextoNuevo();
    const cliente = consultarUna(db, 'SELECT id FROM clientes LIMIT 1');
    ejecutarHerramienta(db, contexto, 'abrir_visita', { cliente_id: cliente.id, nombre_nuevo: null });

    const { resultado } = ejecutarHerramienta(db, contexto, 'registrar_respuestas', {
      respuestas: [{ pregunta_id: 'resultado', respuesta: 'Me fue mas o menos' }],
    });

    assert.equal(resultado.guardadas.length, 0);
    assert.match(resultado.rechazadas[0].motivo, /tiene que ser exactamente/);
  });

  test('una respuesta nueva corrige a la anterior', () => {
    const contexto = contextoNuevo();
    const cliente = consultarUna(db, 'SELECT id FROM clientes LIMIT 1');
    ejecutarHerramienta(db, contexto, 'abrir_visita', { cliente_id: cliente.id, nombre_nuevo: null });

    ejecutarHerramienta(db, contexto, 'registrar_respuestas', {
      respuestas: [{ pregunta_id: 'contacto', respuesta: 'Juan' }],
    });
    ejecutarHerramienta(db, contexto, 'registrar_respuestas', {
      respuestas: [{ pregunta_id: 'contacto', respuesta: 'Juan Perez, jefe de compras' }],
    });

    const filas = consultar(
      db,
      "SELECT respuesta FROM respuestas WHERE visita_id = ? AND pregunta_id = 'contacto'",
      [contexto.visitaId]
    );
    assert.equal(filas.length, 1);
    assert.match(filas[0].respuesta, /jefe de compras/);
  });

  test('no se puede cerrar la visita con puntos obligatorios pendientes', () => {
    const contexto = contextoNuevo();
    const cliente = consultarUna(db, 'SELECT id FROM clientes LIMIT 1');
    ejecutarHerramienta(db, contexto, 'abrir_visita', { cliente_id: cliente.id, nombre_nuevo: null });

    const { resultado } = ejecutarHerramienta(db, contexto, 'cerrar_visita', {});
    assert.match(resultado.error, /faltan puntos obligatorios/i);
    assert.ok(resultado.pendientes.length > 0);
  });

  test('con todo cubierto, cerrar_visita completa la visita', () => {
    const contexto = contextoNuevo();
    const cliente = consultarUna(db, 'SELECT id FROM clientes LIMIT 1');
    const abrir = ejecutarHerramienta(db, contexto, 'abrir_visita', {
      cliente_id: cliente.id,
      nombre_nuevo: null,
    });

    const respuestas = abrir.resultado.puntos_del_relevamiento
      .filter((p) => p.obligatoria)
      .map((p) => ({
        pregunta_id: p.pregunta_id,
        respuesta: p.opciones_validas ? p.opciones_validas[0] : 'lo que contó el vendedor',
      }));

    const registro = ejecutarHerramienta(db, contexto, 'registrar_respuestas', { respuestas });
    assert.equal(registro.resultado.pendientes.length, 0);

    const visitaId = contexto.visitaId;
    const cierre = ejecutarHerramienta(db, contexto, 'cerrar_visita', {});
    assert.equal(cierre.resultado.cerrada, true);
    assert.equal(contexto.visitaId, null);

    const visita = consultarUna(db, 'SELECT estado FROM visitas WHERE id = ?', [visitaId]);
    assert.equal(visita.estado, 'COMPLETA');
  });

  test('todas las herramientas declaran un esquema estricto', () => {
    for (const d of DEFINICIONES) {
      assert.equal(d.strict, true, `${d.name} tiene que ser strict`);
      assert.equal(d.input_schema.additionalProperties, false, `${d.name} sin additionalProperties`);
    }
  });
});

describe('bucle del agente', () => {
  test('despacha la herramienta y devuelve el texto del modelo', async () => {
    olvidarConversacion(db, TEL);
    const contexto = contextoNuevo();
    inyectarCliente(
      clienteFalso([
        usaHerramienta('buscar_cliente', { texto: 'metalurgica' }),
        texto('Dale, ya te paso la ficha.'),
      ])
    );

    const salida = await conversar(db, contexto, 'Estoy yendo a lo de Metalurgica del Oeste');
    assert.equal(salida.at(-1).texto, 'Dale, ya te paso la ficha.');
  });

  test('la ficha se le manda al vendedor tal cual sale de la base', async () => {
    olvidarConversacion(db, TEL);
    const contexto = contextoNuevo();
    const cliente = consultarUna(db, 'SELECT id FROM clientes LIMIT 1');
    inyectarCliente(
      clienteFalso([
        usaHerramienta('abrir_visita', { cliente_id: cliente.id, nombre_nuevo: null }),
        texto('Andá tranquilo, después contame.'),
      ])
    );

    const salida = await conversar(db, contexto, 'voy a lo de metalurgica');
    assert.ok(salida.some((m) => /Facturacion 12m/.test(m.texto)), 'la ficha va sin pasar por el modelo');
    assert.ok(contexto.visitaId);
  });

  test('responder_con_opciones sale como botonera y corta el turno', async () => {
    olvidarConversacion(db, TEL);
    const contexto = contextoNuevo();
    const falso = clienteFalso([
      usaHerramienta('responder_con_opciones', {
        texto: '¿Cómo salió?',
        opciones: ['Cerré pedido', 'Cotización', 'No me atendieron'],
      }),
    ]);
    inyectarCliente(falso);

    const salida = await conversar(db, contexto, 'ya salí');
    assert.equal(salida.length, 1);
    assert.equal(salida[0].botones.length, 3);
    assert.equal(salida[0].botones[0].id, 'op_1');
    assert.equal(falso.peticiones.length, 1, 'no vuelve a llamar al modelo despues de mandar la botonera');
  });

  test('mas de tres opciones salen como lista desplegable', async () => {
    olvidarConversacion(db, TEL);
    const contexto = contextoNuevo();
    inyectarCliente(
      clienteFalso([
        usaHerramienta('responder_con_opciones', {
          texto: '¿Qué stock tienen?',
          opciones: ['Bien surtido', 'Stock justo', 'Casi sin stock', 'Sin stock nuestro'],
        }),
      ])
    );

    const salida = await conversar(db, contexto, 'contame');
    assert.ok(salida[0].lista, 'con 4 opciones va como lista');
    assert.equal(salida[0].lista.filas.length, 4);
  });

  test('el estado de la visita se le inyecta al modelo en cada turno', async () => {
    olvidarConversacion(db, TEL);
    const contexto = contextoNuevo();
    const falso = clienteFalso([texto('Contame cómo te fue.')]);
    inyectarCliente(falso);

    await conversar(db, contexto, 'hola');
    const ultimoMensaje = falso.peticiones[0].messages.at(-1);
    assert.equal(ultimoMensaje.role, 'system');
    assert.match(ultimoMensaje.content, /Vendedor Prueba/);
  });

  test('la conversacion queda guardada para poder retomarla', async () => {
    olvidarConversacion(db, TEL);
    const contexto = contextoNuevo();
    inyectarCliente(clienteFalso([texto('Listo.')]));

    await conversar(db, contexto, 'buenas');
    const turnos = consultar(db, 'SELECT rol FROM turnos WHERE telefono = ? ORDER BY id', [TEL]);
    assert.deepEqual(turnos.map((t) => t.rol), ['user', 'assistant']);
  });
});

describe('mensajes de WhatsApp', () => {
  test('una pregunta de hasta 3 opciones se manda como botonera', () => {
    const mensaje = formatearPregunta(
      { texto: '¿Hay cartelería?', tipo: 'opciones', opciones: ['Sí', 'Poco', 'Nada'], obligatoria: true },
      1,
      5
    );
    assert.equal(mensaje.botones.length, 3);
    assert.equal(mensaje.lista, undefined);
  });

  test('de 4 opciones en adelante se manda como lista', () => {
    const mensaje = formatearPregunta(
      { texto: '¿Stock?', tipo: 'opciones', opciones: ['A', 'B', 'C', 'D'], obligatoria: true },
      1,
      5
    );
    assert.ok(mensaje.lista);
    assert.equal(mensaje.botones, undefined);
  });

  test('ninguna opcion del cuestionario supera el limite de WhatsApp', async () => {
    const { CUESTIONARIO_BASE } = await import('../src/chat/cuestionario.js');
    for (const p of CUESTIONARIO_BASE) {
      for (const op of p.opciones || []) {
        assert.ok(op.length <= LIMITES.tituloBoton, `"${op}" supera ${LIMITES.tituloBoton} caracteres`);
      }
    }
  });

  test('se reconoce una nota de voz entrante', () => {
    const [m] = extraerMensajes({
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ wa_id: '5491100000001', profile: { name: 'Ricardo' } }],
                messages: [
                  {
                    id: 'wamid.1',
                    from: '5491100000001',
                    type: 'audio',
                    audio: { id: 'media-123', voice: true, mime_type: 'audio/ogg; codecs=opus' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    assert.equal(m.esAudio, true);
    assert.equal(m.esNotaDeVoz, true);
    assert.equal(m.mediaId, 'media-123');
    assert.equal(m.nombrePerfil, 'Ricardo');
  });

  test('se reconoce la respuesta de un boton, con su id', () => {
    const [m] = extraerMensajes({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.2',
                    from: '5491100000001',
                    type: 'interactive',
                    interactive: { button_reply: { id: 'op_2', title: 'Stock justo' } },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    assert.equal(m.opcionId, 'op_2');
    assert.equal(m.texto, 'Stock justo');
  });
});

describe('memoria de la conversacion', () => {
  test('al recortar la historia no queda un tool_result sin su tool_use', async () => {
    olvidarConversacion(db, TEL);
    const contexto = contextoNuevo();

    // Una vuelta con herramienta deja 4 filas: user, assistant(tool_use),
    // user(tool_result), assistant(texto).
    inyectarCliente(
      clienteFalso([usaHerramienta('buscar_cliente', { texto: 'metalurgica' }), texto('Listo.')])
    );
    await conversar(db, contexto, 'voy a metalurgica');

    // El turno siguiente tiene que arrancar en un mensaje del vendedor.
    const falso = clienteFalso([texto('Dale.')]);
    inyectarCliente(falso);
    await conversar(db, contexto, 'ya salí');

    const enviados = falso.peticiones[0].messages;
    assert.equal(enviados[0].role, 'user');
    const primerBloque = enviados[0].content[0];
    assert.notEqual(primerBloque.type, 'tool_result');
  });
});
