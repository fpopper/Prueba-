// Servidor HTTP. Sin frameworks: node:http alcanza y sobra para esto, y evita
// tener que instalar dependencias en las maquinas de la empresa.
//
// Rutas:
//   GET  /webhook            verificacion del webhook de Meta
//   POST /webhook            mensajes entrantes de WhatsApp
//   GET  /simulador          chat de prueba en el navegador
//   POST /api/simulador      mensaje desde el simulador
//   GET  /panel              seguimiento de visitas (requiere ADMIN_KEY)
//   GET  /api/visitas.csv    exportacion para Excel (requiere ADMIN_KEY)
//   GET  /salud              health check
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { config, whatsappConfigurado, RAIZ } from './config.js';
import { abrirDb, consultar } from './db/db.js';
import { atenderMensaje } from './chat/gestor.js';
import { extraerMensajes, firmaValida, enviarTexto, marcarLeido } from './whatsapp/meta.js';
import { contextoEmpresa } from './db/queries.js';
import { formatearFecha } from './negocio/ficha-cliente.js';

const db = abrirDb();

const servidor = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    await enrutar(req, res, url);
  } catch (error) {
    console.error('[server] error no manejado:', error);
    responder(res, 500, { error: 'error interno' });
  }
});

async function enrutar(req, res, url) {
  const ruta = url.pathname;

  if (ruta === '/salud') {
    return responder(res, 200, {
      ok: true,
      whatsapp: whatsappConfigurado ? 'configurado' : 'sin credenciales',
      simulador: config.simuladorHabilitado,
      datos: contextoEmpresa(db),
    });
  }

  if (ruta === '/webhook' && req.method === 'GET') return verificarWebhook(res, url);
  if (ruta === '/webhook' && req.method === 'POST') return recibirWebhook(req, res);

  if (ruta === '/' || ruta === '/simulador') return servirSimulador(res);
  if (ruta === '/api/simulador' && req.method === 'POST') return mensajeSimulado(req, res);
  if (ruta === '/api/vendedores') return responder(res, 200, listarVendedores());

  if (ruta === '/panel') return servirPanel(res, url);
  if (ruta === '/api/visitas.csv') return exportarCsv(res, url);

  return responder(res, 404, { error: 'no encontrado' });
}

// --- Webhook de Meta ---------------------------------------------------------

// Meta llama a esta URL una sola vez, al dar de alta el webhook, y espera que
// le devolvamos el challenge tal cual si el verify token coincide.
function verificarWebhook(res, url) {
  const modo = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  if (modo === 'subscribe' && token === config.whatsapp.verifyToken) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end(challenge || '');
  }
  res.writeHead(403);
  return res.end('token invalido');
}

async function recibirWebhook(req, res) {
  const crudo = await leerCuerpo(req);

  if (!firmaValida(crudo, req.headers['x-hub-signature-256'])) {
    console.warn('[webhook] firma invalida, mensaje descartado');
    res.writeHead(401);
    return res.end();
  }

  // Le contestamos 200 a Meta enseguida: si tardamos, reintenta y duplica.
  res.writeHead(200);
  res.end();

  let cuerpo;
  try {
    cuerpo = JSON.parse(crudo || '{}');
  } catch {
    return;
  }

  for (const mensaje of extraerMensajes(cuerpo)) {
    try {
      marcarLeido(mensaje.waMessageId);
      const respuestas = atenderMensaje(db, mensaje);
      for (const r of respuestas) {
        await enviarTexto(mensaje.telefono, r.texto);
      }
    } catch (error) {
      console.error('[webhook] error atendiendo mensaje:', error);
    }
  }
}

// --- Simulador ---------------------------------------------------------------

function servirSimulador(res) {
  if (!config.simuladorHabilitado) return responder(res, 404, { error: 'simulador deshabilitado' });
  const archivo = path.join(RAIZ, 'public', 'simulador.html');
  const html = fs.readFileSync(archivo, 'utf8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function mensajeSimulado(req, res) {
  if (!config.simuladorHabilitado) return responder(res, 404, { error: 'simulador deshabilitado' });
  const cuerpo = JSON.parse((await leerCuerpo(req)) || '{}');

  const respuestas = atenderMensaje(db, {
    telefono: cuerpo.telefono,
    texto: cuerpo.texto || '',
    tipo: cuerpo.tipo || 'text',
    mediaId: cuerpo.tipo === 'image' ? 'simulada' : null,
    waMessageId: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  });

  return responder(res, 200, { respuestas });
}

function listarVendedores() {
  return consultar(db, 'SELECT telefono, nombre, agente, grupo FROM vendedores WHERE activo = 1 ORDER BY nombre');
}

// --- Panel de seguimiento ----------------------------------------------------

function autorizado(url) {
  if (!config.claveAdmin) return false;
  return url.searchParams.get('clave') === config.claveAdmin;
}

function visitasRecientes(limite = 100) {
  return consultar(
    db,
    `SELECT v.id, v.estado, v.declarada_en, v.cerrada_en, v.es_prospecto,
            COALESCE(c.nombre, v.cliente_texto) AS cliente, c.canal,
            m.segmento, ve.nombre AS vendedor,
            (SELECT COUNT(*) FROM respuestas r WHERE r.visita_id = v.id) AS respuestas
     FROM visitas v
     JOIN vendedores ve ON ve.id = v.vendedor_id
     LEFT JOIN clientes c ON c.id = v.cliente_id
     LEFT JOIN cliente_metricas m ON m.cliente_id = v.cliente_id
     ORDER BY v.id DESC LIMIT ${Number(limite)}`
  );
}

function servirPanel(res, url) {
  if (!autorizado(url)) {
    res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Falta la clave. Usá /panel?clave=... (se configura en ADMIN_KEY del .env)');
  }

  const visitas = visitasRecientes();
  const filas = visitas
    .map(
      (v) => `<tr>
      <td>${v.id}</td>
      <td>${escapar(v.cliente)}${v.es_prospecto ? ' <span class="tag">prospecto</span>' : ''}</td>
      <td>${escapar(v.segmento || '-')}</td>
      <td>${escapar(v.canal || '-')}</td>
      <td>${escapar(v.vendedor)}</td>
      <td><span class="estado ${v.estado}">${v.estado}</span></td>
      <td>${formatearFecha(v.declarada_en)}</td>
      <td>${v.respuestas}</td>
    </tr>`
    )
    .join('');

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Visitas · FACBSA</title>
<style>
 body{font-family:system-ui,sans-serif;margin:2rem;color:#1c1c1c;background:#fafafa}
 h1{font-size:1.3rem} table{border-collapse:collapse;width:100%;background:#fff}
 th,td{border:1px solid #e3e3e3;padding:.4rem .6rem;font-size:.85rem;text-align:left}
 th{background:#f0f0f0} .tag{background:#eee;border-radius:4px;padding:0 .3rem;font-size:.7rem}
 .estado{font-weight:600;font-size:.75rem}
 .COMPLETA{color:#127c3a}.EN_CURSO{color:#b06a00}.CANCELADA{color:#999}
 a{color:#0a58ca}
</style></head><body>
<h1>Relevamiento de visitas — FACBSA</h1>
<p>${visitas.length} visitas · <a href="/api/visitas.csv?clave=${encodeURIComponent(url.searchParams.get('clave'))}">descargar CSV para Excel</a></p>
<table><thead><tr>
<th>#</th><th>Cliente</th><th>Seg.</th><th>Canal</th><th>Vendedor</th><th>Estado</th><th>Fecha</th><th>Resp.</th>
</tr></thead><tbody>${filas}</tbody></table>
</body></html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function exportarCsv(res, url) {
  if (!autorizado(url)) {
    res.writeHead(401);
    return res.end('no autorizado');
  }

  const filas = consultar(
    db,
    `SELECT v.id AS visita, COALESCE(c.nombre, v.cliente_texto) AS cliente, c.codigo,
            c.canal, m.segmento, ve.nombre AS vendedor, v.estado,
            v.declarada_en, v.cerrada_en,
            r.origen, r.regla_id, r.pregunta_texto, r.respuesta
     FROM visitas v
     JOIN vendedores ve ON ve.id = v.vendedor_id
     LEFT JOIN clientes c ON c.id = v.cliente_id
     LEFT JOIN cliente_metricas m ON m.cliente_id = v.cliente_id
     LEFT JOIN respuestas r ON r.visita_id = v.id
     ORDER BY v.id DESC, r.id`
  );

  const columnas = [
    'visita', 'cliente', 'codigo', 'canal', 'segmento', 'vendedor', 'estado',
    'declarada_en', 'cerrada_en', 'origen', 'regla_id', 'pregunta_texto', 'respuesta',
  ];

  const csv = [
    columnas.join(';'),
    ...filas.map((f) => columnas.map((c) => celdaCsv(f[c])).join(';')),
  ].join('\n');

  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="visitas-facbsa.csv"',
  });
  // BOM para que Excel en español abra bien los acentos.
  res.end(`﻿${csv}`);
}

function celdaCsv(valor) {
  if (valor === null || valor === undefined) return '';
  const texto = String(valor).replace(/"/g, '""').replace(/\r?\n/g, ' ');
  return `"${texto}"`;
}

function escapar(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// --- Utilidades --------------------------------------------------------------

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    req.on('data', (c) => partes.push(c));
    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    req.on('error', reject);
  });
}

function responder(res, codigo, cuerpo) {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(cuerpo, null, 2));
}

servidor.listen(config.puerto, () => {
  console.log(`\n  FACBSA · relevamiento de visitas`);
  console.log(`  ------------------------------------------`);
  console.log(`  Servidor:  http://localhost:${config.puerto}`);
  if (config.simuladorHabilitado) {
    console.log(`  Simulador: http://localhost:${config.puerto}/simulador`);
  }
  console.log(`  WhatsApp:  ${whatsappConfigurado ? 'credenciales cargadas' : 'SIN credenciales (solo simulador)'}`);
  console.log(`  Base:      ${config.rutaDb}\n`);
});
