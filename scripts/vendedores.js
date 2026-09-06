#!/usr/bin/env node
// Alta, baja y listado de los vendedores habilitados a usar el chat.
//
//   node scripts/vendedores.js listar
//   node scripts/vendedores.js alta 5491155667788 "Juan Perez" "N.ANTONUCCI"
//   node scripts/vendedores.js baja 5491155667788
//   node scripts/vendedores.js importar vendedores.csv
import { abrirDb, consultar, ejecutar } from '../src/db/db.js';
import { altaVendedor, normalizarTelefono } from '../src/db/queries.js';
import { grupoAgente } from '../src/negocio/reglas.js';
import { importarVendedores } from '../src/importador/importar.js';

const db = abrirDb();
const [accion, ...args] = process.argv.slice(2);

switch (accion) {
  case 'listar': {
    const filas = consultar(db, 'SELECT telefono, nombre, agente, grupo, activo FROM vendedores ORDER BY nombre');
    if (!filas.length) {
      console.log('\n  No hay vendedores cargados.\n');
      break;
    }
    console.log('');
    for (const v of filas) {
      const estado = v.activo ? ' ' : '✗';
      console.log(`  ${estado} ${v.telefono.padEnd(15)} ${String(v.nombre).padEnd(26)} ${v.agente || '-'} (${v.grupo || '-'})`);
    }
    console.log('');
    break;
  }

  case 'alta': {
    const [telefono, nombre, agente] = args;
    if (!telefono || !nombre) {
      console.error('  Uso: node scripts/vendedores.js alta <telefono> "<nombre>" [agente]');
      process.exit(1);
    }
    altaVendedor(db, { telefono, nombre, agente: agente || null, grupo: grupoAgente(agente) });
    console.log(`\n  Alta OK: ${normalizarTelefono(telefono)} — ${nombre}\n`);
    break;
  }

  case 'baja': {
    const [telefono] = args;
    ejecutar(db, 'UPDATE vendedores SET activo = 0 WHERE telefono = ?', [normalizarTelefono(telefono)]);
    console.log(`\n  Baja OK: ${normalizarTelefono(telefono)}\n`);
    break;
  }

  case 'importar': {
    const cargados = importarVendedores(db, args[0]);
    console.log(`\n  ${cargados} vendedores cargados desde ${args[0]}\n`);
    break;
  }

  default:
    console.log(`
  Uso:
    node scripts/vendedores.js listar
    node scripts/vendedores.js alta <telefono> "<nombre>" [agente]
    node scripts/vendedores.js baja <telefono>
    node scripts/vendedores.js importar <archivo.csv>
`);
}
