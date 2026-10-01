// La ficha que ve el vendedor antes de entrar: datos estaticos del cliente y
// con quien tiene que hablar adentro.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, describe, before, after } from 'node:test';
import { abrirDb, cerrarDb, ejecutar } from '../src/db/db.js';
import { armarFicha, formatearFicha } from '../src/negocio/ficha-cliente.js';

let db;
let carpeta;

before(() => {
  carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'facbsa-ficha-'));
  db = abrirDb(path.join(carpeta, 'test.db'));
  ejecutar(
    db,
    `INSERT INTO clientes (id, codigo, nombre, nombre_busqueda, razon_social, cuit,
                           canal, actividad, direccion, localidad, provincia,
                           horario_atencion, telefono, condicion_pago, particularidades)
     VALUES (1, 'C-1', 'ELECTRO SUR', 'electro sur', 'ELECTRO SUR SRL', '30-11111111-1',
             'DISTRIBUIDOR', 'Distribuidor electrico', 'Av. Mitre 1234', 'Avellaneda',
             'Buenos Aires', 'Lun a Vie 8 a 17', '011 4201-0000', '30 dias',
             'Compra por pedido grande una vez por trimestre.')`
  );
  const contactos = [
    ['Marta Giordano', 'Encargada de compras', 'DECIDE', '011 15-5555-0001', 1, 'ACTIVO'],
    ['Pablo Suarez', 'Mostrador', 'COMPRA', null, 0, 'ACTIVO'],
    ['Hector Blanco', 'Ex gerente', 'DECIDE', null, 0, 'YA_NO_ESTA'],
  ];
  for (const [nombre, cargo, rol, tel, principal, estado] of contactos) {
    ejecutar(
      db,
      `INSERT INTO cliente_contactos (cliente_id, nombre, cargo, rol_compra, telefono, principal, estado)
       VALUES (1, ?, ?, ?, ?, ?, ?)`,
      [nombre, cargo, rol, tel, principal, estado]
    );
  }
});

after(() => {
  cerrarDb();
  fs.rmSync(carpeta, { recursive: true, force: true });
});

describe('datos estaticos del cliente', () => {
  test('la ficha trae razon social, CUIT y actividad', () => {
    const ficha = armarFicha(db, 1);
    assert.equal(ficha.cliente.razonSocial, 'ELECTRO SUR SRL');
    assert.equal(ficha.cliente.cuit, '30-11111111-1');
    assert.equal(ficha.cliente.actividad, 'Distribuidor electrico');
  });

  test('el texto muestra donde ir, cuando y a que telefono', () => {
    const texto = formatearFicha(armarFicha(db, 1));
    assert.match(texto, /Av\. Mitre 1234/);
    assert.match(texto, /Lun a Vie 8 a 17/);
    assert.match(texto, /011 4201-0000/);
  });

  test('las particularidades van tal cual se cargaron', () => {
    const texto = formatearFicha(armarFicha(db, 1));
    assert.match(texto, /Compra por pedido grande una vez por trimestre\./);
  });
});

describe('contactos del cliente', () => {
  test('el principal va primero y con su rol', () => {
    const ficha = armarFicha(db, 1);
    assert.equal(ficha.contactos[0].nombre, 'Marta Giordano');
    assert.equal(ficha.contactos[0].principal, true);
    assert.equal(ficha.contactos[0].rolCompra, 'DECIDE');
  });

  test('el que ya no esta no se lista pero se avisa', () => {
    const texto = formatearFicha(armarFicha(db, 1));
    assert.match(texto, /Marta Giordano/);
    assert.match(texto, /decide/);
    // No aparece en la lista de contactos...
    assert.ok(!texto.includes('• Hector Blanco'));
    // ...pero si como alerta, porque explica caidas de facturacion.
    assert.match(texto, /Cambio el interlocutor: Hector Blanco ya no esta/);
  });
});
