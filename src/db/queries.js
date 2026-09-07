// Consultas de negocio sobre la base. Todo lo que el chat necesita saber de un
// cliente pasa por aca.
import { consultar, consultarUna, ejecutar, leerParametro } from './db.js';
import { normalizarTexto } from '../negocio/reglas.js';

// --- Vendedores --------------------------------------------------------------

export function buscarVendedorPorTelefono(db, telefono) {
  return consultarUna(
    db,
    'SELECT * FROM vendedores WHERE telefono = ? AND activo = 1',
    [normalizarTelefono(telefono)]
  );
}

// WhatsApp entrega el numero en E.164 sin '+'. Los celulares argentinos suelen
// llegar como 549XXXXXXXXXX pero a veces se cargan sin el 9: normalizamos para
// que el alta manual del vendedor no falle por ese detalle.
export function normalizarTelefono(telefono) {
  const soloDigitos = String(telefono || '').replace(/\D/g, '');
  if (soloDigitos.startsWith('54') && !soloDigitos.startsWith('549') && soloDigitos.length === 12) {
    return `549${soloDigitos.slice(2)}`;
  }
  return soloDigitos;
}

export function altaVendedor(db, { telefono, nombre, agente = null, grupo = null }) {
  return ejecutar(
    db,
    `INSERT INTO vendedores (telefono, nombre, agente, grupo) VALUES (?, ?, ?, ?)
     ON CONFLICT(telefono) DO UPDATE SET nombre = excluded.nombre,
       agente = excluded.agente, grupo = excluded.grupo, activo = 1`,
    [normalizarTelefono(telefono), nombre, agente, grupo]
  );
}

// --- Busqueda de clientes ----------------------------------------------------

// El vendedor escribe el nombre como se lo acuerda. Buscamos por codigo exacto,
// por CUIT, y por coincidencia de todas las palabras que escribio en cualquier
// orden ("electrica del sur" encuentra "DISTRIBUIDORA ELECTRICA DEL SUR SA").
export function buscarClientes(db, texto, limite = 8) {
  const termino = normalizarTexto(texto);
  if (!termino) return [];

  const porCodigo = consultar(
    db,
    `SELECT c.*, m.facturacion_12m, m.segmento FROM clientes c
     LEFT JOIN cliente_metricas m ON m.cliente_id = c.id
     WHERE UPPER(c.codigo) = ? OR REPLACE(REPLACE(c.cuit,'-',''),'.','') = ?`,
    [termino, termino.replace(/\D/g, '')]
  );
  if (porCodigo.length) return porCodigo;

  const palabras = termino.split(' ').filter((p) => p.length >= 2);
  if (!palabras.length) return [];
  const condiciones = palabras.map(() => 'c.nombre_busqueda LIKE ?').join(' AND ');
  const params = palabras.map((p) => `%${p}%`);

  return consultar(
    db,
    `SELECT c.*, m.facturacion_12m, m.segmento FROM clientes c
     LEFT JOIN cliente_metricas m ON m.cliente_id = c.id
     WHERE ${condiciones}
     ORDER BY COALESCE(m.facturacion_12m, 0) DESC
     LIMIT ${Number(limite)}`,
    params
  );
}

export function obtenerCliente(db, clienteId) {
  return consultarUna(db, 'SELECT * FROM clientes WHERE id = ?', [clienteId]);
}

export function obtenerMetricas(db, clienteId) {
  return consultarUna(db, 'SELECT * FROM cliente_metricas WHERE cliente_id = ?', [clienteId]);
}

export function familiasDelCliente(db, clienteId) {
  return consultar(
    db,
    `SELECT familia, cantidad_12m, importe_12m FROM cliente_familia
     WHERE cliente_id = ? ORDER BY importe_12m DESC`,
    [clienteId]
  );
}

export function ultimasVisitas(db, clienteId, limite = 3) {
  return consultar(
    db,
    `SELECT v.id, v.cerrada_en, v.declarada_en, v.estado, ve.nombre AS vendedor
     FROM visitas v JOIN vendedores ve ON ve.id = v.vendedor_id
     WHERE v.cliente_id = ? AND v.estado = 'COMPLETA'
     ORDER BY v.cerrada_en DESC LIMIT ${Number(limite)}`,
    [clienteId]
  );
}

// Lo que ya sabemos de la competencia en este cliente, de todas las visitas
// anteriores. Se le muestra al vendedor en la ficha para que no vuelva a
// preguntar de cero lo que ya contestaron.
export function competenciaDelCliente(db, clienteId, limite = 8) {
  return consultar(
    db,
    `SELECT competidor, familia, participacion, precio_relativo, motivo,
            MAX(relevado_en) AS relevado_en
     FROM competencia
     WHERE cliente_id = ?
     GROUP BY competidor, familia
     ORDER BY relevado_en DESC
     LIMIT ${Number(limite)}`,
    [clienteId]
  );
}

export function respuestasDeVisita(db, visitaId) {
  return consultar(
    db,
    `SELECT pregunta_id, pregunta_texto, origen, regla_id, respuesta, respuesta_valor, media_id
     FROM respuestas WHERE visita_id = ? ORDER BY id`,
    [visitaId]
  );
}

// --- Contexto global (del ultimo import) ------------------------------------

export function contextoEmpresa(db) {
  return {
    facturacionTotal: Number(leerParametro(db, 'facturacion_total_12m', 0)),
    precioTomacable: Number(leerParametro(db, 'precio_promedio_tomacable', 0)),
    fechaCorte: leerParametro(db, 'fecha_corte', null),
    ultimoImport: leerParametro(db, 'ultimo_import', null),
    cuentasActivas: Number(leerParametro(db, 'cuentas_activas', 0)),
  };
}
