# Conectar el bot a WhatsApp (Meta Cloud API)

Paso a paso para pasar del simulador al WhatsApp real. Todo lo que se hace en
Meta es gratis; lo que se paga son las conversaciones (ver el final).

---

## 1. Requisitos previos

- Una cuenta de **Facebook Business Manager** de FACBSA.
- Un **número de teléfono** que no esté siendo usado por la app de WhatsApp ni
  por WhatsApp Business. Puede ser un número nuevo de la empresa.
- Un **servidor accesible desde internet con HTTPS**. Meta no acepta webhooks
  sin certificado válido ni direcciones locales.

---

## 2. Crear la app en Meta

1. Entrar a [developers.facebook.com](https://developers.facebook.com) → **Mis
   apps** → **Crear app**.
2. Elegir el tipo **Empresa** y asociarla al Business Manager de FACBSA.
3. En el panel de la app, agregar el producto **WhatsApp**.
4. En *WhatsApp → Configuración de la API* aparecen:
   - **Identificador del número de teléfono** → va en `WHATSAPP_PHONE_NUMBER_ID`
   - **Token de acceso temporal** → va en `WHATSAPP_TOKEN`
5. En *Configuración de la app → Básica* está el **Clave secreta de la app**
   (App Secret) → va en `WHATSAPP_APP_SECRET`.

> El token temporal dura 24 horas y sirve para probar. Para producción hay que
> generar un **token permanente de usuario del sistema** desde Business Manager
> (Configuración del negocio → Usuarios del sistema → Generar token, con los
> permisos `whatsapp_business_messaging` y `whatsapp_business_management`).

---

## 3. Configurar el servidor

Copiar `.env.example` a `.env` y completar:

```env
PORT=3000
WHATSAPP_TOKEN=EAAG...
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_VERIFY_TOKEN=facbsa-verificacion-2026
WHATSAPP_APP_SECRET=a1b2c3...
ADMIN_KEY=una-clave-larga-para-el-panel
SIMULADOR=false

# Para que entienda lenguaje natural y escuche los audios
ANTHROPIC_API_KEY=sk-ant-...
TRANSCRIPCION_PROVEEDOR=openai
TRANSCRIPCION_API_KEY=sk-...
```

`WHATSAPP_VERIFY_TOKEN` es un valor que se inventa acá y se pega igual en Meta
en el paso siguiente. `SIMULADOR=false` conviene en producción para no dejar
abierto el chat de prueba.

Levantar el servidor:

```bash
npm start
```

---

## 4. Publicarlo con HTTPS

El servidor tiene que quedar accesible en `https://algo/webhook`. Opciones,
de menor a mayor esfuerzo:

- **Para probar hoy**: `npx localtunnel --port 3000` o
  [ngrok](https://ngrok.com) generan una URL pública temporal.
- **Producción chica**: un VPS con nginx como reverse proxy y certificado de
  Let's Encrypt.
- **Producción sin servidor propio**: cualquier PaaS que corra Node 22.

---

## 5. Registrar el webhook

1. En la app de Meta: *WhatsApp → Configuración → Webhooks → Editar*.
2. **URL de devolución de llamada**: `https://TU-DOMINIO/webhook`
3. **Token de verificación**: el mismo valor que pusiste en
   `WHATSAPP_VERIFY_TOKEN`.
4. Clic en **Verificar y guardar**. Meta hace un GET a esa URL y el servidor le
   responde el challenge; si falla, revisar que el servidor esté levantado y que
   el token coincida exactamente.
5. En **Campos del webhook**, suscribirse a **messages**. Con ese único campo
   llegan los mensajes de texto, las notas de voz, las fotos y las respuestas
   de la botonera.

---

## 6. Probar

1. Dar de alta tu propio número como vendedor:
   ```bash
   node scripts/vendedores.js alta 5491155667788 "Tu Nombre" "FACBSA"
   ```
2. Mandarle un `hola` por WhatsApp al número de la app.
3. Tiene que contestar el saludo y preguntarte a qué cliente vas.
4. Probá el circuito completo: decile un cliente, después mandale una nota de voz
   contándole una visita inventada y fijate que registre lo que dijiste y que te
   repregunte lo que falte con botones.

Si no contesta, mirar la consola del servidor: los errores de envío de Meta se
loguean con el detalle completo.

---

## 7. Pasar a producción

- **Verificación del negocio**: hasta que Meta verifique a FACBSA, el número
  está limitado a 250 conversaciones por día y a 5 números de prueba. Alcanza
  para arrancar con un grupo de vendedores.
- **Token permanente**: reemplazar el temporal antes de salir a producción.
- **Nombre para mostrar**: configurar el nombre comercial que ven los
  vendedores en el chat (*WhatsApp → Configuración del perfil*).
- **Backup**: la base es un solo archivo (`datos/facbsa.db`). Copiarlo
  periódicamente alcanza como respaldo.

---

## Sobre la botonera

Las preguntas de opción cerrada se mandan como mensajes interactivos de Meta:
hasta 3 opciones salen como botones, de 4 a 10 como lista desplegable. Los
límites de la API los aplica `src/whatsapp/meta.js` y hay una prueba que verifica
que ninguna opción del cuestionario supere los 20 caracteres del título de un
botón. Si se agregan opciones nuevas más largas, la prueba falla antes de que
Meta rechace el mensaje en producción.

Los mensajes interactivos tienen un cuerpo de 1024 caracteres como máximo. La
ficha del cliente es más larga, así que se manda como texto suelto y la botonera
va aparte: eso ya está resuelto en el código.

## Costos (referencia)

Meta cobra por conversación iniciada, no por mensaje. Las conversaciones de
**servicio** (las que inicia el usuario, que es el caso de este bot) tienen un
cupo mensual gratuito y después un costo bajo por conversación en Argentina.

Con ~10 vendedores haciendo ~8 visitas por día, son unas 1.600 conversaciones
mensuales. Conviene chequear la tarifa vigente en la
[lista de precios de Meta](https://business.whatsapp.com/products/platform-pricing),
porque cambia por país y por período.
