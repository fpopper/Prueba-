#!/usr/bin/env node
// Importa el maestro de clientes de Mirol a la ficha del cliente.
//
//   node scripts/importar-clientes.js CLIENTES.xlsx
//   node scripts/importar-clientes.js CLIENTES.csv
//
// Mirol exporta .xls (Excel 97). Hay que abrirlo y guardarlo como .xlsx o .csv:
// el lector del proyecto no abre ese binario.
import path from 'node:path';
import { abrirDb } from '../src/db/db.js';
import { importarClientes } from '../src/importador/clientes-mirol.js';

const ruta = process.argv[2];
if (!ruta) {
  console.error('Uso: node scripts/importar-clientes.js <CLIENTES.xlsx|csv>');
  process.exit(1);
}

const db = abrirDb();
const r = importarClientes(db, path.resolve(ruta));

console.log(`\n  Leidos:          ${r.leidos}`);
console.log(`  Nuevos:          ${r.nuevos}`);
console.log(`  Actualizados:    ${r.actualizados}`);
console.log(`  Contactos nuevos: ${r.contactos}`);
console.log(`  Sin CUIT usable: ${r.sinCuit}`);
console.log(`  Con marcas del vendedor: ${r.conMarcas}`);

if (r.codigosDeActividadSinTraducir.size) {
  console.log(`\n  ⚠ Codigos de actividad (TipCliCod) sin traducir: ${r.sinActividad} clientes`);
  const orden = [...r.codigosDeActividadSinTraducir].sort((a, b) => b[1] - a[1]);
  for (const [codigo, cantidad] of orden.slice(0, 15)) {
    console.log(`      ${String(codigo).padStart(4)}: ${String(cantidad).padStart(5)} clientes`);
  }
  console.log('    Falta la tabla de tipos de cliente de Mirol (ver docs/mirol-clientes.md).');
}
