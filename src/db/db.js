// Apertura de la base SQLite y ejecucion del esquema.
// Usamos node:sqlite, que viene incluido en Node 22: no hay que compilar nada
// ni instalar dependencias en las maquinas de la empresa.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

let instancia = null;

export function abrirDb(rutaDb = config.rutaDb) {
  if (instancia) return instancia;
  fs.mkdirSync(path.dirname(rutaDb), { recursive: true });
  const db = new DatabaseSync(rutaDb);
  const esquema = fs.readFileSync(path.join(AQUI, 'schema.sql'), 'utf8');
  db.exec(esquema);
  instancia = db;
  return db;
}

export function cerrarDb() {
  if (instancia) {
    instancia.close();
    instancia = null;
  }
}

// Helpers finos sobre la API de node:sqlite, para no repetir prepare/get/all.
export function consultarUna(db, sql, params = []) {
  return db.prepare(sql).get(...params) ?? null;
}

export function consultar(db, sql, params = []) {
  return db.prepare(sql).all(...params);
}

export function ejecutar(db, sql, params = []) {
  return db.prepare(sql).run(...params);
}

export function enTransaccion(db, fn) {
  db.exec('BEGIN');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function guardarParametro(db, clave, valor) {
  ejecutar(
    db,
    `INSERT INTO parametros (clave, valor) VALUES (?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`,
    [clave, String(valor)]
  );
}

export function leerParametro(db, clave, porDefecto = null) {
  const fila = consultarUna(db, 'SELECT valor FROM parametros WHERE clave = ?', [clave]);
  return fila ? fila.valor : porDefecto;
}
