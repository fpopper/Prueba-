// Prueba de punta a punta del flujo de una visita, sobre una base temporal.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, describe, before, after } from 'node:test';
import { abrirDb, cerrarDb, consultarUna } from '../src/db/db.js';
import { altaVendedor } from '../src/db/queries.js';
import { atenderMensaje } from '../src/chat/gestor.js';
import { importar } from '../src/importador/importar.js';

const TEL = '5491199887766';
let db;
let carpeta;

const VENTAS_CSV = `Codigo Cliente;Cliente;Canal;Fecha;Agente;Familia;Cantidad;Importe Neto
C-9001;METALURGICA DEL OESTE SA;DISTRIBUIDOR;2026-02-10;N.ANTONUCCI;JABALINAS LISAS;300;9600000
C-9001;METALURGICA DEL OESTE SA;DISTRIBUIDOR;2026-03-10;N.ANTONUCCI;TOMACABLES;20;230000
C-9001;METALURGICA DEL OESTE SA;DISTRIBUIDOR;2026-04-10;N.ANTONUCCI;CABLE IRAM 2467;400;7200000
C-9002;FERRETERIA CHICA SRL;DISTRIBUIDOR;2026-03-15;REP SUR;CABLE IRAM 2467;10;180000
`;

before(() => {
  carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'facbsa-test-'));
  const csv = path.join(carpeta, 'ventas.csv');
  fs.writeFileSync(csv, VENTAS_CSV, 'utf8');
  importar(csv, { rutaDb: path.join(carpeta, 'test.db') });
  db = abrirDb(path.join(carpeta, 'test.db'));
  altaVendedor(db, { telefono: TEL, nombre: 'Vendedor Prueba', agente: 'N.ANTONUCCI' });
});

after(() => {
  cerrarDb();
  fs.rmSync(carpeta, { recursive: true, force: true });
});

let contador = 0;
function decir(texto, extra = {}) {
  return atenderMensaje(db, { telefono: TEL, texto, waMessageId: `t${contador++}`, ...extra });
}

// Todas las pruebas corren en modo guiado (sin ANTHROPIC_API_KEY): es el flujo
// determinista, el unico que se puede probar sin llamar a la API.

describe('flujo completo de una visita', () => {
  test('un numero no registrado no puede cargar visitas', async () => {
    const r = await atenderMensaje(db, { telefono: '5491100000000', texto: 'hola', waMessageId: 'x1' });
    assert.match(r[0].texto, /no esta habilitado/i);
  });

  test('el bot saluda por el nombre del vendedor y pide el cliente', async () => {
    const r = await decir('hola');
    assert.match(r[0].texto, /Vendedor/);
    assert.match(r[0].texto, /vas a visitar/i);
  });

  test('declarar el cliente devuelve la ficha y las preguntas especiales', async () => {
    const r = await decir('metalurgica del oeste');
    assert.equal(r.length, 3);
    assert.match(r[0].texto, /METALURGICA DEL OESTE/);
    assert.match(r[0].texto, /Facturacion 12m/);
    assert.match(r[1].texto, /Averigua esto adentro/);
    // Compra 300 jabalinas y 20 tomacables: el gap tiene que aparecer.
    assert.match(r[1].texto, /tomacables/i);
    assert.match(r[2].texto, /FIN/);
  });

  test('mientras esta adentro, el bot le recuerda que escriba FIN', async () => {
    const r = await decir('estoy entrando');
    assert.match(r[0].texto, /visita abierta/i);
  });

  test('FICHA vuelve a mostrar la situacion del cliente', async () => {
    const r = await decir('FICHA');
    assert.match(r[0].texto, /METALURGICA DEL OESTE/);
  });

  test('FIN arranca el cuestionario', async () => {
    const r = await decir('FIN');
    assert.match(r[0].texto, /relevamiento/i);
    assert.match(r[1].texto, /^\*1\//);
  });

  test('una opcion invalida se rechaza y se repite la pregunta', async () => {
    await decir('Juan Gomez, comprador'); // 1: contacto
    const r = await decir('99'); // 2: opciones
    assert.match(r[0].texto, /⚠️/);
    assert.match(r[1].texto, /^\*2\//);
  });

  test('el cuestionario se completa y la visita queda guardada', async () => {
    let respuestas = await decir('1'); // resultado
    let vueltas = 0;

    // Contestamos hasta que el bot devuelva el resumen final.
    while (!respuestas.some((m) => /qued[oó] cargado/i.test(m.texto))) {
      if (++vueltas > 30) throw new Error('el cuestionario no termina nunca');
      // Si la pregunta trae botonera, contestamos como si tocara el primer boton.
      const conBotones = respuestas[respuestas.length - 1].botones ||
        respuestas[respuestas.length - 1].lista?.filas;
      respuestas = conBotones
        ? await decir(conBotones[0].titulo, { opcionId: conBotones[0].id })
        : await decir('Respuesta de prueba del vendedor');
    }

    const visita = consultarUna(db, "SELECT * FROM visitas WHERE estado = 'COMPLETA' ORDER BY id DESC LIMIT 1");
    assert.ok(visita, 'la visita tiene que quedar COMPLETA');
    assert.ok(visita.ficha_snapshot, 'se guarda la foto de la situacion del cliente al momento de la visita');

    const especiales = consultarUna(
      db,
      "SELECT COUNT(*) AS n FROM respuestas WHERE visita_id = ? AND origen = 'especial'",
      [visita.id]
    );
    assert.ok(especiales.n > 0, 'tienen que quedar registradas las respuestas especiales');
  });

  test('un prospecto que no esta en el sistema se puede cargar igual', async () => {
    const r = await decir('NUEVO Ferreteria La Esquina');
    assert.match(r[0].texto, /cliente nuevo/i);
    await decir('CANCELAR');
  });

  test('CANCELAR deja la visita anulada y libera al vendedor', async () => {
    await decir('metalurgica');
    const r = await decir('CANCELAR');
    assert.match(r[0].texto, /cancel/i);
    const sesion = consultarUna(db, 'SELECT estado FROM sesiones WHERE telefono = ?', [TEL]);
    assert.equal(sesion.estado, 'INICIO');
  });

  test('el mismo mensaje de WhatsApp no se procesa dos veces', async () => {
    const primera = await atenderMensaje(db, { telefono: TEL, texto: 'hola', waMessageId: 'repetido' });
    const segunda = await atenderMensaje(db, { telefono: TEL, texto: 'hola', waMessageId: 'repetido' });
    assert.ok(primera.length > 0);
    assert.equal(segunda.length, 0);
  });

  test('si hay varios clientes parecidos, ofrece elegir', async () => {
    const r = await decir('srl');
    assert.ok(/Encontré varios|cliente nuevo|📋/.test(r[0].texto));
  });
});
