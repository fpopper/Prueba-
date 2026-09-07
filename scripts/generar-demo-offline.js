#!/usr/bin/env node
// Genera un simulador en un solo archivo HTML, para abrir sin instalar nada.
//
//   npm run demo:offline
//   npm run demo:offline -- --salida ~/Escritorio/simulador.html
//
// Los datos salen de la base real corriendo el mismo código que el sistema: las
// fichas, las alertas y las preguntas especiales son exactamente las que
// produciría en producción. Si se corre después de importar el Excel de ventas
// de verdad, el archivo sale con los clientes reales de FACBSA.
//
// El archivo resultante funciona en modo guiado sin nada más. Con una clave de
// la API de Claude pegada en Ajustes, se le activa el agente conversacional.
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ } from '../src/config.js';
import { abrirDb, consultar } from '../src/db/db.js';
import { contextoEmpresa } from '../src/db/queries.js';
import { armarFicha, formatearFicha } from '../src/negocio/ficha-cliente.js';
import { formatearAvisoPreguntas, preguntasEspeciales } from '../src/negocio/preguntas-especiales.js';
import { armarCuestionario } from '../src/chat/cuestionario.js';

function exportarDatos(db) {
  const clientes = consultar(
    db,
    'SELECT id, nombre, codigo, canal, localidad FROM clientes ORDER BY id'
  );

  return {
    generado: new Date().toISOString(),
    empresa: contextoEmpresa(db),
    vendedores: consultar(db, 'SELECT nombre, agente FROM vendedores WHERE activo = 1 ORDER BY nombre'),
    clientes: clientes.map((c) => {
      const ficha = armarFicha(db, c.id);
      const especiales = preguntasEspeciales(ficha);
      return {
        id: c.id,
        nombre: c.nombre,
        codigo: c.codigo,
        canal: c.canal,
        localidad: c.localidad,
        segmento: ficha.metricas.segmento,
        facturacion12m: ficha.metricas.facturacion12m,
        fichaTexto: formatearFicha(ficha),
        avisoTexto: formatearAvisoPreguntas(especiales),
        especiales: especiales.map((e) => ({ id: e.id, nivel: e.nivel })),
        puntos: armarCuestionario(especiales).map((p) => ({
          id: p.id,
          texto: p.texto,
          contexto: p.contexto || null,
          obligatoria: p.obligatoria,
          origen: p.origen,
          opciones: p.opciones || null,
          omitirSi: p.omitirSi || null,
        })),
      };
    }),
  };
}

function principal() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--salida');
  const salida = i !== -1 ? args[i + 1] : path.join(RAIZ, 'demo', 'simulador-facbsa.html');

  const db = abrirDb();
  const datos = exportarDatos(db);

  if (!datos.clientes.length) {
    console.error('\n  No hay clientes en la base. Corré "npm run demo" o importá el Excel primero.\n');
    process.exit(1);
  }

  const carpeta = path.join(RAIZ, 'demo');
  const pagina = fs.readFileSync(path.join(carpeta, 'plantilla-pagina.html'), 'utf8');
  const logica = fs.readFileSync(path.join(carpeta, 'plantilla-logica.html'), 'utf8');

  const json = JSON.stringify(datos);
  if (/<\/script/i.test(json)) {
    throw new Error('Los datos contienen una etiqueta de cierre de script; hay que escaparlos.');
  }

  const html =
    '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<style>body{margin:0}img{max-width:100%}</style>\n</head>\n<body>\n' +
    pagina +
    `\n<script>\nconst DATOS = ${json};\n</script>\n` +
    logica +
    '\n</body>\n</html>\n';

  fs.mkdirSync(path.dirname(salida), { recursive: true });
  fs.writeFileSync(salida, html, 'utf8');

  console.log(`\n  Simulador generado: ${salida}`);
  console.log(`  ${datos.clientes.length} clientes · ${Math.round(html.length / 1024)} kB · un solo archivo`);
  console.log('\n  Abrilo con doble clic. Si el micrófono no arranca, servilo desde localhost:');
  console.log(`    cd ${path.dirname(salida)} && npx serve .\n`);
}

principal();
