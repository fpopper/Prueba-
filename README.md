# Relevamiento de visitas por WhatsApp — FACBSA

Un agente conversacional de WhatsApp para que la fuerza de ventas cargue el
relevamiento de cada punto de venta desde el celular, hablando normal.

El vendedor le dice a quién va a visitar, el bot le devuelve la situación real de
esa cuenta leída de la base y le indica qué averiguar adentro. Al salir, le manda
**un audio contando cómo le fue**: el bot lo transcribe, registra lo que entendió
y le repregunta sólo lo que falta.

No hay comandos, ni menúes, ni formularios. La conversación es la interfaz.

---

## Cómo se ve una visita

**1. Antes de entrar** — el vendedor escribe o dice a quién va a ver:

```
>>> estoy yendo a lo de edesur
```

El bot lo busca en la base y le manda la ficha con los números exactos:

```
📋 EDESUR DISTRIBUCION ELECTRICA SA
Cod. C-1001 · EMPRESA ENERGIA · Avellaneda, Buenos Aires

Segmento A — CLAVE · #1 del ranking
💰 Facturacion 12m: $87,2M (29,4% del total)
▼ vs 12m anteriores: -2%
▼ ultimo trimestre: -30%
🗓️ Ultima compra: 01/09/2026 (hace 0 dias)
👤 Atiende: FACBSA

Que compra:
• CABLE IRAM 2467: $56,5M
• JABALINAS LISAS: $26,6M
• TOMACABLES: $4,1M

🔩 Jabalinas 831 u. · Tomacables 354 u. (ratio 43%, objetivo 50%)

Atencion:
🔴 Esta cuenta es el 29% de la facturacion total de FACBSA.
🔴 Riesgo de churn: cuenta clave con caida de 30% en el ultimo trimestre.
🟢 Gap de tomacables estimado: 62 u. ≈ $707k.
```

Y lo que tiene que averiguar adentro, generado a partir de esos números:

```
❗ Averigua esto adentro (te lo vuelvo a preguntar al salir):

🔴 1. ¿Por que bajaron las compras? ¿Entro otro proveedor, se les freno la obra,
      o hubo un problema con nosotros?
      Es cuenta clave (segmento A) y cayo 30% en el trimestre.

🟠 2. ¿Estamos homologados en su pliego? ¿Cuando abre la proxima licitacion?
      Es una distribuidora electrica: aca la compra pasa por licitacion.

🟠 3. ¿Estarian dispuestos a firmar un contrato marco anual?
      Concentra el 29% de la facturacion de FACBSA.
```

**2. Al salir** — manda una nota de voz:

> *"Salí de Edesur. Hablé con Marcelo Ruiz, jefe de compras. Bajaron las compras
> porque entró Genrod con mejor precio en cable. Tienen poco stock nuestro.
> Homologados estamos, la licitación abre en marzo. Lo del contrato marco lo
> tienen que ver con dirección. Quedó que les mando cotización el lunes."*

El bot la transcribe, registra todo lo que entendió y sólo pregunta lo que falta:

```
Anoté todo. Me quedan dos cosas:

¿Cómo ven nuestro precio frente a la competencia?
  [ Más barato ] [ Parecido ] [ Un poco más caro ] ...

>>> (toca "Un poco más caro")

¿Tenían cartelería nuestra a la vista?
  [ Sí, bien exhibido ] [ Algo, pero poco ] [ Nada ]
```

Las opciones cerradas van como **botonera nativa de WhatsApp**: parado en la
vereda de un cliente, tocar un botón es mucho más rápido que escribir.

---

## Qué hace distinto a un formulario

Un formulario le pregunta lo mismo a todos. Esto **mira la base antes de
preguntar**: quién es el cliente, cuánto compra, qué dejó de comprar, qué gap
tiene, quién lo atiende. Las preguntas especiales salen de las reglas de negocio
de FACBSA, no de una lista fija:

| Situación detectada en la base | Qué le pide averiguar al vendedor |
|---|---|
| Cuenta segmento A que cae más de 15% en el trimestre | Por qué bajaron: proveedor nuevo, obra frenada o problema nuestro |
| Sin comprar hace más de 90 días | A quién le compran hoy y por qué nos dejaron |
| Compra jabalinas pero pocos tomacables (ratio < 50%) | A quién le compran los tomacables y a qué precio |
| Compra más tomacables que jabalinas (gap invertido) | Dónde compran las jabalinas |
| No compra VARIOS (Conjuntos) | Si le mostró el conjunto armado y qué dijo |
| Compra pararrayos sueltos | Quién le provee el resto del sistema |
| Compra jabalinas 10/14 | Quién define la sección y si se puede migrar a 16/18 |
| Canal EMPRESA ENERGIA | Homologación y fecha de la próxima licitación |
| Canal DISTRIBUIDOR | Rotación, stock y competencia en góndola |
| Canal CONSTRUCTORA | Obras adjudicadas para los próximos 6 meses |
| Cuenta > 15% de la facturación total | Disposición a firmar contrato marco |
| Segmento B | Qué necesitaría para duplicar la compra |
| Segmento C | Cuál es el freno concreto para crecer |
| Segmento D | Si conviene desarrollarlo o pasarlo a pedido mínimo |
| Cuenta compartida entre dos agentes | Con quién de FACBSA trabajan realmente |
| Prospecto sin historia | Qué compran hoy, a quién y qué volumen |

Se le piden como máximo **4 preguntas especiales** por visita, ordenadas por
criticidad: más que eso y las contesta de compromiso.

---

## La competencia en el punto de venta

Saber "vi Genrod en el mostrador" sirve para leer una visita suelta, pero no se
puede sumar entre cuentas. Por eso la competencia no se releva como texto libre:
se releva **por competidor y por familia de producto**, con escalas cerradas.

De cada proveedor que aparece se capturan cuatro cosas:

| Qué | Cómo se releva | Para qué sirve |
|---|---|---|
| **En qué nos compite** | Familia de producto de FACBSA | Abrir el mapa por producto, no por cuenta |
| **Cuánto se lleva** | Todo / La mayor parte / Mitad y mitad / Una parte chica / Casi nada | Dimensionar el volumen en juego |
| **A qué precio** | Mucho más barato → Algo más caro, con un valor numérico detrás | Saber si es una guerra de precio o de otra cosa |
| **Por qué le compran a él** | Precio · Entrega o stock · Plazo de pago · Costumbre o relación · Lo pide el pliego · No nos conocían | Es la palanca: cada motivo se corrige en un área distinta |

El motivo es la parte que más rinde. Una cuenta perdida por **entrega** es un
problema de Producción, no de Comercial; una perdida por **costumbre** es la más
recuperable y depende de la frecuencia de visita; una perdida porque **lo pide el
pliego** no es una pérdida comercial sino una homologación pendiente.

### El mapa de competencia

```bash
npm run competencia                        # resumen en pantalla
npm run competencia -- --familia TOMACABLES
npm run competencia -- --csv               # detalle a Excel
```

```
  MAPA DE COMPETENCIA — 6 registros de 3 cuentas

  Competidor               Ctas   Se lleva    Precio  Motivo principal
  GENROD                      2        58%       -9%  Entrega o stock
                                 compite en: JABALINAS LISAS, CABLE IRAM 2467
  SICAME                      1       100%       -8%  Precio
                                 compite en: TOMACABLES

  Dónde nos están ganando (ordenado por tamaño de cuenta)
  ELECTRO MAYORISTA DEL PLATA SRL  B   SICAME   TOMACABLES   Precio
```

### Se realimenta solo

Lo relevado en una visita vuelve en la ficha de la siguiente, y cambia la
pregunta. En vez de volver a preguntar de cero:

```
*Competencia relevada:*
• GENROD en CABLE IRAM 2467 · la mayor parte · mucho más barato · por precio

🟠 GENROD se lleva la mayor parte de CABLE IRAM 2467 (por precio).
```

```
🟠 ¿Sigue igual con ese proveedor o algo cambió? Si cambió, ¿qué se movió:
   el precio, la entrega o la relación?
   En la visita anterior quedó que GENROD se lleva la mayor parte de
   CABLE IRAM 2467, por precio.
```

### El catálogo de competidores

Está en `src/negocio/competencia.js`, con los alias con que los nombran los
vendedores. **La lista inicial está pendiente de validar con Comercial**: hay que
reemplazarla por los que realmente aparecen en la calle. Un competidor que no
está en el catálogo no se fuerza dentro de otro — se guarda con el nombre que
dijo el vendedor y el reporte lo lista aparte, igual que se hace con las familias
de producto desconocidas.

---

## Los dos modos

| | **Agente** (con `ANTHROPIC_API_KEY`) | **Guiado** (sin clave) |
|---|---|---|
| Entrada | Lenguaje natural, texto o audio | Texto, pregunta por pregunta |
| Cómo declara el cliente | "estoy yendo a lo de edesur" | Escribe el nombre |
| Cómo carga la visita | Un audio y el bot repregunta lo que falta | Contesta 13 preguntas seguidas |
| Botonera de WhatsApp | Sí | Sí |
| Costo por visita | Centavos de dólar | Cero |

El modo guiado no es una maqueta: es el mismo relevamiento, con las mismas
reglas y la misma base. Sirve como respaldo si se cae la API o si se quiere
arrancar sin costo variable. El bot elige el modo solo, según si hay clave.

---

## Instalación

Requiere **Node.js 22.5 o superior**.

```bash
npm install           # instala el SDK de Anthropic (única dependencia)
npm run demo          # carga clientes y vendedores de prueba
npm start             # levanta el servidor
```

Después abrir **http://localhost:3000/simulador** y probar el chat completo en el
navegador, sin necesidad todavía de una cuenta de WhatsApp. El simulador muestra
la botonera tal como se ve en WhatsApp y deja grabar audio con el micrófono.

Clientes de prueba: `edesur`, `electro mayorista`, `pampa`, `junin`,
`montajes del norte`, `ferretería rosario`.

### Encender el modo agente

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
TRANSCRIPCION_PROVEEDOR=openai
TRANSCRIPCION_API_KEY=sk-...
```

Claude no procesa audio, así que la transcripción la hace un servicio de
speech-to-text aparte. Están implementados dos, se elige con
`TRANSCRIPCION_PROVEEDOR`:

| Proveedor | Modelo por defecto | Costo aprox. | Nota |
|---|---|---|---|
| `openai` | `whisper-1` | ~USD 0,006 / minuto | El más probado en español rioplatense |
| `deepgram` | `nova-3` | ~USD 0,004 / minuto | Más barato, algo más rápido |
| `ninguno` | — | — | El bot avisa que no puede escuchar y pide texto |

Al transcriptor se le pasa el vocabulario del rubro (jabalinas, tomacables,
IRAM 2467, soldadura exotérmica). Sin eso, esas palabras salen mal escritas muy
seguido y después no hay forma de buscarlas en los relevamientos.

**Costo estimado**: con 10 vendedores × 8 visitas por día, entre transcripción y
conversación son unos pocos dólares por día. El modelo (`claude-opus-5`) y el
esfuerzo (`ANTHROPIC_EFFORT`, arranca en `low`) se cambian en el `.env`.

---

## Cargar los datos reales

El bot lee la base desde el mismo Excel que ya se exporta del sistema de ventas.

```bash
npm run importar -- ~/Descargas/ventas-2026.xlsx --reset
npm run importar -- ventas.xlsx --hoja "Detalle"     # si no están en la primera hoja
```

**Columnas que necesita** (las busca por nombre, no por posición, y acepta las
variantes habituales del sistema):

| Campo | Encabezados que reconoce | Obligatorio |
|---|---|---|
| Cliente | Cliente, Razón Social, Cuenta, Nombre | **sí** |
| Fecha | Fecha, Fecha Comprobante, Fecha Factura | **sí** |
| Importe | Importe Neto, Neto, Importe, Total, Facturación | **sí** |
| Código | Código Cliente, Cod. Cliente | no |
| Agente | Agente, Vendedor, Representante | no |
| Canal | Canal, Tipo Cliente, Rubro Cliente | no |
| Familia | Familia, Línea, Rubro Producto | no |
| Cantidad | Cantidad, Cant., Unidades | no |
| Localidad / Provincia | Localidad, Ciudad, Provincia | no |

Si algún encabezado no se reconoce, el importador lo avisa y no importa nada mal
mapeado. Se puede agregar el alias en `src/importador/normalizar.js`.

**El importe tiene que ser el precio neto con descuentos, no el de lista.**

Al terminar informa qué detectó y valida el total contra el archivo (avisa si el
desvío supera el 1%):

```
Filas importadas:      990
Fecha de corte:        2026-09-01
Cuentas activas 12m:   13
Facturacion 12m:       $296,8M
Cuentas compartidas:   1
Gap de tomacables:     416 u. ≈ $4,8M en 8 clientes
Segmentacion:  A: 1 · B: 9 · C: 2 · D: 1
```

### Reglas de negocio que aplica al importar

- **FACSA = FACBSA**: los cuatro identificadores de Venta Directa (FACBSA, FACSA,
  N.ANTONUCCI, SERGIO ELLERO) se consolidan; el resto son representantes externos.
- **Cuentas compartidas**: la cuenta se atribuye al agente con mayor facturación
  en los últimos 12 meses. Si el segundo supera el 25%, queda registrado también.
- **Familias**: se normalizan los alias del sistema. Una familia desconocida
  **no** se interpreta: queda marcada como SIN CLASIFICAR para que la valide Comercial.
- **Segmentación**: bandas A (>$50M), B ($10–50M), C ($1–10M), D (<$1M).
- **Gap de tomacables**: se calcula contra jabalinas (1 cada 2), no contra metros
  de cable, y se excluyen los clientes con menos de 20 jabalinas.

Los umbrales están todos en `src/negocio/reglas.js`. Si Comercial cambia un
criterio, se toca ahí y todo el bot queda alineado.

---

## Dar de alta a los vendedores

El teléfono es la credencial: si el número no está en la lista, el bot no acepta
cargar visitas.

```bash
node scripts/vendedores.js listar
node scripts/vendedores.js alta 5491155667788 "Juan Perez" "N.ANTONUCCI"
node scripts/vendedores.js baja 5491155667788
node scripts/vendedores.js importar datos/vendedores-ejemplo.csv
```

El teléfono va en formato internacional sin `+`: `5491155667788`.

---

## Ver los relevamientos

**Panel web** — `http://localhost:3000/panel?clave=LA_CLAVE` (la clave se
configura en `ADMIN_KEY` del `.env`).

**Excel** — desde el panel con "descargar CSV", o por línea de comandos:

```bash
npm run exportar
npm run exportar -- --desde 2026-09-01
```

El CSV sale con una fila por respuesta e incluye la columna `regla_id`, que dice
qué regla de negocio disparó cada pregunta especial. Con eso se puede medir, por
ejemplo, cuántos clientes con gap de tomacables dijeron que le compran a la
competencia y a qué precio.

La competencia sale por separado con `npm run competencia`, porque la pregunta
que responde no es "cómo fue esta visita" sino "quién nos compite y dónde".

Las transcripciones de los audios quedan guardadas aparte, en la tabla
`transcripciones`: sirven para auditar qué dijo el vendedor y qué entendió el
agente.

---

## Conectar el WhatsApp real

Ver **[docs/conectar-whatsapp.md](docs/conectar-whatsapp.md)** para el paso a
paso con Meta. Resumen:

1. Crear la app en developers.facebook.com y agregar el producto WhatsApp.
2. Completar `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` y `WHATSAPP_APP_SECRET`
   en el `.env`.
3. Publicar el servidor con HTTPS y registrar el webhook en
   `https://TU-DOMINIO/webhook`.

---

## Cambiar el comportamiento

| Qué querés cambiar | Archivo |
|---|---|
| Cómo habla el agente, qué puede y qué no | `src/ia/agente.js` (las instrucciones) |
| Qué puede hacer el agente contra la base | `src/ia/herramientas.js` |
| Los puntos del relevamiento del punto de venta | `src/chat/cuestionario.js` |
| El catálogo de competidores y las escalas de competencia | `src/negocio/competencia.js` |
| Las preguntas especiales y cuándo se disparan | `src/negocio/preguntas-especiales.js` |
| Umbrales de segmento, ratio de tomacables, días de inactividad | `src/negocio/reglas.js` |
| Qué muestra la ficha del cliente | `src/negocio/ficha-cliente.js` |
| Los textos del modo guiado | `src/chat/textos.js` |

Después de cualquier cambio:

```bash
npm test
```

---

## Estructura

```
src/
  server.js                     servidor HTTP: webhook, simulador, panel
  config.js                     configuración por variables de entorno
  db/
    schema.sql                  esquema de la base
    db.js                       apertura de SQLite
    queries.js                  consultas de negocio
  ia/
    agente.js                   el agente conversacional y su bucle
    herramientas.js             lo que el agente puede hacer contra la base
    transcribir.js              notas de voz → texto
  negocio/
    reglas.js                   umbrales y reglas de FACBSA (fuente única)
    competencia.js              catálogo de competidores, escalas y agregación
    ficha-cliente.js            arma la situación del cliente
    preguntas-especiales.js     motor de reglas → preguntas dinámicas
  chat/
    gestor.js                   elige el modo, transcribe, log e idempotencia
    cuestionario.js             puntos del relevamiento y botonera
    maquina-estados.js          flujo determinista del modo guiado
    textos.js                   textos del modo guiado
  whatsapp/
    meta.js                     Cloud API: firma, botonera, audio
  importador/
    importar.js                 Excel/CSV → base + cálculo de métricas
    normalizar.js               detección de columnas y normalización
    xlsx.js                     lector de .xlsx sin dependencias
public/simulador.html           simulador de WhatsApp, con micrófono
scripts/                        demo, vendedores, exportación, mapa de competencia
test/                           reglas de negocio, flujo guiado y agente
```

---

## Cómo se evita que el agente invente

Es la preocupación razonable de poner un modelo de lenguaje a hablar de números
de facturación. Tres barreras:

1. **La ficha no la escribe el modelo.** La arma el código desde la base y se le
   manda al vendedor tal cual. El agente recibe el aviso de que ya se envió y la
   instrucción de no repetir los números.
2. **Todo lo que se guarda pasa por una herramienta con esquema estricto.** Una
   respuesta de opción cerrada que no coincida exactamente con una de las
   opciones válidas se rechaza y se le devuelve el error al modelo.
3. **El cierre lo controla el código, no el modelo.** `cerrar_visita` falla
   mientras queden puntos obligatorios sin responder, así que el agente no puede
   dar por terminada una visita a medias.

---

## Límites conocidos

- **El modo agente no está probado contra la API real todavía.** El bucle, el
  despacho de herramientas y la botonera están cubiertos por pruebas con un
  cliente simulado, pero hace falta una `ANTHROPIC_API_KEY` para verificar la
  conversación de punta a punta. El modo guiado sí está probado completo.
- **Ventana de 24 horas de WhatsApp.** Meta sólo deja responder libremente
  dentro de las 24 horas del último mensaje del usuario. Como acá siempre
  escribe primero el vendedor, no afecta el flujo normal; sí haría falta una
  plantilla aprobada para que el bot inicie la conversación.
- **Las fotos se guardan por referencia** (el `media_id` de WhatsApp), no se
  descargan. Meta las conserva unos días; si se quieren archivar hay que bajarlas.
- **La base se actualiza por import**, no en vivo contra el sistema de gestión.
  Conviene correr el import con la frecuencia con que se exporta el reporte de
  ventas.
- **El gap de tomacables es una estimación** basada en un ratio comercial de
  referencia (1 cada 2 jabalinas), no una demanda insatisfecha comprobada. Tanto
  la ficha como el agente se lo aclaran al vendedor.
- **No hay geolocalización obligatoria.** El esquema tiene los campos previstos,
  pero el flujo actual no le pide la ubicación al vendedor.
