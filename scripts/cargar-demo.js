#!/usr/bin/env node
// Genera un archivo de ventas de ejemplo y lo importa, para poder probar el
// chat completo sin tocar datos reales.
//
//   npm run demo
//
// Los clientes de ejemplo estan armados a proposito para que dispare cada una
// de las reglas de preguntas especiales: churn de cuenta clave, cliente
// dormido, gap de tomacables, gap invertido, cuenta compartida, prospecto, etc.
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ } from '../src/config.js';
import { abrirDb } from '../src/db/db.js';
import { altaVendedor } from '../src/db/queries.js';
import { importar } from '../src/importador/importar.js';

const HOY = new Date();
const DIA = 86_400_000;
const iso = (diasAtras) => new Date(HOY.getTime() - diasAtras * DIA).toISOString().slice(0, 10);

// Precios de referencia (pesos por unidad) solo para que los importes cierren.
const PRECIO = {
  'CABLE IRAM 2467': 18_000,
  'JABALINAS LISAS': 32_000,
  TOMACABLES: 11_500,
  'VARIOS (CONJUNTOS)': 145_000,
  PARARRAYOS: 320_000,
  'SOLDADURA EXOTERMICA': 26_000,
  'CONECTORES A COMPRESION': 8_400,
};

// Cada cliente declara cuanto compra por familia en el ultimo año y en el
// anterior, para que las variaciones y los gaps salgan como queremos.
const CLIENTES = [
  {
    codigo: 'C-1001',
    nombre: 'EDESUR DISTRIBUCION ELECTRICA SA',
    canal: 'EMPRESA ENERGIA',
    localidad: 'Avellaneda',
    provincia: 'Buenos Aires',
    agente: 'FACBSA',
    // Cuenta clave que se derrumba en el ultimo trimestre -> churn
    ultimoAnio: { 'CABLE IRAM 2467': 3400, 'JABALINAS LISAS': 900, TOMACABLES: 380 },
    anioPrevio: { 'CABLE IRAM 2467': 3200, 'JABALINAS LISAS': 850, TOMACABLES: 350 },
    caidaTrimestre: 0.7,
  },
  {
    codigo: 'C-1042',
    nombre: 'ELECTRO MAYORISTA DEL PLATA SRL',
    canal: 'DISTRIBUIDOR',
    localidad: 'San Martin',
    provincia: 'Buenos Aires',
    agente: 'N.ANTONUCCI',
    // Compra muchas jabalinas y casi nada de tomacables -> gap grande
    ultimoAnio: { 'CABLE IRAM 2467': 620, 'JABALINAS LISAS': 480, TOMACABLES: 40 },
    anioPrevio: { 'CABLE IRAM 2467': 700, 'JABALINAS LISAS': 500, TOMACABLES: 60 },
  },
  {
    codigo: 'C-1077',
    nombre: 'CONSTRUCTORA SUR OBRAS SA',
    canal: 'CONSTRUCTORA',
    localidad: 'Bahia Blanca',
    provincia: 'Buenos Aires',
    agente: 'SERGIO ELLERO',
    // Segmento C, no compra conjuntos -> venta de solucion
    ultimoAnio: { 'CABLE IRAM 2467': 180, 'JABALINAS LISAS': 90, TOMACABLES: 45 },
    anioPrevio: { 'CABLE IRAM 2467': 120, 'JABALINAS LISAS': 60, TOMACABLES: 30 },
  },
  {
    codigo: 'C-1120',
    nombre: 'INSTALACIONES PAMPA SRL',
    canal: 'DISTRIBUIDOR',
    localidad: 'Santa Rosa',
    provincia: 'La Pampa',
    agente: 'ELECTRO REP SUR',
    // Dejo de comprar hace mas de 5 meses -> cliente dormido
    ultimoAnio: { 'CABLE IRAM 2467': 210, 'JABALINAS LISAS': 120, TOMACABLES: 55 },
    anioPrevio: { 'CABLE IRAM 2467': 480, 'JABALINAS LISAS': 260, TOMACABLES: 130 },
    ultimaCompraHace: 165,
  },
  {
    codigo: 'C-1205',
    nombre: 'FERRETERIA INDUSTRIAL ROSARIO',
    canal: 'DISTRIBUIDOR',
    localidad: 'Rosario',
    provincia: 'Santa Fe',
    agente: 'J.MARTINEZ REPRESENTACIONES',
    // Segmento D -> revisar rentabilidad
    ultimoAnio: { 'CABLE IRAM 2467': 22, 'JABALINAS LISAS': 8, TOMACABLES: 4 },
    anioPrevio: { 'CABLE IRAM 2467': 30, 'JABALINAS LISAS': 12, TOMACABLES: 6 },
  },
  {
    codigo: 'C-1301',
    nombre: 'COOPERATIVA ELECTRICA DE JUNIN LTDA',
    canal: 'EMPRESA ENERGIA',
    localidad: 'Junin',
    provincia: 'Buenos Aires',
    agente: 'FACSA',
    // Compra mas tomacables que jabalinas -> gap invertido
    ultimoAnio: { 'CABLE IRAM 2467': 380, 'JABALINAS LISAS': 110, TOMACABLES: 190, PARARRAYOS: 4 },
    anioPrevio: { 'CABLE IRAM 2467': 300, 'JABALINAS LISAS': 100, TOMACABLES: 160 },
  },
  {
    codigo: 'C-1355',
    nombre: 'MONTAJES ELECTRICOS DEL NORTE SA',
    canal: 'CONSTRUCTORA',
    localidad: 'Salta',
    provincia: 'Salta',
    agente: 'FACBSA',
    agenteSecundario: 'NOA REPRESENTACIONES',
    // Cuenta compartida entre venta directa y un representante
    ultimoAnio: { 'CABLE IRAM 2467': 520, 'JABALINAS LISAS': 210, TOMACABLES: 95, 'VARIOS (CONJUNTOS)': 12 },
    anioPrevio: { 'CABLE IRAM 2467': 460, 'JABALINAS LISAS': 190, TOMACABLES: 90 },
  },
  {
    codigo: 'C-1502',
    nombre: 'DISTRIBUIDORA ELECTRICA LITORAL SA',
    canal: 'DISTRIBUIDOR',
    localidad: 'Parana',
    provincia: 'Entre Rios',
    agente: 'N.ANTONUCCI',
    ultimoAnio: { 'CABLE IRAM 2467': 760, 'JABALINAS LISAS': 320, TOMACABLES: 150, 'VARIOS (CONJUNTOS)': 18 },
    anioPrevio: { 'CABLE IRAM 2467': 690, 'JABALINAS LISAS': 300, TOMACABLES: 140 },
  },
  {
    codigo: 'C-1533',
    nombre: 'EPEC COOPERATIVA DE CORDOBA',
    canal: 'EMPRESA ENERGIA',
    localidad: 'Cordoba',
    provincia: 'Cordoba',
    agente: 'FACBSA',
    ultimoAnio: { 'CABLE IRAM 2467': 980, 'JABALINAS LISAS': 410, TOMACABLES: 205, PARARRAYOS: 8 },
    anioPrevio: { 'CABLE IRAM 2467': 900, 'JABALINAS LISAS': 380, TOMACABLES: 190 },
  },
  {
    codigo: 'C-1560',
    nombre: 'INGENIERIA Y MONTAJES PATAGONIA SRL',
    canal: 'CONSTRUCTORA',
    localidad: 'Neuquen',
    provincia: 'Neuquen',
    agente: 'PATAGONIA REPRESENTACIONES',
    ultimoAnio: { 'CABLE IRAM 2467': 540, 'JABALINAS LISAS': 240, TOMACABLES: 60, 'SOLDADURA EXOTERMICA': 90 },
    anioPrevio: { 'CABLE IRAM 2467': 500, 'JABALINAS LISAS': 220, TOMACABLES: 55 },
  },
  {
    codigo: 'C-1588',
    nombre: 'CASA ELECTRICA TUCUMAN SRL',
    canal: 'DISTRIBUIDOR',
    localidad: 'San Miguel de Tucuman',
    provincia: 'Tucuman',
    agente: 'NOA REPRESENTACIONES',
    ultimoAnio: { 'CABLE IRAM 2467': 420, 'JABALINAS LISAS': 180, TOMACABLES: 88, 'CONECTORES A COMPRESION': 300 },
    anioPrevio: { 'CABLE IRAM 2467': 380, 'JABALINAS LISAS': 160, TOMACABLES: 80 },
  },
  {
    codigo: 'C-1602',
    nombre: 'SERVICIOS ELECTROMECANICOS DEL SUR SA',
    canal: 'CONSTRUCTORA',
    localidad: 'Comodoro Rivadavia',
    provincia: 'Chubut',
    agente: 'SERGIO ELLERO',
    ultimoAnio: { 'CABLE IRAM 2467': 610, 'JABALINAS LISAS': 260, TOMACABLES: 70, 'VARIOS (CONJUNTOS)': 9 },
    anioPrevio: { 'CABLE IRAM 2467': 560, 'JABALINAS LISAS': 240, TOMACABLES: 65 },
  },
  {
    codigo: 'C-1410',
    nombre: 'TABLEROS Y SERVICIOS CUYO SRL',
    canal: 'DISTRIBUIDOR',
    localidad: 'Mendoza',
    provincia: 'Mendoza',
    agente: 'CUYO REPRESENTACIONES',
    ultimoAnio: { 'CABLE IRAM 2467': 340, 'JABALINAS LISAS': 150, TOMACABLES: 70, 'SOLDADURA EXOTERMICA': 60 },
    anioPrevio: { 'CABLE IRAM 2467': 300, 'JABALINAS LISAS': 140, TOMACABLES: 65 },
  },
];

const VENDEDORES = [
  { telefono: '5491100000001', nombre: 'Ricardo Gimenez', agente: 'FACBSA' },
  { telefono: '5491100000002', nombre: 'Norberto Antonucci', agente: 'N.ANTONUCCI' },
  { telefono: '5491100000003', nombre: 'Sergio Ellero', agente: 'SERGIO ELLERO' },
];

function generarLineas() {
  const lineas = [];

  for (const c of CLIENTES) {
    const periodos = [
      { compras: c.ultimoAnio, desde: 5, hasta: 355, factor: 1 },
      { compras: c.anioPrevio, desde: 380, hasta: 720, factor: 1 },
    ];

    for (const { compras, desde, hasta } of periodos) {
      const meses = 12;
      for (const [familia, cantidadAnual] of Object.entries(compras)) {
        for (let m = 0; m < meses; m++) {
          const diasAtras = Math.round(desde + ((hasta - desde) * m) / (meses - 1));

          // Cliente dormido: no se le cargan operaciones recientes.
          if (c.ultimaCompraHace && diasAtras < c.ultimaCompraHace) continue;

          // Caida del ultimo trimestre para el caso de churn.
          let factor = 1 / meses;
          if (c.caidaTrimestre && diasAtras <= 90) factor *= c.caidaTrimestre;

          const cantidad = Math.round(cantidadAnual * factor);
          if (cantidad <= 0) continue;

          // En la cuenta compartida, un tercio de las lineas van al segundo agente.
          const agente =
            c.agenteSecundario && m % 3 === 0 ? c.agenteSecundario : c.agente;

          lineas.push([
            c.codigo,
            c.nombre,
            c.canal,
            c.localidad,
            c.provincia,
            iso(diasAtras),
            agente,
            familia,
            `${familia} - presentacion estandar`,
            cantidad,
            (cantidad * PRECIO[familia]).toFixed(2),
          ]);
        }
      }
    }
  }

  return lineas;
}

function principal() {
  const encabezado = [
    'Codigo Cliente', 'Cliente', 'Canal', 'Localidad', 'Provincia',
    'Fecha', 'Agente', 'Familia', 'Articulo', 'Cantidad', 'Importe Neto',
  ];

  const lineas = generarLineas();
  const csv = [encabezado, ...lineas]
    .map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))
    .join('\n');

  const rutaVentas = path.join(RAIZ, 'datos', 'ejemplo-ventas.csv');
  fs.mkdirSync(path.dirname(rutaVentas), { recursive: true });
  fs.writeFileSync(rutaVentas, csv, 'utf8');
  console.log(`\n  Archivo de ejemplo generado: ${rutaVentas} (${lineas.length} lineas)`);

  importar(rutaVentas, { reset: true });

  const db = abrirDb();
  for (const v of VENDEDORES) altaVendedor(db, { ...v, grupo: 'Venta Directa' });

  console.log('  Vendedores de prueba dados de alta:');
  for (const v of VENDEDORES) console.log(`    ${v.telefono}  ${v.nombre}`);
  console.log('\n  Listo. Arranca el servidor con "npm start" y entra a /simulador\n');
}

principal();
