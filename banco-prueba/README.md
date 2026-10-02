# Banco de prueba del asistente de visitas

Ambiente para probar el asistente de la fuerza de ventas **en la calle, sin
WhatsApp**. Un solo hilo de chat conducido por un agente: el vendedor habla, el
agente razona sobre la situación de esa cuenta y usa herramientas para ir a
buscar los datos y para dejar lo relevado asentado.

## A quién atiende

**Exclusivamente distribuidoras de materiales eléctricos**: el mayorista con
mostrador y depósito que le revende al electricista, al instalador y a la obra
chica. Quedan fuera constructoras, distribuidoras de energía (EDESUR, EDENOR,
ENERSA), fabricantes e industria.

En los datos, `Actividad = "Distribuidor eléctrico"` y `Canal = "Distribuidor"`
coinciden uno a uno: **203 clientes A/B/C, $4.150M en 12 meses, el 51,8% de la
facturación**. Esa es la cartera. Si el vendedor nombra un cliente de otro
rubro, la herramienta se lo marca como fuera de alcance al agente, que lo avisa
y le pasa la ficha igual aclarando que las reglas del canal no aplican.

Registrado en Notion como regla **#16, estado "A validar"**.

### Qué cambia por ser este canal

El asistente no razona igual sobre un mayorista que sobre una obra. Lo que
tiene incorporado:

- **Sell-in no es sell-out.** Lo que nos factura es lo que entró al depósito.
  Lo que decide la próxima compra es lo que salió del mostrador.
- **Sin stock no hay venta.** Si el mostrador no tiene jabalina FACBSA, le vende
  la del competidor al electricista que entró a comprarla. El quiebre no aparece
  en ningún número.
- **La góndola es espacio disputado.** Dejar de comprar una familia entera,
  aunque el total aguante, es haber perdido ese lugar.
- **El que decide no es el que atiende**, pero el del mostrador es quien le
  recomienda la marca al electricista. Hay que trabajar a los dos.
- **Cada cuánto repone** importa tanto como cuánto compra.
- **La norma IRAM es la ventaja** contra el importado barato.

Reglas que se ajustaron: la inactividad usa sólo el plazo de Distribuidor
(60 días alarma, 120 perdido) y se eliminó la pregunta por pliego y
homologación, que sólo tenía sentido en distribuidoras de energía.

### Dos señales nuevas, propias del canal

| Señal | Cómo se calcula | Por qué importa |
|---|---|---|
| **Góndola perdida** (`perd`) | familia comprada en los 12 meses anteriores (≥$100k y ≥3% de su total) y ≤5% de eso en los últimos 12 | la tapa el número grueso: **43 de 203 distribuidores** perdieron al menos una familia entera con la facturación total intacta |
| **Frecuencia de reposición** (`meses`) | en cuántos de los últimos 12 meses compró | distingue al que repone seguido del que compra fuerte una vez al año y se queda sin |

Ejemplo real: ARGELEC S.A. sigue comprando 11 de 12 meses, pero dejó de
comprar Conduweld 30% ($24,6M el año anterior) y Soldadura ($10,5M).

## Quién conduce

No hay guion. En cada mensaje se llama a Claude con el diálogo completo, las
reglas del negocio y **seis herramientas que corren dentro de la página**.
Claude decide si busca un cliente, abre una ficha, consulta el reporte, lee
Notion o escribe en Notion, y en qué orden.

| Herramienta | Qué hace |
|---|---|
| `buscar_cliente` | busca por nombre, localidad o CUIT; sin texto devuelve los más urgentes del vendedor |
| `ficha_cliente` | abre la ficha, la muestra en el chat y la fija como la visita en curso; devuelve alertas y puntos a averiguar |
| `reporte_ventas` | el reporte comercial de ese cliente: `por_mes`, `por_producto` o `comprobantes`, con filtro de producto y período |
| `notion_leer` | contactos, visitas anteriores, competidores, reglas de negocio, ficha administrativa, cuestionario |
| `notion_guardar_visita` | escribe la visita y la competencia relevada; el vendedor confirma antes |
| `notion_actualizar_cliente` | corrige particularidades, condición de pago, horario, teléfono, email, dirección o zona; el vendedor confirma antes |

Mientras el agente trabaja, el chat muestra qué está haciendo ("revisando el
reporte de…", "escribiendo en Notion…") y la respuesta se va escribiendo sola.
Hay un botón **Parar** por si se cuelga.

### Lo que el agente sabe de entrada

El prompt lleva la fecha, quién es el vendedor y cuántos clientes tiene, el
cliente abierto, las reglas de negocio (plazos de inactividad por canal,
umbrales de concentración, caída de trimestre, ratio jabalinas/tomacables,
pliegos en distribuidoras), el catálogo de competidores y **qué datos tiene que
traer cada visita, leído de Notion**. La instrucción es explícita: no es un
cuestionario, no repreguntar lo ya dicho, una o dos preguntas por mensaje, y
ningún número de memoria — todo sale de `reporte_ventas`.

### Botones sin guion

El agente puede terminar un mensaje con un renglón `OPCIONES: a | b | c`.
La página lo saca del texto y lo convierte en botones. Para preguntas abiertas
no lo usa.

### Nada se escribe sin que el vendedor lo vea

Las dos herramientas que modifican Notion muestran primero una tarjeta con
exactamente lo que va a pasar — en la actualización de ficha, el valor de antes
y el de después — y esperan el toque del vendedor. Si en vez de tocar escribe
una corrección, esa corrección vuelve al agente.

Los valores de lista se validan contra las opciones reales de Notion antes de
escribir. Si el agente manda "Vendí un montón" como Resultado, la herramienta le
contesta cuáles son las cinco opciones válidas y reintenta: una opción inventada
tumbaría el alta entera.

## El resto de la arquitectura

| Pieza | De dónde sale |
|---|---|
| Ficha del cliente (números, variaciones, ranking, días sin comprar) | la arma el código con los datos del reporte comercial — por regla, Notion no guarda facturación |
| Cuestionario y catálogo de competidores | Notion en vivo, con copia local de respaldo |
| Conversación y razonamiento | Claude, vía la capacidad `sample` del artifact — sin API key |
| Consultas al reporte | `ventas.json`, el detalle de facturación línea por línea |
| Visita relevada | Notion (*Visitas relevadas* y *Competencia en el punto de venta*) + copia en el store del artifact |

Atajos que no pasan por el agente: `ficha` · `reporte` · `otro cliente` ·
`mis visitas` · `quién soy` · `ayuda`.

## Modo sin agente

Si el teléfono no puede correr `sample` con herramientas, la página lo dice y
cae al relevamiento pregunta por pregunta con botonera, usando el mismo
cuestionario de Notion y la misma escritura validada. Es peor, pero la calle no
queda a pie.

## Cliente de prueba

`ZZ PRUEBA — ELECTRICIDAD EL ENSAYO` es una distribuidora de materiales y
existe en la base de Clientes de Notion (con dos contactos ficticios), en
`fichas.json` y en `ventas.json` con 19 comprobantes sintéticos. Sus números
están puestos para que disparen todos los tipos de desafío a la vez: góndola
perdida (pararrayos, $1,8M el año anterior y nada este año), marca de riesgo en
Mirol, caída de trimestre (−26%), días sin comprar (73, siendo Distribuidor) y
gap de tomacables (240 jabalinas contra 95).

Todo lo que se releve contra él sale marcado `[PRUEBA]` en el título de la
visita y en Observaciones, así se borra en bloque sin tocar un dato real.

## Armar y publicar

```sh
python3 banco-prueba/construir-ventas.py <ruta a data.json>   # sólo si cambió el reporte
node banco-prueba/armar.js
```

Después se publica `banco-prueba/asistente-visitas.html` como artifact con:

```json
{ "sample": {}, "db": {},
  "mcp": { "servers": [{ "server": "Notion",
    "tools": ["notion-query-data-sources","notion-create-pages","notion-fetch","notion-update-page"] }] } }
```

## Límites conocidos

- **El audio no se graba en la página.** El frame del artifact rechaza la API
  de micrófono, y `sample` sólo acepta texto e imágenes, no audio. El dictado
  va por el micrófono del teclado del teléfono. En WhatsApp sí va a andar,
  porque Meta entrega el audio al servidor y la transcripción ocurre ahí.
- **Cada turno con herramientas son varias idas y vueltas.** Un turno que usa
  dos herramientas son tres pedidos, y puede tardar entre 30 y 90 segundos. Por
  eso la página muestra la actividad y deja cortar.
- Declarar `mcp` impide compartir la página por link público: cada vendedor
  tiene que abrirla con su cuenta y tener el conector de Notion conectado.
- Para que la copia local de la visita se guarde, el vendedor necesita nivel
  Contributor sobre el artifact.

## Argumentos de Notion verificados contra el workspace

- `notion-query-data-sources` → `{ data: { mode:"rows", data_source_url, limit, filter } }`;
  devuelve `{results:[…]}` y las opciones de lista vienen separadas por `<br>`.
- `notion-create-pages` → `{ parent:{ data_source_id: <uuid pelado> }, pages:[{properties}] }`.
- `notion-update-page` → `{ page_id: <uuid con guiones>, command:"update_properties", properties }`.
  Ni la URL de la página ni omitir `command` funcionan.

## Archivos

- `plantilla.html` — cáscara de la página (estilos, barra, hilo, compositor).
- `codigo.js` — reglas, ficha, motor del reporte, herramientas, agente y modo sin agente.
- `fichas.json` — 319 clientes A/B/C del reporte comercial + el de prueba.
- `ventas.json` — 35.609 líneas de facturación de esos clientes (2022-01 a 2026-09).
- `construir-ventas.py` — regenera `ventas.json` y recalcula la ficha del
  cliente de prueba desde sus propias filas.
- `armar.js` — ensambla todo en el HTML que se publica.

## Regenerar los datos

`data.json` es el export del artifact *Ventas FACBSA* (42.039 líneas de
factura). Las ventanas que usa — 12 meses = los últimos 12 del reporte,
trimestre = los últimos 3 contra los 3 anteriores — están verificadas: al
recalcularlas reproducen exactamente el `f12`, `ops`, `ult` y las variaciones
de las fichas de EDESUR y DISCUALCO.
