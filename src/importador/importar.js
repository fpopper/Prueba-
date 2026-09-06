#!/usr/bin/env node
// Importador del Excel de ventas -> base del bot.
//
//   npm run importar -- ventas.xlsx
//   npm run importar -- ventas.xlsx --hoja "Detalle" --reset
//   npm run importar -- ventas.csv --vendedores vendedores.csv
//
// Aplica las reglas de negocio ANTES de agregar (consolidacion de Venta
// Directa, familias, atribucion de cuentas compartidas), calcula las metricas
// por cliente y valida el total contra el archivo.
import fs from 'node:fs';
import path from 'node:path';
import { abrirDb, ejecutar, enTransaccion, guardarParametro } from '../db/db.js';
import { altaVendedor } from '../db/queries.js';
import {
  MINIMO_JABALINAS_PARA_GAP,
  UMBRAL_AGENTE_SECUNDARIO,
  calcularGapTomacables,
  grupoAgente,
  pesos,
  porcentaje,
  segmentar,
  unidades,
} from '../negocio/reglas.js';
import { buscarFilaEncabezado, detectarColumnas, normalizarFila, parsearCsv } from './normalizar.js';
import { leerHoja, listarHojas } from './xlsx.js';

const DIA = 86_400_000;

function leerArchivo(ruta, hoja) {
  const extension = path.extname(ruta).toLowerCase();
  if (extension === '.csv' || extension === '.txt') {
    return parsearCsv(fs.readFileSync(ruta, 'utf8'));
  }
  if (extension === '.xlsx' || extension === '.xlsm') {
    const hojas = listarHojas(ruta);
    console.log(`  Hojas del libro: ${hojas.join(' | ')}`);
    return leerHoja(ruta, hoja ?? 0);
  }
  throw new Error(`Extension no soportada: ${extension}. Usa .xlsx o .csv.`);
}

export function importar(rutaArchivo, opciones = {}) {
  const db = abrirDb(opciones.rutaDb);

  console.log(`\n  Leyendo ${rutaArchivo}`);
  const filas = leerArchivo(rutaArchivo, opciones.hoja);
  if (!filas.length) throw new Error('El archivo no tiene filas.');

  const filaEncabezado = buscarFilaEncabezado(filas);
  if (filaEncabezado === -1) {
    throw new Error(
      'No pude identificar la fila de encabezados. Revisa que el archivo tenga columnas de cliente, fecha e importe.'
    );
  }

  const encabezados = filas[filaEncabezado];
  const { mapeo, faltantes } = detectarColumnas(encabezados);

  console.log(`  Encabezados en la fila ${filaEncabezado + 1}`);
  console.log('  Columnas detectadas:');
  for (const [campo, indice] of Object.entries(mapeo)) {
    console.log(`    ${campo.padEnd(10)} <- "${encabezados[indice]}"`);
  }

  if (faltantes.length) {
    throw new Error(
      `Faltan columnas obligatorias: ${faltantes.join(', ')}. ` +
        'Renombra el encabezado en el Excel o agrega el alias en src/importador/normalizar.js.'
    );
  }

  const datos = filas.slice(filaEncabezado + 1);
  let totalCrudo = 0;
  let descartadas = 0;
  let importeDescartado = 0;
  const registros = [];
  const familiasSinClasificar = new Set();

  for (const fila of datos) {
    const registro = normalizarFila(fila, mapeo);
    const importeFila = registro ? registro.venta.importe : 0;
    if (!registro) {
      const posibleImporte = mapeo.importe !== undefined ? fila[mapeo.importe] : 0;
      const n = Number(String(posibleImporte ?? '').replace(/[^\d.-]/g, ''));
      if (Number.isFinite(n)) importeDescartado += n;
      descartadas++;
      continue;
    }
    totalCrudo += importeFila;
    if (!registro.venta.familiaClasificada && registro.venta.familiaCruda) {
      familiasSinClasificar.add(registro.venta.familia);
    }
    registros.push(registro);
  }

  if (!registros.length) throw new Error('No se pudo normalizar ninguna fila.');

  // --- Carga en la base ------------------------------------------------------
  enTransaccion(db, () => {
    if (opciones.reset) {
      db.exec('DELETE FROM ventas; DELETE FROM cliente_familia; DELETE FROM cliente_metricas;');
      // Los clientes no se borran: hay visitas que los referencian.
    }

    const insCliente = db.prepare(
      `INSERT INTO clientes (codigo, nombre, nombre_busqueda, cuit, canal, localidad, provincia)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const buscarPorNombre = db.prepare('SELECT id FROM clientes WHERE nombre_busqueda = ?');
    const buscarPorCodigo = db.prepare('SELECT id FROM clientes WHERE codigo = ?');
    const actualizarCliente = db.prepare(
      `UPDATE clientes SET canal = COALESCE(?, canal), localidad = COALESCE(?, localidad),
              provincia = COALESCE(?, provincia), cuit = COALESCE(?, cuit),
              codigo = COALESCE(?, codigo), actualizado_en = datetime('now')
       WHERE id = ?`
    );
    const insVenta = db.prepare(
      `INSERT INTO ventas (cliente_id, fecha, agente, agente_grupo, canal, familia,
                           familia_cruda, articulo, cantidad, importe)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const cache = new Map();

    for (const { cliente, venta } of registros) {
      const clave = cliente.codigo || cliente.nombreBusqueda;
      let clienteId = cache.get(clave);

      if (!clienteId) {
        const existente =
          (cliente.codigo ? buscarPorCodigo.get(cliente.codigo) : null) ||
          buscarPorNombre.get(cliente.nombreBusqueda);
        if (existente) {
          clienteId = existente.id;
          actualizarCliente.run(
            cliente.canal, cliente.localidad, cliente.provincia, cliente.cuit,
            cliente.codigo, clienteId
          );
        } else {
          const res = insCliente.run(
            cliente.codigo, cliente.nombre, cliente.nombreBusqueda, cliente.cuit,
            cliente.canal, cliente.localidad, cliente.provincia
          );
          clienteId = Number(res.lastInsertRowid);
        }
        cache.set(clave, clienteId);
      }

      insVenta.run(
        clienteId, venta.fecha, venta.agente, venta.agenteGrupo, venta.canal,
        venta.familia, venta.familiaCruda, venta.articulo, venta.cantidad, venta.importe
      );
    }
  });

  // --- Metricas --------------------------------------------------------------
  const resumen = recalcularMetricas(db);

  // --- Validacion del total --------------------------------------------------
  const totalEnBase = db.prepare('SELECT COALESCE(SUM(importe), 0) AS t FROM ventas').get().t;
  const desvio = totalCrudo === 0 ? 0 : Math.abs(totalEnBase - totalCrudo) / totalCrudo;

  // --- Vendedores ------------------------------------------------------------
  let vendedoresCargados = 0;
  if (opciones.vendedores) {
    vendedoresCargados = importarVendedores(db, opciones.vendedores);
  }

  guardarParametro(db, 'ultimo_import', new Date().toISOString());

  // --- Informe ---------------------------------------------------------------
  console.log('\n  --- Import terminado ---------------------------------------');
  console.log(`  Filas leidas:          ${unidades(datos.length)}`);
  console.log(`  Filas importadas:      ${unidades(registros.length)}`);
  if (descartadas) {
    console.log(`  Filas descartadas:     ${unidades(descartadas)} (sin cliente o sin fecha valida)`);
    if (importeDescartado) console.log(`     importe descartado: ${pesos(importeDescartado)}`);
  }
  console.log(`  Fecha de corte:        ${resumen.fechaCorte}`);
  console.log(`  Clientes:              ${unidades(resumen.clientes)}`);
  console.log(`  Cuentas activas 12m:   ${unidades(resumen.activas)}`);
  console.log(`  Facturacion 12m:       ${pesos(resumen.total12m)}`);
  console.log(`  Cuentas compartidas:   ${unidades(resumen.compartidas)}`);
  console.log(`  Gap de tomacables:     ${unidades(resumen.gapUnidades)} u. ≈ ${pesos(resumen.gapPesos)} en ${resumen.clientesConGap} clientes`);

  console.log('\n  Segmentacion:');
  for (const [letra, cantidad] of Object.entries(resumen.segmentos)) {
    console.log(`    ${letra}: ${String(cantidad).padStart(4)} cuentas`);
  }

  if (familiasSinClasificar.size) {
    console.log('\n  ⚠ Familias SIN CLASIFICAR (validar con Comercial):');
    for (const f of familiasSinClasificar) console.log(`    - ${f}`);
  }

  if (desvio > 0.01) {
    console.log(
      `\n  ⚠ El total en base (${pesos(totalEnBase)}) difiere ${porcentaje(desvio, 2)} del archivo (${pesos(totalCrudo)}). Revisar antes de usarlo.`
    );
  } else if (desvio > 0) {
    console.log(`\n  Desvio contra el archivo: ${porcentaje(desvio, 2)} (dentro del 1% aceptable).`);
  }

  if (vendedoresCargados) console.log(`\n  Vendedores dados de alta: ${vendedoresCargados}`);
  console.log('');

  return resumen;
}

// --- Calculo de metricas -----------------------------------------------------

export function recalcularMetricas(db) {
  const corte = db.prepare('SELECT MAX(fecha) AS f FROM ventas').get().f;
  if (!corte) throw new Error('No hay ventas cargadas.');

  const fechaCorte = new Date(`${corte}T00:00:00Z`);
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const desde12m = iso(fechaCorte.getTime() - 365 * DIA);
  const desde24m = iso(fechaCorte.getTime() - 730 * DIA);
  const desdeTrim = iso(fechaCorte.getTime() - 90 * DIA);
  const desdeTrimPrev = iso(fechaCorte.getTime() - 180 * DIA);

  // Precio promedio del tomacable en el periodo: es lo que convierte el gap de
  // unidades a pesos.
  const tc = db
    .prepare(
      `SELECT COALESCE(SUM(importe),0) AS imp, COALESCE(SUM(cantidad),0) AS cant
       FROM ventas WHERE familia = 'TOMACABLES' AND fecha > ?`
    )
    .get(desde12m);
  const precioTomacable = tc.cant > 0 ? tc.imp / tc.cant : 0;

  const total12m = db
    .prepare('SELECT COALESCE(SUM(importe),0) AS t FROM ventas WHERE fecha > ?')
    .get(desde12m).t;

  const clientes = db.prepare('SELECT id FROM clientes').all();

  const resumen = {
    fechaCorte: corte,
    clientes: clientes.length,
    activas: 0,
    total12m,
    compartidas: 0,
    gapUnidades: 0,
    gapPesos: 0,
    clientesConGap: 0,
    segmentos: { A: 0, B: 0, C: 0, D: 0 },
    precioTomacable,
  };

  const sumaPeriodo = db.prepare(
    'SELECT COALESCE(SUM(importe),0) AS t FROM ventas WHERE cliente_id = ? AND fecha > ? AND fecha <= ?'
  );
  const porAgente = db.prepare(
    `SELECT agente, SUM(importe) AS imp FROM ventas
     WHERE cliente_id = ? AND fecha > ? GROUP BY agente ORDER BY imp DESC`
  );
  const porFamilia = db.prepare(
    `SELECT familia, SUM(cantidad) AS cant, SUM(importe) AS imp FROM ventas
     WHERE cliente_id = ? AND fecha > ? GROUP BY familia`
  );
  const resumenCliente = db.prepare(
    `SELECT MAX(fecha) AS ultima, COUNT(DISTINCT fecha) AS operaciones
     FROM ventas WHERE cliente_id = ? AND fecha > ?`
  );

  const calculados = [];

  enTransaccion(db, () => {
    db.exec('DELETE FROM cliente_familia; DELETE FROM cliente_metricas;');

    const insFamilia = db.prepare(
      'INSERT INTO cliente_familia (cliente_id, familia, cantidad_12m, importe_12m) VALUES (?, ?, ?, ?)'
    );

    for (const { id } of clientes) {
      const f12 = sumaPeriodo.get(id, desde12m, corte).t;
      const f12prev = sumaPeriodo.get(id, desde24m, desde12m).t;
      const fTrim = sumaPeriodo.get(id, desdeTrim, corte).t;
      const fTrimPrev = sumaPeriodo.get(id, desdeTrimPrev, desdeTrim).t;

      const familias = porFamilia.all(id, desde12m);
      for (const fam of familias) {
        insFamilia.run(id, fam.familia, fam.cant || 0, fam.imp || 0);
      }

      const jabalinas = familias.find((x) => x.familia === 'JABALINAS LISAS')?.cant || 0;
      const tomacables = familias.find((x) => x.familia === 'TOMACABLES')?.cant || 0;
      const gap = calcularGapTomacables(jabalinas, tomacables, precioTomacable);

      const agentes = porAgente.all(id, desde12m).filter((a) => a.agente);
      const totalAgentes = agentes.reduce((s, a) => s + (a.imp || 0), 0);
      const principal = agentes[0] || null;
      const secundario = agentes[1] || null;
      const pctSecundario = secundario && totalAgentes > 0 ? secundario.imp / totalAgentes : 0;

      const info = resumenCliente.get(id, desde12m);
      const banda = segmentar(f12);
      const diasSinComprar = info.ultima
        ? Math.round((fechaCorte.getTime() - new Date(`${info.ultima}T00:00:00Z`).getTime()) / DIA)
        : null;

      calculados.push({
        id,
        f12,
        f12prev,
        fTrim,
        fTrimPrev,
        segmento: banda.letra,
        modelo: `${banda.modelo} — ${banda.detalle}`,
        ultima: info.ultima,
        diasSinComprar,
        operaciones: info.operaciones || 0,
        ticket: info.operaciones ? f12 / info.operaciones : 0,
        jabalinas,
        tomacables,
        ratio: jabalinas > 0 ? tomacables / jabalinas : null,
        gapU: gap.gapUnidades,
        gapPesos: gap.gapPesos,
        agentePrincipal: principal?.agente || null,
        pctPrincipal: principal && totalAgentes > 0 ? principal.imp / totalAgentes : null,
        agenteSecundario: pctSecundario >= UMBRAL_AGENTE_SECUNDARIO ? secundario.agente : null,
        pctSecundarioValor: pctSecundario >= UMBRAL_AGENTE_SECUNDARIO ? pctSecundario : null,
        compartida: agentes.length > 1 ? 1 : 0,
      });
    }

    // El ranking se calcula sobre el conjunto, por eso va despues del bucle.
    calculados.sort((a, b) => b.f12 - a.f12);

    const insMetricas = db.prepare(
      `INSERT INTO cliente_metricas (
        cliente_id, facturacion_12m, facturacion_12m_prev, facturacion_trim, facturacion_trim_prev,
        participacion, ranking, segmento, modelo_atencion, ultima_compra, dias_sin_comprar,
        operaciones_12m, ticket_promedio, jabalinas_12m, tomacables_12m, ratio_tomacables,
        gap_tomacables_u, gap_tomacables_pesos, agente_principal, agente_principal_pct,
        agente_secundario, agente_secundario_pct, cuenta_compartida)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );

    calculados.forEach((c, indice) => {
      insMetricas.run(
        c.id, c.f12, c.f12prev, c.fTrim, c.fTrimPrev,
        total12m > 0 ? c.f12 / total12m : 0,
        c.f12 > 0 ? indice + 1 : null,
        c.segmento, c.modelo, c.ultima, c.diasSinComprar,
        c.operaciones, c.ticket, c.jabalinas, c.tomacables, c.ratio,
        c.gapU, c.gapPesos, c.agentePrincipal, c.pctPrincipal,
        c.agenteSecundario, c.pctSecundarioValor, c.compartida
      );

      if (c.f12 > 0) resumen.activas++;
      resumen.segmentos[c.segmento] = (resumen.segmentos[c.segmento] || 0) + 1;
      if (c.compartida) resumen.compartidas++;
      if (c.gapU > 0) {
        resumen.gapUnidades += c.gapU;
        resumen.gapPesos += c.gapPesos;
        resumen.clientesConGap++;
      }
    });
  });

  guardarParametro(db, 'fecha_corte', corte);
  guardarParametro(db, 'facturacion_total_12m', total12m);
  guardarParametro(db, 'precio_promedio_tomacable', precioTomacable);
  guardarParametro(db, 'cuentas_activas', resumen.activas);
  guardarParametro(db, 'minimo_jabalinas_gap', MINIMO_JABALINAS_PARA_GAP);

  return resumen;
}

// --- Vendedores --------------------------------------------------------------

// CSV con columnas: telefono;nombre;agente
export function importarVendedores(db, ruta) {
  const filas = parsearCsv(fs.readFileSync(ruta, 'utf8'));
  if (!filas.length) return 0;

  const encabezado = filas[0].map((h) => String(h).trim().toLowerCase());
  const tieneEncabezado = encabezado.some((h) => h.includes('tel'));
  const datos = tieneEncabezado ? filas.slice(1) : filas;

  let cargados = 0;
  for (const fila of datos) {
    const [telefono, nombre, agente] = fila.map((c) => String(c || '').trim());
    if (!telefono || !nombre) continue;
    altaVendedor(db, { telefono, nombre, agente: agente || null, grupo: grupoAgente(agente) });
    cargados++;
  }
  return cargados;
}

// --- CLI ---------------------------------------------------------------------

function principal() {
  const args = process.argv.slice(2);
  const archivo = args.find((a) => !a.startsWith('--'));

  if (!archivo) {
    console.log(`
  Uso:
    npm run importar -- <archivo.xlsx|archivo.csv> [opciones]

  Opciones:
    --hoja "Nombre"        hoja del Excel a leer (por defecto, la primera)
    --reset                borra las ventas anteriores antes de importar
    --vendedores <archivo> CSV de vendedores (telefono;nombre;agente)
    --db <ruta>            base destino (por defecto datos/facbsa.db)
`);
    process.exit(1);
  }

  const valorDe = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };

  try {
    importar(archivo, {
      hoja: valorDe('--hoja'),
      reset: args.includes('--reset'),
      vendedores: valorDe('--vendedores'),
      rutaDb: valorDe('--db'),
    });
  } catch (error) {
    console.error(`\n  ✗ ${error.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('importar.js')) principal();
