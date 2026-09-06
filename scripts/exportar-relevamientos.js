#!/usr/bin/env node
// Exporta los relevamientos a CSV para abrir en Excel.
//
//   npm run exportar                       -> salidas/relevamientos-<fecha>.csv
//   npm run exportar -- --desde 2026-01-01
//   npm run exportar -- --salida informe.csv
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ } from '../src/config.js';
import { abrirDb, consultar } from '../src/db/db.js';

const COLUMNAS = [
  'visita', 'fecha_visita', 'vendedor', 'cliente', 'codigo', 'canal', 'segmento',
  'facturacion_12m', 'gap_tomacables_pesos', 'estado', 'origen', 'regla_id',
  'pregunta', 'respuesta',
];

function celda(valor) {
  if (valor === null || valor === undefined) return '';
  return `"${String(valor).replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
}

function principal() {
  const args = process.argv.slice(2);
  const valorDe = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };

  const desde = valorDe('--desde') || '1900-01-01';
  const db = abrirDb();

  const filas = consultar(
    db,
    `SELECT v.id AS visita,
            COALESCE(v.cerrada_en, v.declarada_en) AS fecha_visita,
            ve.nombre AS vendedor,
            COALESCE(c.nombre, v.cliente_texto) AS cliente,
            c.codigo, c.canal, m.segmento,
            ROUND(COALESCE(m.facturacion_12m,0)) AS facturacion_12m,
            ROUND(COALESCE(m.gap_tomacables_pesos,0)) AS gap_tomacables_pesos,
            v.estado, r.origen, r.regla_id, r.pregunta_texto AS pregunta, r.respuesta
     FROM visitas v
     JOIN vendedores ve ON ve.id = v.vendedor_id
     LEFT JOIN clientes c ON c.id = v.cliente_id
     LEFT JOIN cliente_metricas m ON m.cliente_id = v.cliente_id
     LEFT JOIN respuestas r ON r.visita_id = v.id
     WHERE date(COALESCE(v.cerrada_en, v.declarada_en)) >= date(?)
     ORDER BY v.id, r.id`,
    [desde]
  );

  if (!filas.length) {
    console.log('\n  No hay relevamientos para exportar.\n');
    return;
  }

  const csv = [
    COLUMNAS.join(';'),
    ...filas.map((f) => COLUMNAS.map((c) => celda(f[c])).join(';')),
  ].join('\n');

  const salida =
    valorDe('--salida') ||
    path.join(RAIZ, 'salidas', `relevamientos-${new Date().toISOString().slice(0, 10)}.csv`);

  fs.mkdirSync(path.dirname(salida), { recursive: true });
  fs.writeFileSync(salida, `﻿${csv}`, 'utf8'); // BOM para Excel en español

  const visitas = new Set(filas.map((f) => f.visita)).size;
  console.log(`\n  ${visitas} visitas · ${filas.length} respuestas`);
  console.log(`  Archivo: ${salida}\n`);
}

principal();
