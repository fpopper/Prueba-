// Pruebas del relevamiento de competencia. Es la parte que convierte "vi tal
// marca" en algo que se puede sumar entre cuentas, asi que lo que se verifica
// es la normalizacion, la validacion de las escalas y la agregacion.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, describe, before, after } from 'node:test';
import { abrirDb, cerrarDb, consultar, consultarUna } from '../src/db/db.js';
import { altaVendedor, competenciaDelCliente } from '../src/db/queries.js';
import { importar } from '../src/importador/importar.js';
import { ejecutarHerramienta } from '../src/ia/herramientas.js';
import { armarFicha, formatearFicha } from '../src/negocio/ficha-cliente.js';
import { preguntasEspeciales } from '../src/negocio/preguntas-especiales.js';
import { puntoAplica, CUESTIONARIO_BASE } from '../src/chat/cuestionario.js';
import {
  OPCIONES_MOTIVO,
  OPCIONES_PARTICIPACION,
  OPCIONES_PRECIO,
  competidorEsperado,
  normalizarCompetidor,
  resumirCartera,
  validarRegistro,
} from '../src/negocio/competencia.js';

const TEL = '5491199887766';
let db, carpeta, vendedorId, clienteId;

const VENTAS_CSV = `Codigo Cliente;Cliente;Canal;Fecha;Agente;Familia;Cantidad;Importe Neto
C-9001;METALURGICA DEL OESTE SA;DISTRIBUIDOR;2026-02-10;N.ANTONUCCI;JABALINAS LISAS;300;9600000
C-9001;METALURGICA DEL OESTE SA;DISTRIBUIDOR;2026-03-10;N.ANTONUCCI;TOMACABLES;20;230000
`;

before(() => {
  carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'facbsa-comp-'));
  const csv = path.join(carpeta, 'ventas.csv');
  fs.writeFileSync(csv, VENTAS_CSV, 'utf8');
  importar(csv, { rutaDb: path.join(carpeta, 'test.db') });
  db = abrirDb(path.join(carpeta, 'test.db'));
  altaVendedor(db, { telefono: TEL, nombre: 'Vendedor Prueba', agente: 'N.ANTONUCCI' });
  vendedorId = consultarUna(db, 'SELECT id FROM vendedores WHERE telefono = ?', [TEL]).id;
  clienteId = consultarUna(db, 'SELECT id FROM clientes LIMIT 1').id;
});

after(() => {
  cerrarDb();
  fs.rmSync(carpeta, { recursive: true, force: true });
});

function visitaAbierta() {
  const contexto = { telefono: TEL, vendedorId, vendedorNombre: 'Vendedor Prueba', visitaId: null };
  ejecutarHerramienta(db, contexto, 'abrir_visita', { cliente_id: clienteId, nombre_nuevo: null });
  return contexto;
}

describe('catálogo de competidores', () => {
  test('reconoce al competidor aunque el vendedor lo nombre al pasar', () => {
    assert.equal(normalizarCompetidor('se los compran a Sicame').competidor, 'SICAME');
    assert.equal(normalizarCompetidor('GENROD').competidor, 'GENROD');
    assert.equal(normalizarCompetidor('un importado chino').competidor, 'IMPORTADO SIN MARCA');
  });

  test('un competidor desconocido no se fuerza dentro de otro: queda marcado', () => {
    const r = normalizarCompetidor('Conductores del Litoral');
    assert.equal(r.conocido, false);
    assert.equal(r.competidor, 'CONDUCTORES DEL LITORAL');
  });

  test('sabe quién suele competir en cada familia', () => {
    assert.ok(competidorEsperado('TOMACABLES').includes('SICAME'));
    assert.deepEqual(competidorEsperado('FAMILIA QUE NO EXISTE'), []);
  });
});

describe('validación de un registro', () => {
  test('acepta un registro completo y le pone el valor numérico a la escala', () => {
    const r = validarRegistro({
      competidor: 'Sicame', familia: 'TOMACABLES',
      participacion: 'Todo se lo compran', precio_relativo: 'Algo más barato', motivo: 'Precio',
    });
    assert.equal(r.ok, true);
    assert.equal(r.fila.competidor, 'SICAME');
    assert.equal(r.fila.participacionValor, 1);
    assert.ok(r.fila.precioValor < 0, 'más barato tiene que dar negativo');
  });

  test('rechaza una escala inventada', () => {
    const r = validarRegistro({ competidor: 'Genrod', familia: 'JABALINAS LISAS', participacion: 'bastante' });
    assert.equal(r.ok, false);
    assert.match(r.error, /participacion tiene que ser/);
  });

  test('exige la familia: sin eso el dato no sirve para nada', () => {
    const r = validarRegistro({ competidor: 'Genrod', familia: '' });
    assert.equal(r.ok, false);
    assert.match(r.error, /familia/i);
  });

  test('las opciones entran en un botón de WhatsApp', () => {
    for (const op of [...OPCIONES_PARTICIPACION, ...OPCIONES_PRECIO, ...OPCIONES_MOTIVO]) {
      assert.ok(op.length <= 20, `"${op}" supera 20 caracteres`);
    }
  });
});

describe('registro durante la visita', () => {
  test('guarda una entrada por competidor y familia', () => {
    const contexto = visitaAbierta();
    const { resultado } = ejecutarHerramienta(db, contexto, 'registrar_competencia', {
      competidores: [
        { competidor: 'Sicame', familia: 'TOMACABLES', participacion: 'Todo se lo compran',
          precio_relativo: 'Algo más barato', motivo: 'Precio', volumen: '40 por mes', observacion: null },
        { competidor: 'Genrod', familia: 'JABALINAS LISAS', participacion: 'Una parte chica',
          precio_relativo: null, motivo: null, volumen: null, observacion: null },
      ],
    });

    assert.equal(resultado.guardados.length, 2);
    const filas = consultar(db, 'SELECT * FROM competencia WHERE visita_id = ?', [contexto.visitaId]);
    assert.equal(filas.length, 2);
    assert.equal(filas.find((f) => f.competidor === 'SICAME').participacion_valor, 1);
  });

  test('avisa qué le falta a cada registro para poder pedirlo conversando', () => {
    const contexto = visitaAbierta();
    const { resultado } = ejecutarHerramienta(db, contexto, 'registrar_competencia', {
      competidores: [{ competidor: 'Genrod', familia: 'JABALINAS LISAS', participacion: null,
        precio_relativo: null, motivo: null, volumen: null, observacion: null }],
    });
    assert.equal(resultado.incompletos.length, 1);
    assert.equal(resultado.incompletos[0].falta.length, 3);
  });

  test('una corrección del vendedor pisa el registro anterior', () => {
    const contexto = visitaAbierta();
    const uno = { competidor: 'Sicame', familia: 'TOMACABLES', participacion: 'Casi nada',
      precio_relativo: null, motivo: null, volumen: null, observacion: null };
    ejecutarHerramienta(db, contexto, 'registrar_competencia', { competidores: [uno] });
    ejecutarHerramienta(db, contexto, 'registrar_competencia', {
      competidores: [{ ...uno, participacion: 'La mayor parte' }],
    });

    const filas = consultar(
      db, "SELECT * FROM competencia WHERE visita_id = ? AND competidor = 'SICAME'", [contexto.visitaId]
    );
    assert.equal(filas.length, 1);
    assert.equal(filas[0].participacion, 'La mayor parte');
  });

  test('rechaza el registro sin visita abierta', () => {
    const contexto = { telefono: TEL, vendedorId, vendedorNombre: 'X', visitaId: null };
    const { resultado } = ejecutarHerramienta(db, contexto, 'registrar_competencia', { competidores: [] });
    assert.match(resultado.error, /visita abierta/i);
  });
});

describe('vuelve a la ficha de la próxima visita', () => {
  test('lo relevado aparece en la ficha y dispara la alerta', () => {
    const contexto = visitaAbierta();
    ejecutarHerramienta(db, contexto, 'registrar_competencia', {
      competidores: [{ competidor: 'Genrod', familia: 'CABLE IRAM 2467', participacion: 'La mayor parte',
        precio_relativo: 'Mucho más barato', motivo: 'Precio', volumen: null, observacion: null }],
    });

    const guardado = competenciaDelCliente(db, clienteId);
    assert.ok(guardado.some((c) => c.competidor === 'GENROD'));

    const ficha = armarFicha(db, clienteId);
    assert.match(formatearFicha(ficha), /Competencia relevada/);
    assert.ok(ficha.alertas.some((a) => /GENROD se lleva/.test(a.texto)));
  });

  test('la próxima visita pregunta si eso cambió, en vez de preguntarlo de cero', () => {
    const ficha = armarFicha(db, clienteId);
    const ids = preguntasEspeciales(ficha).map((p) => p.id);
    assert.ok(ids.includes('COMPETENCIA_CONOCIDA'));
  });
});

describe('agregación de la cartera', () => {
  test('resume por competidor y por familia, y marca los que faltan clasificar', () => {
    const resumen = resumirCartera([
      { cliente_id: 1, competidor: 'GENROD', competidor_conocido: 1, familia: 'JABALINAS LISAS',
        participacion_valor: 0.75, precio_valor: -0.08, motivo: 'Precio' },
      { cliente_id: 2, competidor: 'GENROD', competidor_conocido: 1, familia: 'CABLE IRAM 2467',
        participacion_valor: 0.5, precio_valor: -0.2, motivo: 'Precio' },
      { cliente_id: 3, competidor: 'TALLER DEL SUR', competidor_conocido: 0, familia: 'JABALINAS LISAS',
        participacion_valor: 0.25, precio_valor: null, motivo: 'Plazo de pago' },
    ]);

    const genrod = resumen.competidores[0];
    assert.equal(genrod.competidor, 'GENROD');
    assert.equal(genrod.cuentas, 2);
    assert.equal(genrod.motivoPrincipal, 'Precio');
    assert.ok(genrod.brechaPrecioPromedio < 0);

    const jabalinas = resumen.familias.find((f) => f.familia === 'JABALINAS LISAS');
    assert.equal(jabalinas.cuentas, 2);
    assert.deepEqual(resumen.sinClasificar, ['TALLER DEL SUR']);
  });
});

describe('preguntas condicionales', () => {
  test('si no hay competencia, los puntos que dependen de eso no aplican', () => {
    const familia = CUESTIONARIO_BASE.find((p) => p.id === 'competencia_familia');
    assert.equal(puntoAplica(familia, { competencia_quien: 'NINGUNO' }), false);
    assert.equal(puntoAplica(familia, { competencia_quien: 'Sicame' }), true);
    assert.equal(puntoAplica(familia, {}), true, 'mientras no se sepa, sigue pendiente');
  });

  test('una visita sin competencia se puede cerrar igual', () => {
    const contexto = visitaAbierta();
    const puntos = armarPuntos(db, contexto.visitaId);
    const respuestas = puntos
      .filter((p) => p.obligatoria)
      .map((p) => ({
        pregunta_id: p.pregunta_id,
        respuesta: p.pregunta_id === 'competencia_quien'
          ? 'NINGUNO'
          : (p.opciones_validas ? p.opciones_validas[0] : 'lo que contó el vendedor'),
      }));

    const registro = ejecutarHerramienta(db, contexto, 'registrar_respuestas', { respuestas });
    assert.equal(registro.resultado.pendientes.length, 0, 'los puntos de competencia dejan de contar');

    const cierre = ejecutarHerramienta(db, contexto, 'cerrar_visita', {});
    assert.equal(cierre.resultado.cerrada, true);
  });
});

// Los puntos tal como se los devolvemos al agente al abrir la visita.
function armarPuntos(db, visitaId) {
  const contexto = { telefono: TEL, vendedorId, vendedorNombre: 'X', visitaId };
  const { resultado } = ejecutarHerramienta(db, contexto, 'registrar_respuestas', { respuestas: [] });
  return resultado.pendientes;
}
