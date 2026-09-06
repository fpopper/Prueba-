# Relevamiento de visitas por WhatsApp — FACBSA

Chat de WhatsApp para que la fuerza de ventas cargue el relevamiento de cada punto
de venta desde el celular, sin planillas ni papel.

El vendedor **declara a qué cliente va antes de entrar**, el bot le devuelve la
situación real de esa cuenta leída de la base, y le indica **qué tiene que
averiguar adentro** según lo que muestran los números. Al salir escribe `FIN` y
el bot le toma el relevamiento pregunta por pregunta.

---

## Cómo se ve una visita

**1. Antes de entrar** — el vendedor escribe el nombre del cliente:

```
>>> edesur

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

**2. Y lo que tiene que averiguar adentro**, generado a partir de esos números:

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

**3. Al salir** escribe `FIN` y contesta el cuestionario. Al final recibe un
resumen de lo que cargó y la oficina lo ve en el panel o lo baja a Excel.

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

Se le mandan como máximo **4 preguntas especiales** por visita, ordenadas por
criticidad: más que eso y las contesta de compromiso.

---

## Instalación

Requisito único: **Node.js 22.5 o superior**. No hay dependencias que instalar
(usa la base SQLite que trae Node), así que funciona en una máquina de la oficina
sin internet una vez copiada la carpeta.

```bash
node --version        # tiene que decir v22.5.0 o mayor
npm run demo          # carga clientes y vendedores de prueba
npm start             # levanta el servidor
```

Después abrir **http://localhost:3000/simulador** y probar el chat completo en el
navegador, sin necesidad todavía de una cuenta de WhatsApp.

Clientes de prueba para escribirle al bot: `edesur`, `electro mayorista`,
`pampa`, `junin`, `montajes del norte`, `ferreteria rosario`, o
`NUEVO Ferretería La Esquina` para un prospecto.

---

## Cargar los datos reales

El bot lee la base desde el mismo Excel que ya se exporta del sistema de ventas.

```bash
npm run importar -- ~/Descargas/ventas-2026.xlsx --reset
npm run importar -- ventas.xlsx --hoja "Detalle"     # si los datos no están en la primera hoja
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

Si algún encabezado no se reconoce, el importador lo avisa y no importa nada
mal mapeado. Se puede agregar el alias en `src/importador/normalizar.js`.

**El importe tiene que ser el precio neto con descuentos, no el de lista.**

Al terminar, el importador informa qué detectó y valida el total contra el
archivo (avisa si el desvío supera el 1%):

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

El teléfono es la credencial: si el número no está en la lista, el bot no
acepta cargar visitas.

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

---

## Conectar el WhatsApp real

Ver **[docs/conectar-whatsapp.md](docs/conectar-whatsapp.md)** para el paso a
paso con Meta (WhatsApp Cloud API). Resumen:

1. Crear la app en developers.facebook.com y agregar el producto WhatsApp.
2. Copiar `.env.example` a `.env` y completar `WHATSAPP_TOKEN`,
   `WHATSAPP_PHONE_NUMBER_ID` y `WHATSAPP_APP_SECRET`.
3. Publicar el servidor con HTTPS y registrar el webhook apuntando a
   `https://TU-DOMINIO/webhook`.

Mientras tanto el simulador permite validar todo el flujo y ajustar las
preguntas con los vendedores.

---

## Cambiar las preguntas

| Qué querés cambiar | Archivo |
|---|---|
| Las preguntas de rutina del punto de venta | `src/chat/cuestionario.js` |
| Las preguntas especiales y cuándo se disparan | `src/negocio/preguntas-especiales.js` |
| Umbrales de segmento, ratio de tomacables, días de inactividad | `src/negocio/reglas.js` |
| Los textos y el tono del bot | `src/chat/textos.js` |
| Qué muestra la ficha del cliente | `src/negocio/ficha-cliente.js` |

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
  negocio/
    reglas.js                   umbrales y reglas de FACBSA (fuente única)
    ficha-cliente.js            arma la situación del cliente
    preguntas-especiales.js     motor de reglas → preguntas dinámicas
  chat/
    maquina-estados.js          flujo de la conversación
    cuestionario.js             relevamiento del punto de venta
    gestor.js                   log de mensajes e idempotencia
    textos.js                   textos que ve el vendedor
  whatsapp/
    meta.js                     WhatsApp Cloud API (firma y envío)
  importador/
    importar.js                 Excel/CSV → base + cálculo de métricas
    normalizar.js               detección de columnas y reglas de normalización
    xlsx.js                     lector de .xlsx sin dependencias
public/simulador.html           simulador de WhatsApp para probar sin Meta
scripts/                        demo, vendedores, exportación
test/                           pruebas de reglas de negocio y del flujo
```

---

## Límites conocidos

- **Ventana de 24 horas de WhatsApp.** Meta solo deja responder libremente
  dentro de las 24 horas del último mensaje del usuario. Como acá siempre
  escribe primero el vendedor, no afecta el flujo normal; sí haría falta una
  plantilla aprobada si en el futuro se quiere que el bot inicie la conversación
  (por ejemplo, recordarle una visita pendiente).
- **Las fotos se guardan por referencia** (el `media_id` de WhatsApp), no se
  descargan. Meta las conserva unos días; si se quieren archivar hay que bajarlas.
- **La base se actualiza por import**, no en vivo contra el sistema de gestión.
  Conviene correr el import con la frecuencia con que se exporta el reporte de
  ventas (semanal o mensual).
- **El gap de tomacables es una estimación** basada en un ratio comercial de
  referencia (1 cada 2 jabalinas), no una demanda insatisfecha comprobada. El bot
  se lo aclara al vendedor en el mismo mensaje.
- **No hay geolocalización obligatoria.** El esquema tiene los campos de latitud
  y longitud previstos, pero el flujo actual no le pide la ubicación al vendedor.
