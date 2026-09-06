// Configuracion central. Todo se toma de variables de entorno para no dejar
// credenciales en el repositorio. Ver .env.example.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Carga simple de .env (sin dependencias). Las variables ya definidas en el
// entorno tienen prioridad sobre el archivo.
function cargarEnv() {
  const archivo = path.join(RAIZ, '.env');
  if (!fs.existsSync(archivo)) return;
  for (const linea of fs.readFileSync(archivo, 'utf8').split('\n')) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith('#')) continue;
    const corte = limpia.indexOf('=');
    if (corte === -1) continue;
    const clave = limpia.slice(0, corte).trim();
    let valor = limpia.slice(corte + 1).trim();
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    if (process.env[clave] === undefined) process.env[clave] = valor;
  }
}
cargarEnv();

export const config = {
  puerto: Number(process.env.PORT || 3000),
  rutaDb: process.env.DB_PATH || path.join(RAIZ, 'datos', 'facbsa.db'),

  // WhatsApp Cloud API (Meta)
  whatsapp: {
    token: process.env.WHATSAPP_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'facbsa-verificacion',
    appSecret: process.env.WHATSAPP_APP_SECRET || '',
    version: process.env.WHATSAPP_API_VERSION || 'v21.0',
  },

  // El simulador web permite probar el chat completo sin cuenta de Meta.
  simuladorHabilitado: (process.env.SIMULADOR || 'true') !== 'false',

  // Clave para consultar el panel/exportacion por HTTP. Si esta vacia, el
  // panel queda deshabilitado.
  claveAdmin: process.env.ADMIN_KEY || '',

  zonaHoraria: process.env.TZ_FACBSA || 'America/Argentina/Buenos_Aires',
};

export const whatsappConfigurado = Boolean(
  config.whatsapp.token && config.whatsapp.phoneNumberId
);
