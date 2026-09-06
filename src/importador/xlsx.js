// Lector minimo de archivos .xlsx, sin dependencias.
//
// Un .xlsx es un ZIP con XML adentro. Leemos el directorio central del ZIP,
// descomprimimos las entradas que nos interesan y parseamos el XML con
// expresiones regulares. Alcanza para planillas de datos como las que exporta
// el sistema de FACBSA (una tabla por hoja, sin formulas raras).
//
// Si algun archivo no se pudiera leer, la alternativa siempre disponible es
// exportar la hoja como CSV desde Excel.
import fs from 'node:fs';
import zlib from 'node:zlib';

// --- ZIP ---------------------------------------------------------------------

function leerZip(ruta) {
  const buf = fs.readFileSync(ruta);

  // El "end of central directory" esta al final del archivo.
  let fin = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66_000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin === -1) throw new Error('El archivo no parece un .xlsx valido (no se encontro el ZIP).');

  const cantidad = buf.readUInt16LE(fin + 10);
  let offset = buf.readUInt32LE(fin + 16);
  const entradas = new Map();

  for (let i = 0; i < cantidad; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(offset + 10);
    const tamComprimido = buf.readUInt32LE(offset + 20);
    const largoNombre = buf.readUInt16LE(offset + 28);
    const largoExtra = buf.readUInt16LE(offset + 30);
    const largoComentario = buf.readUInt16LE(offset + 32);
    const offsetLocal = buf.readUInt32LE(offset + 42);
    const nombre = buf.toString('utf8', offset + 46, offset + 46 + largoNombre);

    // La cabecera local repite nombre y extra, con largos propios.
    const largoNombreLocal = buf.readUInt16LE(offsetLocal + 26);
    const largoExtraLocal = buf.readUInt16LE(offsetLocal + 28);
    const inicio = offsetLocal + 30 + largoNombreLocal + largoExtraLocal;
    const datos = buf.subarray(inicio, inicio + tamComprimido);

    entradas.set(nombre, metodo === 0 ? datos : zlib.inflateRawSync(datos));
    offset += 46 + largoNombre + largoExtra + largoComentario;
  }

  return entradas;
}

// --- XML ---------------------------------------------------------------------

function desescapar(texto) {
  return String(texto)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

function textoDeNodo(xml) {
  // Concatena todos los <t>...</t>, que es como se guardan los strings con
  // formato mixto (rich text).
  const partes = [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => desescapar(m[1]));
  return partes.join('');
}

function leerSharedStrings(entradas) {
  const xml = entradas.get('xl/sharedStrings.xml');
  if (!xml) return [];
  const texto = xml.toString('utf8');
  return [...texto.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textoDeNodo(m[1]));
}

function columnaANumero(ref) {
  const letras = ref.match(/^[A-Z]+/)?.[0] || 'A';
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

// --- API publica -------------------------------------------------------------

/** Devuelve los nombres de las hojas del libro, en orden. */
export function listarHojas(ruta) {
  const entradas = leerZip(ruta);
  const workbook = entradas.get('xl/workbook.xml')?.toString('utf8') || '';
  return [...workbook.matchAll(/<sheet[^>]*name="([^"]+)"/g)].map((m) => desescapar(m[1]));
}

/**
 * Lee una hoja y devuelve una matriz de filas (array de arrays de strings).
 * @param {string} ruta
 * @param {string|number} hoja  nombre de la hoja o indice (0 = primera)
 */
export function leerHoja(ruta, hoja = 0) {
  const entradas = leerZip(ruta);
  const workbook = entradas.get('xl/workbook.xml')?.toString('utf8') || '';
  const rels = entradas.get('xl/_rels/workbook.xml.rels')?.toString('utf8') || '';

  const hojas = [...workbook.matchAll(/<sheet[^>]*?name="([^"]+)"[^>]*?r:id="([^"]+)"/g)].map(
    (m) => ({ nombre: desescapar(m[1]), rid: m[2] })
  );
  if (!hojas.length) throw new Error('El libro no tiene hojas legibles.');

  const elegida =
    typeof hoja === 'number'
      ? hojas[hoja]
      : hojas.find((h) => h.nombre.toLowerCase() === String(hoja).toLowerCase());
  if (!elegida) {
    throw new Error(`No existe la hoja "${hoja}". Hojas disponibles: ${hojas.map((h) => h.nombre).join(', ')}`);
  }

  const destino = rels.match(new RegExp(`Id="${elegida.rid}"[^>]*Target="([^"]+)"`))?.[1];
  const clave = destino
    ? `xl/${destino.replace(/^\/?xl\//, '').replace(/^\//, '')}`
    : `xl/worksheets/sheet${hojas.indexOf(elegida) + 1}.xml`;

  const xmlHoja = (entradas.get(clave) || entradas.get(`xl/worksheets/sheet1.xml`))?.toString('utf8');
  if (!xmlHoja) throw new Error(`No se pudo leer la hoja "${elegida.nombre}".`);

  const compartidos = leerSharedStrings(entradas);
  const filas = [];

  for (const mFila of xmlHoja.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const celdas = [];
    for (const mCelda of mFila[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const atributos = mCelda[1];
      const contenido = mCelda[2];
      const ref = atributos.match(/r="([A-Z]+\d+)"/)?.[1];
      const tipo = atributos.match(/t="([^"]+)"/)?.[1];
      const indice = ref ? columnaANumero(ref) : celdas.length;

      let valor = '';
      if (tipo === 's') {
        const i = Number(contenido.match(/<v>([\s\S]*?)<\/v>/)?.[1]);
        valor = compartidos[i] ?? '';
      } else if (tipo === 'inlineStr') {
        valor = textoDeNodo(contenido);
      } else {
        valor = desescapar(contenido.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
      }

      celdas[indice] = valor;
    }
    // Las celdas vacias quedan como huecos del array: los rellenamos.
    for (let i = 0; i < celdas.length; i++) if (celdas[i] === undefined) celdas[i] = '';
    filas.push(celdas);
  }

  return filas;
}

/**
 * Convierte el numero de serie de fecha de Excel a ISO yyyy-mm-dd.
 * Excel cuenta dias desde el 30/12/1899 (con el bug del año 1900 incluido).
 */
export function serialAFecha(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const fecha = new Date(ms);
  if (Number.isNaN(fecha.getTime())) return null;
  return fecha.toISOString().slice(0, 10);
}
