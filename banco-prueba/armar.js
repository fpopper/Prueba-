/* Arma el HTML del banco de prueba: plantilla + fichas + codigo.
   Uso: node banco-prueba/armar.js  ->  banco-prueba/asistente-visitas.html
   El archivo resultante se publica como artifact con las capacidades
   sample, db y mcp (conector Notion). No se versiona el HTML armado. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const leer = (f) => fs.readFileSync(path.join(dir, f), "utf8");

const json = (f) => JSON.stringify(JSON.parse(leer(f))).replace(/<\//g, "<\\/");
const html = leer("plantilla.html")
  .replace("__DATOS__", () => json("fichas.json"))
  .replace("__VENTAS__", () => json("ventas.json"))
  .replace("__CODIGO__", () => leer("codigo.js"));

const salida = path.join(dir, "asistente-visitas.html");
fs.writeFileSync(salida, html);
console.log(`${salida} — ${html.length} bytes`);
