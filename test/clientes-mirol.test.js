// Importador del maestro de clientes de Mirol. Las filas de prueba imitan lo
// que trae el archivo real: localidades escritas de cualquier forma, CUIT de
// relleno, observaciones que mezclan riesgo con descuentos, y contactos con el
// telefono metido adentro del nombre.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, describe, before, after } from 'node:test';
import { abrirDb, cerrarDb, consultar, consultarUna } from '../src/db/db.js';
import {
  importarClientes,
  mapearCliente,
  normalizarLocalidad,
  separarContacto,
  separarObservacion,
} from '../src/importador/clientes-mirol.js';

const CABECERA = [
  'CliNum', 'CliNom', 'CliCuit', 'TipCliCod', 'CliFec', 'CliDir', 'CliLoc',
  'PciaCod', 'CliTel1', 'CliEmail', 'CliObser', 'CliLugEnt', 'CliCon1',
  'CliCon2', 'CliCon3', 'AgeNum',
].join(';');

const FILAS = [
  '1001;ELECTRICIDAD DEL NORTE SRL;30-70889779-1;60;39373;RANCAGUA 5117;CAP.FED.;C;0351-4991512;ventas@edn.com.ar;;RETIRAN SAN FERNANDO;MARIO (CEL.1549942925);;;11',
  '1002;OBRAS DEL SUR SA;00-00000000-0;62;950;MITRE 440;CAPITAL FEDERAL;C;;;NO VENDER;;;;;19',
  '1003;CASA GRANDE SH;30-57770363-5;2;42586;CALLE 29 Y 12;SGO.DEL ESTERO;G;02324-423648;;30+5;A CONVENIR;SR. ANIBAL (15-57022751);ANALIA;;44',
].join('\n');

let db;
let carpeta;

before(() => {
  carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'facbsa-mirol-'));
  fs.writeFileSync(path.join(carpeta, 'CLIENTES.csv'), `${CABECERA}\n${FILAS}\n`, 'utf8');
  db = abrirDb(path.join(carpeta, 'test.db'));
  importarClientes(db, path.join(carpeta, 'CLIENTES.csv'));
});

after(() => {
  cerrarDb();
  fs.rmSync(carpeta, { recursive: true, force: true });
});

describe('normalizacion de localidades', () => {
  test('las quince formas de escribir Capital Federal son una sola', () => {
    for (const v of ['CAP.FED.', 'CAPITAL FEDERAL', 'CAP.FEDERAL', 'CAPITAL', 'cap fed']) {
      assert.equal(normalizarLocalidad(v), 'CABA');
    }
  });

  test('el resto se capitaliza, sin inventar', () => {
    assert.equal(normalizarLocalidad('SAN MARTIN'), 'San Martin');
    assert.equal(normalizarLocalidad('  BAHIA BLANCA '), 'Bahia Blanca');
    assert.equal(normalizarLocalidad(''), null);
  });
});

describe('CliObser mezcla tres campos distintos', () => {
  test('separa la marca de riesgo de la observacion', () => {
    const r = separarObservacion('NO VENDER');
    assert.deepEqual(r.marcas, ['NO VENDER']);
    assert.equal(r.particularidades, null);
  });

  test('un descuento en cascada no es una particularidad', () => {
    assert.equal(separarObservacion('30+5').particularidades, null);
    assert.equal(separarObservacion('32+5+3').particularidades, null);
  });

  test('la observacion de verdad sobrevive', () => {
    const r = separarObservacion('CERRO - pedir por mail');
    assert.deepEqual(r.marcas, ['CERRÓ']);
    assert.equal(r.particularidades, 'pedir por mail');
  });
});

describe('contactos con el telefono adentro del nombre', () => {
  test('lo separa', () => {
    assert.deepEqual(separarContacto('MARIO (CEL.1549942925)'), {
      nombre: 'MARIO',
      telefono: '1549942925',
    });
    assert.deepEqual(separarContacto('SR. ANIBAL (15-57022751)'), {
      nombre: 'SR. ANIBAL',
      telefono: '15-57022751',
    });
  });

  test('un nombre sin telefono queda igual', () => {
    assert.deepEqual(separarContacto('ANALIA'), { nombre: 'ANALIA', telefono: null });
  });
});

describe('mapeo de una fila', () => {
  test('traduce la provincia y la actividad conocida', () => {
    const c = mapearCliente({ CliNum: '1', CliNom: 'X', PciaCod: 'G', TipCliCod: '61' });
    assert.equal(c.provincia, 'Santiago del Estero');
    assert.equal(c.actividad, 'Distribuidora eléctrica');
  });

  test('un codigo de actividad sin traducir se guarda crudo, no se inventa', () => {
    const c = mapearCliente({ CliNum: '1', CliNom: 'X', TipCliCod: '4' });
    assert.equal(c.actividad, null);
    assert.equal(c.actividadCodigo, '4');
  });

  test('descarta el CUIT de relleno', () => {
    assert.equal(mapearCliente({ CliNum: '1', CliNom: 'X', CliCuit: '00-00000000-0' }).cuit, null);
    assert.equal(mapearCliente({ CliNum: '1', CliNom: 'X', CliCuit: '30-1-9' }).cuit, '30-1-9');
  });

  test('descarta fechas de alta imposibles', () => {
    assert.equal(mapearCliente({ CliNum: '1', CliNom: 'X', CliFec: '950' }).clienteDesde, null);
    assert.equal(mapearCliente({ CliNum: '1', CliNom: 'X', CliFec: '39373' }).clienteDesde, '2007-10-18');
  });
});

describe('importacion completa', () => {
  test('carga los tres clientes con sus datos estaticos', () => {
    const c = consultarUna(db, "SELECT * FROM clientes WHERE codigo = '1001'");
    assert.equal(c.nombre, 'ELECTRICIDAD DEL NORTE SRL');
    assert.equal(c.localidad, 'CABA');
    assert.equal(c.provincia, 'CABA');
    assert.equal(c.actividad, 'Distribuidor eléctrico');
    assert.match(c.particularidades, /Entrega: RETIRAN SAN FERNANDO/);
  });

  test('la marca del vendedor queda aparte de las particularidades', () => {
    const c = consultarUna(db, "SELECT * FROM clientes WHERE codigo = '1002'");
    assert.equal(c.marcas, 'NO VENDER');
    assert.equal(c.cuit, null);
  });

  test('los contactos entran como semilla, a confirmar', () => {
    const id = consultarUna(db, "SELECT id FROM clientes WHERE codigo = '1003'").id;
    const cs = consultar(db, 'SELECT * FROM cliente_contactos WHERE cliente_id = ?', [id]);
    assert.equal(cs.length, 2);
    assert.equal(cs[0].estado, 'A_CONFIRMAR');
    const anibal = cs.find((x) => x.nombre === 'SR. ANIBAL');
    assert.equal(anibal.telefono, '15-57022751');
    assert.equal(anibal.principal, 1);
  });

  test('reimportar no duplica contactos ni pisa lo cargado a mano', () => {
    const id = consultarUna(db, "SELECT id FROM clientes WHERE codigo = '1001'").id;
    db.prepare('UPDATE clientes SET particularidades = ? WHERE id = ?').run('Lo corrigio el vendedor', id);
    importarClientes(db, path.join(carpeta, 'CLIENTES.csv'));
    const c = consultarUna(db, 'SELECT * FROM clientes WHERE id = ?', [id]);
    assert.equal(c.particularidades, 'Lo corrigio el vendedor');
    const cs = consultar(db, 'SELECT * FROM cliente_contactos WHERE cliente_id = ?', [id]);
    assert.equal(cs.length, 1);
  });
});
