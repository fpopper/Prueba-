// Pruebas de las reglas de negocio. Son las que hay que correr cuando Comercial
// cambia un umbral: si un cambio rompe algo, aparece aca.
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  asignarSegmentos,
  calcularGapTomacables,
  grupoAgente,
  normalizarFamilia,
  normalizarTexto,
  pesos,
  plazosInactividad,
} from '../src/negocio/reglas.js';
import { preguntasEspeciales } from '../src/negocio/preguntas-especiales.js';
import { validarRespuesta, armarCuestionario } from '../src/chat/cuestionario.js';
import { aFecha, aNumero, detectarColumnas, parsearCsv } from '../src/importador/normalizar.js';

describe('identidad de agentes', () => {
  test('FACSA y FACBSA son la misma cosa: Venta Directa', () => {
    assert.equal(grupoAgente('FACBSA'), 'Venta Directa');
    assert.equal(grupoAgente('FACSA'), 'Venta Directa');
    assert.equal(grupoAgente('N.ANTONUCCI'), 'Venta Directa');
    assert.equal(grupoAgente('SERGIO ELLERO'), 'Venta Directa');
  });

  test('cualquier otro agente es representante externo', () => {
    assert.equal(grupoAgente('NOA REPRESENTACIONES'), 'Representante');
  });
});

describe('segmentacion por percentiles de la cartera', () => {
  // Definida por Comercial: A = el primer 50% de la facturacion acumulada,
  // B hasta el 80%, C hasta el 95%, D la cola. No hay umbrales en pesos.
  const cartera = [
    { id: 'grande', facturacion: 100 },
    { id: 'media', facturacion: 60 },
    { id: 'chica', facturacion: 25 },
    { id: 'cola', facturacion: 10 },
    { id: 'minima', facturacion: 5 },
    { id: 'sin_compras', facturacion: 0 },
  ];

  test('el corte sigue el acumulado de la facturacion, no un monto', () => {
    const segmentos = asignarSegmentos(cartera);
    assert.equal(segmentos.get('grande'), 'A');
    assert.equal(segmentos.get('media'), 'B');
    assert.equal(segmentos.get('chica'), 'C');
    // 'cola' entra todavia en C porque es la que cruza el 95%; recien la
    // siguiente cae en la cola de la cartera.
    assert.equal(segmentos.get('cola'), 'C');
    assert.equal(segmentos.get('minima'), 'D');
  });

  test('una cuenta sin compras en el periodo cae en D', () => {
    assert.equal(asignarSegmentos(cartera).get('sin_compras'), 'D');
  });

  test('multiplicar toda la cartera por inflacion no cambia ningun segmento', () => {
    const antes = asignarSegmentos(cartera);
    const inflada = cartera.map((c) => ({ ...c, facturacion: c.facturacion * 3.7 }));
    const despues = asignarSegmentos(inflada);
    for (const c of cartera) assert.equal(despues.get(c.id), antes.get(c.id));
  });

  test('con una sola cuenta activa, esa cuenta es A', () => {
    assert.equal(asignarSegmentos([{ id: 'unica', facturacion: 1000 }]).get('unica'), 'A');
  });
});

describe('inactividad por canal', () => {
  test('cada canal tiene su plazo, segun su ciclo de compra', () => {
    assert.equal(plazosInactividad('DISTRIBUIDOR').dormido, 60);
    assert.equal(plazosInactividad('EMPRESA ENERGIA').dormido, 120);
    assert.equal(plazosInactividad('CONSTRUCTORA').dormido, 180);
  });

  test('un canal desconocido usa el plazo por defecto', () => {
    assert.deepEqual(plazosInactividad('MAYORISTA'), { dormido: 90, perdido: 180 });
    assert.deepEqual(plazosInactividad(null), { dormido: 90, perdido: 180 });
  });
});

describe('gap de tomacables', () => {
  test('el objetivo es 1 tomacable cada 1,5 jabalinas', () => {
    const r = calcularGapTomacables(150, 20, 10_000);
    assert.equal(r.aplica, true);
    assert.equal(Math.round(r.gapUnidades), 80); // 150 / 1,5 - 20
    assert.equal(Math.round(r.gapPesos), 800_000);
  });

  test('por debajo de 20 jabalinas el ratio es ruido y no se calcula', () => {
    assert.equal(calcularGapTomacables(15, 0, 10_000).aplica, false);
  });

  test('un cliente que ya cumple el ratio no tiene gap', () => {
    assert.equal(calcularGapTomacables(150, 100, 10_000).gapUnidades, 0);
  });
});

describe('familias de producto', () => {
  test('los alias del sistema legacy se mapean a la familia canonica', () => {
    assert.equal(normalizarFamilia('Cable IRAM 2467 - 50mm').familia, 'CABLE IRAM 2467');
    assert.equal(normalizarFamilia('jabalinas lisas 14').familia, 'JABALINAS LISAS');
    assert.equal(normalizarFamilia('Toma cables bronce').familia, 'TOMACABLES');
    assert.equal(normalizarFamilia('VARIOS (Conjuntos)').familia, 'VARIOS (CONJUNTOS)');
  });

  test('una familia desconocida no se inventa: queda sin clasificar', () => {
    const r = normalizarFamilia('MORSETERIA ESPECIAL');
    assert.equal(r.clasificada, false);
    assert.equal(r.familia, 'MORSETERIA ESPECIAL');
  });
});

function fichaDe(sobrescribir = {}) {
  return {
    cliente: { id: 1, nombre: 'CLIENTE TEST', canal: 'DISTRIBUIDOR' },
    metricas: {
      facturacion12m: 20_000_000,
      variacionTrim: 0.05,
      participacion: 0.02,
      segmento: 'B',
      diasSinComprar: 10,
      jabalinas: 0,
      tomacables: 0,
      ratioTomacables: null,
      gapTomacablesU: 0,
      gapTomacablesPesos: 0,
      cuentaCompartida: false,
      agenteSecundario: null,
      agentePrincipal: 'FACBSA',
      ...(sobrescribir.metricas || {}),
    },
    familias: sobrescribir.familias || [{ familia: 'CABLE IRAM 2467', cantidad: 100, importe: 20_000_000 }],
    esProspecto: false,
    alertas: [],
    ultimasVisitas: [],
    ...(sobrescribir.raiz || {}),
  };
}

describe('preguntas especiales', () => {
  test('una cuenta clave que se cae dispara la pregunta de churn primero', () => {
    const ficha = fichaDe({ metricas: { segmento: 'A', variacionTrim: -0.3, facturacion12m: 90_000_000 } });
    const preguntas = preguntasEspeciales(ficha);
    assert.equal(preguntas[0].id, 'CHURN_CUENTA_CLAVE');
    assert.equal(preguntas[0].nivel, 'CRITICO');
  });

  test('la alerta de caida tambien alcanza al segmento B', () => {
    const ficha = fichaDe({ metricas: { segmento: 'B', variacionTrim: -0.2 } });
    assert.ok(preguntasEspeciales(ficha).some((p) => p.id === 'CHURN_CUENTA_CLAVE'));
  });

  test('en segmento C una caida igual no dispara la alerta', () => {
    const ficha = fichaDe({ metricas: { segmento: 'C', variacionTrim: -0.2 } });
    assert.ok(!preguntasEspeciales(ficha).some((p) => p.id === 'CHURN_CUENTA_CLAVE'));
  });

  test('un cliente con gap de tomacables recibe la pregunta del gap', () => {
    const ficha = fichaDe({
      metricas: { jabalinas: 400, tomacables: 30, ratioTomacables: 0.075, gapTomacablesU: 170, gapTomacablesPesos: 2_000_000 },
    });
    const ids = preguntasEspeciales(ficha).map((p) => p.id);
    assert.ok(ids.includes('GAP_TOMACABLES'));
  });

  test('un cliente que compra mas tomacables que jabalinas dispara el gap invertido', () => {
    const ficha = fichaDe({ metricas: { jabalinas: 100, tomacables: 120, ratioTomacables: 1.2 } });
    const ids = preguntasEspeciales(ficha).map((p) => p.id);
    assert.ok(ids.includes('GAP_INVERTIDO_JABALINAS'));
  });

  test('un prospecto sin historia recibe la pregunta de prospecto', () => {
    const ficha = fichaDe({ metricas: { facturacion12m: 0, segmento: 'D' }, raiz: { esProspecto: true } });
    const ids = preguntasEspeciales(ficha).map((p) => p.id);
    assert.ok(ids.includes('PROSPECTO_NUEVO'));
  });

  test('nunca se le mandan mas de 4 preguntas especiales al vendedor', () => {
    const ficha = fichaDe({
      metricas: {
        segmento: 'A', variacionTrim: -0.4, participacion: 0.3, diasSinComprar: 200,
        jabalinas: 500, tomacables: 10, ratioTomacables: 0.02, gapTomacablesU: 240,
        gapTomacablesPesos: 3_000_000, cuentaCompartida: true, agenteSecundario: 'X',
        agenteSecundarioPct: 0.4,
      },
    });
    assert.ok(preguntasEspeciales(ficha).length <= 4);
  });

  test('una regla que falla por un dato faltante no rompe el briefing', () => {
    assert.doesNotThrow(() => preguntasEspeciales({ cliente: {}, metricas: {}, familias: [] }));
  });
});

describe('cuestionario', () => {
  test('las opciones se responden con el numero', () => {
    const pregunta = { tipo: 'opciones', opciones: ['Si', 'No'], obligatoria: true };
    assert.equal(validarRespuesta(pregunta, { texto: '2' }).valor, 'No');
    assert.equal(validarRespuesta(pregunta, { texto: '9' }).ok, false);
  });

  test('no se puede saltear una pregunta especial', () => {
    const pregunta = { tipo: 'texto', obligatoria: true, origen: 'especial' };
    const r = validarRespuesta(pregunta, { texto: 'saltar' });
    assert.equal(r.ok, false);
    assert.match(r.error, /oficina/);
  });

  test('las opcionales si se pueden saltear', () => {
    const pregunta = { tipo: 'texto', obligatoria: false, origen: 'base' };
    assert.equal(validarRespuesta(pregunta, { texto: 'SALTAR' }).respuesta, '(omitida)');
  });

  test('las preguntas especiales van despues de las de rutina y antes del cierre', () => {
    const preguntas = armarCuestionario([{ id: 'X', pregunta: '¿?', motivo: 'porque', tipo: 'texto' }]);
    const indiceEspecial = preguntas.findIndex((p) => p.origen === 'especial');
    const indiceFoto = preguntas.findIndex((p) => p.id === 'foto');
    assert.ok(indiceEspecial > 0);
    assert.ok(indiceFoto > indiceEspecial);
  });
});

describe('lectura del archivo de ventas', () => {
  test('los importes en formato argentino se leen bien', () => {
    assert.equal(aNumero('1.234.567,89'), 1234567.89);
    assert.equal(aNumero('$ 45.000'), 45000);
    assert.equal(aNumero('1234.56'), 1234.56);
    assert.equal(aNumero('(1.200,50)'), -1200.5);
    assert.equal(aNumero(''), 0);
  });

  test('las fechas se aceptan en los formatos que exporta el sistema', () => {
    assert.equal(aFecha('15/03/2026'), '2026-03-15');
    assert.equal(aFecha('2026-03-15'), '2026-03-15');
    assert.equal(aFecha('46096'), '2026-03-15'); // serial de Excel
  });

  test('las columnas se detectan aunque cambie el encabezado', () => {
    const { mapeo, faltantes } = detectarColumnas([
      'Razón Social', 'Fecha Comprobante', 'Vendedor', 'Rubro Producto', 'Cant.', 'Importe Neto',
    ]);
    assert.equal(faltantes.length, 0);
    assert.equal(mapeo.cliente, 0);
    assert.equal(mapeo.fecha, 1);
    assert.equal(mapeo.agente, 2);
    assert.equal(mapeo.importe, 5);
  });

  test('el CSV respeta las comillas y detecta el separador', () => {
    const filas = parsearCsv('a;b\n"uno;con punto y coma";dos');
    assert.deepEqual(filas[1], ['uno;con punto y coma', 'dos']);
  });
});

describe('utilidades de formato', () => {
  test('los pesos se muestran en millones con un decimal', () => {
    assert.equal(pesos(122_300_000), '$122,3M');
  });
  test('normalizarTexto saca acentos y mayusculiza', () => {
    assert.equal(normalizarTexto(' Distribuídora  Eléctrica '), 'DISTRIBUIDORA ELECTRICA');
  });
});

describe('visitas que quedan abiertas', () => {
  test('los plazos son los definidos por Comercial', async () => {
    const m = await import('../src/chat/mantenimiento.js');
    assert.equal(m.HORAS_PARA_RECORDAR, 3);
    assert.equal(m.HORAS_PARA_CERRAR, 12);
  });

  test('el recordatorio nombra al cliente y no pide comandos', async () => {
    const { textoRecordatorio } = await import('../src/chat/mantenimiento.js');
    const texto = textoRecordatorio('ELECTRO MAYORISTA');
    assert.match(texto, /ELECTRO MAYORISTA/);
    assert.ok(!/escrib[ií] FIN/i.test(texto));
  });
});
