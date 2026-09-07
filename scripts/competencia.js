#!/usr/bin/env node
// Mapa de la competencia armado con lo que releva la fuerza de ventas.
//
//   npm run competencia                    -> resumen en pantalla
//   npm run competencia -- --csv           -> tambien exporta el detalle a Excel
//   npm run competencia -- --familia TOMACABLES
//
// Es la vista que justifica relevar la competencia con estructura en vez de
// texto libre: sin esto, lo que dice el vendedor se pierde en el relevamiento
// de su visita y no se puede sumar entre cuentas.
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ } from '../src/config.js';
import { abrirDb, consultar } from '../src/db/db.js';
import { resumirCartera } from '../src/negocio/competencia.js';
import { porcentaje, unidades } from '../src/negocio/reglas.js';

const args = process.argv.slice(2);
const valorDe = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
};

const db = abrirDb();
const familia = valorDe('--familia');

const filas = consultar(
  db,
  `SELECT c.*, cl.nombre AS cliente, cl.canal, m.segmento,
          COALESCE(m.facturacion_12m, 0) AS facturacion_12m
   FROM competencia c
   LEFT JOIN clientes cl ON cl.id = c.cliente_id
   LEFT JOIN cliente_metricas m ON m.cliente_id = c.cliente_id
   ${familia ? 'WHERE UPPER(c.familia) LIKE ?' : ''}
   ORDER BY c.relevado_en DESC`,
  familia ? [`%${familia.toUpperCase()}%`] : []
);

if (!filas.length) {
  console.log('\n  Todavía no hay competencia relevada. Aparece a medida que los vendedores cargan visitas.\n');
  process.exit(0);
}

const { competidores, familias, sinClasificar, registros } = resumirCartera(filas);
const brecha = (v) => (v === null ? '-' : `${v > 0 ? '+' : ''}${porcentaje(v)}`);

console.log(`\n  MAPA DE COMPETENCIA — ${unidades(registros)} registros de ${unidades(new Set(filas.map((f) => f.cliente_id)).size)} cuentas`);

console.log('\n  Por competidor');
console.log('  ' + '-'.repeat(84));
console.log(`  ${'Competidor'.padEnd(24)}${'Ctas'.padStart(5)}  ${'Se lleva'.padStart(9)}  ${'Precio'.padStart(8)}  Motivo principal`);
for (const c of competidores) {
  console.log(
    `  ${c.competidor.slice(0, 23).padEnd(24)}${String(c.cuentas).padStart(5)}  ` +
      `${(c.participacionPromedio === null ? '-' : porcentaje(c.participacionPromedio)).padStart(9)}  ` +
      `${brecha(c.brechaPrecioPromedio).padStart(8)}  ${c.motivoPrincipal || '-'}`
  );
  console.log(`  ${''.padEnd(24)}       compite en: ${c.familias.join(', ')}`);
}

console.log('\n  Por familia de producto');
console.log('  ' + '-'.repeat(84));
for (const f of familias) {
  console.log(
    `  ${f.familia.slice(0, 34).padEnd(35)}${String(f.cuentas).padStart(4)} cuentas   ` +
      `principal: ${f.competidorPrincipal}`
  );
  if (f.competidores.length > 1) {
    console.log(`  ${''.padEnd(35)}     también: ${f.competidores.filter((x) => x !== f.competidorPrincipal).join(', ')}`);
  }
}

// Las cuentas grandes donde nos ganan son la lista de llamados de la semana.
const criticas = filas
  .filter((f) => f.participacion_valor >= 0.75)
  .sort((a, b) => b.facturacion_12m - a.facturacion_12m)
  .slice(0, 10);

if (criticas.length) {
  console.log('\n  Dónde nos están ganando (ordenado por tamaño de cuenta)');
  console.log('  ' + '-'.repeat(84));
  for (const f of criticas) {
    console.log(
      `  ${String(f.cliente || '?').slice(0, 32).padEnd(33)}${String(f.segmento || '-').padEnd(3)} ` +
        `${f.competidor.padEnd(18)} ${f.familia.slice(0, 20).padEnd(21)} ${f.motivo || '-'}`
    );
  }
}

if (sinClasificar.length) {
  console.log('\n  ⚠ Competidores SIN CLASIFICAR (validar con Comercial y agregarlos al catálogo');
  console.log('    en src/negocio/competencia.js):');
  for (const c of sinClasificar) console.log(`    - ${c}`);
}

if (args.includes('--csv')) {
  const columnas = [
    'cliente', 'segmento', 'canal', 'competidor', 'familia', 'participacion',
    'precio_relativo', 'motivo', 'volumen', 'observacion', 'relevado_en',
  ];
  const celda = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  const csv = [columnas.join(';'), ...filas.map((f) => columnas.map((c) => celda(f[c])).join(';'))].join('\n');
  const salida = valorDe('--salida') || path.join(RAIZ, 'salidas', `competencia-${new Date().toISOString().slice(0, 10)}.csv`);
  fs.mkdirSync(path.dirname(salida), { recursive: true });
  fs.writeFileSync(salida, `﻿${csv}`, 'utf8');
  console.log(`\n  Detalle exportado: ${salida}`);
}

console.log('');
