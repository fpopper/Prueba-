-- Esquema de la base de relevamiento de visitas comerciales de FACBSA.
-- Motor: SQLite (node:sqlite, nativo de Node 22). Un solo archivo, sin servidor.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Maestros que se cargan desde el Excel de ventas del sistema
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS clientes (
  id                INTEGER PRIMARY KEY,
  codigo            TEXT UNIQUE,             -- codigo del cliente en el sistema
  nombre            TEXT NOT NULL,
  nombre_busqueda   TEXT NOT NULL,           -- nombre normalizado, sin acentos, para buscar
  cuit              TEXT,
  canal             TEXT,                    -- EMPRESA ENERGIA / DISTRIBUIDOR / CONSTRUCTORA / otros
  localidad         TEXT,
  provincia         TEXT,
  direccion         TEXT,
  actualizado_en    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_clientes_busqueda ON clientes(nombre_busqueda);

-- Vendedores / agentes habilitados a usar el chat. El telefono es la credencial.
CREATE TABLE IF NOT EXISTS vendedores (
  id                INTEGER PRIMARY KEY,
  telefono          TEXT UNIQUE NOT NULL,    -- formato E.164 sin '+', ej: 5491122334455
  nombre            TEXT NOT NULL,
  agente            TEXT,                    -- identificador del agente en el sistema de ventas
  grupo             TEXT,                    -- 'Venta Directa' | 'Representante'
  activo            INTEGER NOT NULL DEFAULT 1,
  creado_en         TEXT DEFAULT (datetime('now'))
);

-- Lineas de venta normalizadas (una fila por linea de factura del Excel)
CREATE TABLE IF NOT EXISTS ventas (
  id                INTEGER PRIMARY KEY,
  cliente_id        INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  fecha             TEXT NOT NULL,           -- ISO yyyy-mm-dd
  agente            TEXT,                    -- identificador crudo del agente
  agente_grupo      TEXT,                    -- 'Venta Directa' | 'Representante'
  canal             TEXT,
  familia           TEXT,                    -- familia normalizada
  familia_cruda     TEXT,                    -- como vino en el archivo
  articulo          TEXT,
  cantidad          REAL NOT NULL DEFAULT 0,
  importe           REAL NOT NULL DEFAULT 0  -- precio NETO con descuentos
);

CREATE INDEX IF NOT EXISTS ix_ventas_cliente ON ventas(cliente_id);
CREATE INDEX IF NOT EXISTS ix_ventas_fecha   ON ventas(fecha);

-- Metricas por cliente, calculadas en el import segun las reglas de negocio.
CREATE TABLE IF NOT EXISTS cliente_metricas (
  cliente_id            INTEGER PRIMARY KEY REFERENCES clientes(id) ON DELETE CASCADE,
  facturacion_12m       REAL NOT NULL DEFAULT 0,
  facturacion_12m_prev  REAL NOT NULL DEFAULT 0,  -- los 12 meses anteriores, para variacion
  facturacion_trim      REAL NOT NULL DEFAULT 0,  -- ultimo trimestre
  facturacion_trim_prev REAL NOT NULL DEFAULT 0,  -- trimestre anterior
  participacion         REAL NOT NULL DEFAULT 0,  -- % sobre el total de la empresa
  ranking               INTEGER,                  -- posicion en el ranking de cuentas
  segmento              TEXT,                     -- A / B / C / D
  modelo_atencion       TEXT,
  ultima_compra         TEXT,
  dias_sin_comprar      INTEGER,
  operaciones_12m       INTEGER NOT NULL DEFAULT 0,
  ticket_promedio       REAL NOT NULL DEFAULT 0,
  jabalinas_12m         REAL NOT NULL DEFAULT 0,
  tomacables_12m        REAL NOT NULL DEFAULT 0,
  ratio_tomacables      REAL,
  gap_tomacables_u      REAL NOT NULL DEFAULT 0,
  gap_tomacables_pesos  REAL NOT NULL DEFAULT 0,
  agente_principal      TEXT,
  agente_principal_pct  REAL,
  agente_secundario     TEXT,                     -- solo si supera el 25%
  agente_secundario_pct REAL,
  cuenta_compartida     INTEGER NOT NULL DEFAULT 0,
  calculado_en          TEXT DEFAULT (datetime('now'))
);

-- Que familias compra cada cliente (para detectar los huecos de cross-selling)
CREATE TABLE IF NOT EXISTS cliente_familia (
  cliente_id        INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  familia           TEXT NOT NULL,
  cantidad_12m      REAL NOT NULL DEFAULT 0,
  importe_12m       REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (cliente_id, familia)
);

-- Parametros globales del ultimo import (total facturado, precios promedio, fecha de corte)
CREATE TABLE IF NOT EXISTS parametros (
  clave             TEXT PRIMARY KEY,
  valor             TEXT
);

-- ---------------------------------------------------------------------------
-- Datos que genera el chat
-- ---------------------------------------------------------------------------

-- Estado de la conversacion de cada vendedor (la maquina de estados vive aca)
CREATE TABLE IF NOT EXISTS sesiones (
  telefono          TEXT PRIMARY KEY,
  vendedor_id       INTEGER REFERENCES vendedores(id) ON DELETE CASCADE,
  estado            TEXT NOT NULL DEFAULT 'INICIO',
  visita_id         INTEGER REFERENCES visitas(id) ON DELETE SET NULL,
  contexto          TEXT NOT NULL DEFAULT '{}',   -- JSON con datos temporales del flujo
  actualizado_en    TEXT DEFAULT (datetime('now'))
);

-- Una visita = una declaracion previa + su relevamiento posterior
CREATE TABLE IF NOT EXISTS visitas (
  id                    INTEGER PRIMARY KEY,
  vendedor_id           INTEGER NOT NULL REFERENCES vendedores(id),
  cliente_id            INTEGER REFERENCES clientes(id),
  cliente_texto         TEXT,                 -- lo que escribio el vendedor (cliente nuevo / no encontrado)
  es_prospecto          INTEGER NOT NULL DEFAULT 0,
  estado                TEXT NOT NULL DEFAULT 'DECLARADA', -- DECLARADA | EN_CURSO | COMPLETA | CANCELADA
  declarada_en          TEXT DEFAULT (datetime('now')),
  iniciada_en           TEXT,
  cerrada_en            TEXT,
  ficha_snapshot        TEXT,                 -- JSON: la situacion del cliente al momento de la visita
  preguntas_especiales  TEXT,                 -- JSON: que preguntas extra se le pidieron y por que
  latitud               REAL,
  longitud              REAL,
  canal_origen          TEXT DEFAULT 'whatsapp'
);

CREATE INDEX IF NOT EXISTS ix_visitas_vendedor ON visitas(vendedor_id);
CREATE INDEX IF NOT EXISTS ix_visitas_cliente  ON visitas(cliente_id);
CREATE INDEX IF NOT EXISTS ix_visitas_estado   ON visitas(estado);

-- Cada respuesta del cuestionario, una fila por pregunta
CREATE TABLE IF NOT EXISTS respuestas (
  id                INTEGER PRIMARY KEY,
  visita_id         INTEGER NOT NULL REFERENCES visitas(id) ON DELETE CASCADE,
  pregunta_id       TEXT NOT NULL,
  pregunta_texto    TEXT NOT NULL,
  origen            TEXT NOT NULL DEFAULT 'base',  -- 'base' | 'especial'
  regla_id          TEXT,                          -- que regla de negocio disparo la pregunta
  respuesta         TEXT,
  respuesta_valor   TEXT,                          -- valor normalizado (opcion elegida, numero, etc.)
  media_id          TEXT,                          -- id de la foto en WhatsApp, si la hubo
  respondida_en     TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_respuestas_visita ON respuestas(visita_id);

-- Log crudo de mensajes, para auditoria y para depurar el flujo
CREATE TABLE IF NOT EXISTS mensajes (
  id                INTEGER PRIMARY KEY,
  telefono          TEXT NOT NULL,
  direccion         TEXT NOT NULL,      -- 'entrante' | 'saliente'
  tipo              TEXT DEFAULT 'text',
  texto             TEXT,
  payload           TEXT,
  wa_message_id     TEXT,
  creado_en         TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_mensajes_telefono ON mensajes(telefono, id);

-- Idempotencia: WhatsApp reintenta el webhook, no queremos procesar dos veces
CREATE TABLE IF NOT EXISTS mensajes_procesados (
  wa_message_id     TEXT PRIMARY KEY,
  procesado_en      TEXT DEFAULT (datetime('now'))
);
