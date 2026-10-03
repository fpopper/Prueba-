# Prompt para rehacer el asistente de visitas con el MCP de Mapplics

> Copiá todo lo que sigue a partir de la línea `===` y pegalo como primer mensaje
> de un chat nuevo que tenga conectados **Mapplics**, **Notion** y **GitHub**.
> Adjuntá en ese mismo mensaje `data.json` y `CLIENTES.xls`.
>
> Está escrito a propósito **sin las respuestas**: no lleva los IDs de Notion, ni
> los argumentos de cada herramienta, ni los números del negocio. Le dice dónde
> buscar cada cosa. Si se las diera, no estaría desarrollando: estaría copiando, y
> la comparación contra la versión de referencia no mediría nada.

---

===

Respondé siempre en español rioplatense.

Sos el equipo de desarrollo de FACBSA (Fábrica Argentina de Conductores
Bimetálicos), que fabrica conductores bimetálicos para instalaciones de puesta a
tierra: jabalinas IRAM 2309, tomacables, cable IRAM 2467, conectores, pararrayos,
soldadura exotérmica, conjuntos. Es la empresa líder del rubro, con 75 años,
estructura muy envejecida y procesos manuales.

Quiero que construyas un **asistente de visitas para la fuerza de ventas** y que
lo dejes publicado y listo para probar **en la calle, desde el celular**.

Ya existe una versión construida en otro chat. La vas a tener a mano como vara de
comparación, pero **quiero que la rehagas vos**, incorporando el **MCP de
Mapplics**.

**No te voy a dar los datos masticados.** Ni los identificadores de las bases, ni
los nombres de las propiedades, ni los argumentos de las herramientas, ni los
números del negocio. Todo eso existe y es consultable: tu trabajo es ir a
buscarlo, verificarlo y decirme qué encontraste. Si algo no lo podés averiguar,
preguntame — pero preguntame después de haber buscado, no antes.

---

## 1. Lo primero: andá a ver con qué contás

Antes de diseñar nada, levantá el terreno. Quiero que al final de este paso me
cuentes en pocas líneas qué encontraste en cada lado.

**a) El MCP de Mapplics.** Listá sus herramientas, leé sus esquemas y hacé **una
llamada real de sólo lectura** a cada familia para ver qué devuelve de verdad. No
diseñes contra lo que suponés que hace.

**b) Notion.** Buscá en el workspace el espacio del asistente de la fuerza de
ventas. Vas a encontrar varias bases: clientes, contactos, competidores, el
cuestionario del relevamiento, las visitas, la competencia relevada en el punto
de venta, los vendedores habilitados y las reglas de negocio de la empresa.
Leé el esquema de cada una — las descripciones de las propiedades explican el
criterio, no sólo el tipo — y **leé las reglas de negocio vigentes**: ahí está
cómo se segmenta un cliente, a partir de cuántos días se lo considera dormido o
perdido, y el alcance que decidimos para este asistente.

**c) El repositorio.** `fpopper/Prueba-`, branch
`claude/whatsapp-sales-survey-chat-3efyln`, carpeta `banco-prueba/`. Es la versión
de referencia, con su `README.md`. Miralo para entender a qué apuntamos y qué ya
sabemos que no funciona — **no para copiarlo**.

**d) Los archivos que te adjunto.**
- `data.json`: el export del análisis de ventas, con las líneas de factura de los
  últimos años. Abrilo y deducí su estructura; está comprimido en índices.
- `CLIENTES.xls`: el maestro de clientes del ERP (Mirol). Es un `.xls` viejo;
  si tu herramienta habitual no lo abre, buscá otra. Tiene más de cien columnas,
  la mayoría vacías o inútiles: decidime cuáles sirven y cuáles no.

Después de levantar todo eso, decime **dónde enchufás Mapplics**. Se suma a lo que
ya hay: Notion y el reporte de ventas siguen cumpliendo su rol, no los reemplaza.
Si algo de Mapplics mejora o pisa una pieza existente, proponémelo y esperá mi
visto bueno. **Si no encontrás un uso honesto para Mapplics acá, decímelo derecho
en vez de forzarlo**: preferir no usarlo es una respuesta válida.

---

## 2. Qué tiene que ser el asistente

Un **hilo único de chat, como WhatsApp**, en el celular del vendedor, conducido
por un agente de IA que razona sobre la situación de la cuenta. **No un
formulario con voz**: eso ya se probó y la conversación sale pobre.

El flujo real:

1. El vendedor dice quién es.
2. Dice a quién va a visitar, hablando natural: *"voy a ver a los de Full
   Electric"*. El agente resuelve el cliente; si hay varios parecidos, pregunta.
3. El agente le devuelve **la ficha** del cliente y, aparte, **qué tiene que
   resolver adentro**: los puntos que disparan las reglas de negocio, cada uno
   con el motivo por el que aparecen.
4. Antes, durante o después, el vendedor le pregunta lo que quiera sobre esa
   cuenta — *"¿cuántas jabalinas lleva este año?"*, *"¿cuándo fue el último
   pedido?"*, *"¿alguna vez me compró cable?"*, *"¿con quién conviene hablar?"*,
   *"¿qué pasó la visita anterior?"* — y el agente va a buscarlo al reporte de
   ventas o a Notion. **Ningún número de memoria.**
5. Al salir, el vendedor cuenta cómo le fue, en una sola parrafada si quiere. El
   agente saca lo que puede y pregunta sólo lo que falta, de a una o dos cosas.
6. El agente deja la visita asentada. El vendedor confirma antes.
7. Si el vendedor avisa que cambió un dato de la ficha (horario, teléfono, quién
   decide, una condición de pago), el agente lo corrige, también con confirmación.

### A quién atiende

Este asistente atiende **exclusivamente a distribuidoras de materiales
eléctricos**: el mayorista con mostrador y depósito que le revende al
electricista, al instalador y a la obra chica. No atiende constructoras,
distribuidoras de energía, fabricantes ni industria.

El alcance está registrado como regla en Notion: buscala y leela, dice qué
consecuencias tiene sobre las reglas que aplica el asistente. Después andá a los
datos y decime **cuántos clientes son, cuánto facturan y qué parte del total de la
empresa representan**. Si el vendedor nombra un cliente de otro rubro, encontralo
igual pero avisale que está fuera de alcance.

Un mayorista no compra para usar, compra para revender, y eso cambia qué mirar.
Pensalo vos y proponeme cómo se lee una distribuidora: qué señales importan, cuál
es la trampa del número grueso, y a quién hay que hablarle adentro del local.
Quiero tu lectura del canal antes de que escribas el prompt del agente.

---

## 3. Arquitectura

Se publica como **Artifact de claude.ai** con las capacidades `sample`, `db` y
`mcp`. Cargá la skill `artifact-capabilities` y **leé sus definiciones de tipos
completas antes de escribir una línea de código de runtime**: ahí está qué acepta
cada capacidad, qué errores devuelve y qué hace el frame del artifact. Hay
límites del frame que te van a condicionar el diseño — averiguá cuáles son antes
de prometer una función que después no vas a poder cumplir.

Reglas de arquitectura que sí te doy, porque son decisiones nuestras y no las
podés deducir:

- **La facturación no se guarda en Notion.** Es una regla registrada: Notion
  lleva lo cualitativo y las reglas; los números salen del reporte comercial. La
  ficha del cliente la arma el código.
- **El cuestionario del relevamiento y el catálogo de competidores se leen de
  Notion en vivo**, con copia local de respaldo, para que Comercial pueda cambiar
  una pregunta sin tocar código.
- **El agente conduce con herramientas que corren dentro de la página.** Tiene
  que poder: buscar un cliente, abrir su ficha, consultar el reporte de ventas
  filtrando por producto y período, leer Notion, escribir la visita y corregir la
  ficha del cliente. Diseñá vos el conjunto y los esquemas.

Requisitos de la experiencia, no negociables:

- **Streaming**: la respuesta se escribe sola mientras llega, y el chat muestra
  qué está haciendo el agente en cada momento. Un turno con varias herramientas
  puede tardar más de un minuto: si no se ve actividad, el vendedor cree que se
  colgó. Que se pueda cortar.
- **Botones sin guion**: el agente tiene que poder ofrecer respuestas rápidas
  cuando corresponde, sin que estén cableadas en un árbol fijo.
- **Nada se escribe sin que el vendedor lo vea**: antes de tocar Notion, una
  tarjeta con exactamente lo que va a pasar — y en una corrección de ficha, el
  valor de antes y el de después, porque pisa lo que había. Si en vez de
  confirmar escribe una corrección, esa corrección tiene que volver al agente.
- **Validá contra las opciones reales antes de escribir.** Si el agente manda un
  valor que la base no conoce, la herramienta tiene que devolverle las opciones
  válidas para que reintente, en lugar de fallar.
- **Degradación honesta**: si el agente no está disponible, o Notion no está
  conectado, decilo en pantalla con la razón y seguí haciendo lo que se pueda.

---

## 4. Los datos

De los archivos adjuntos tenés que derivar lo que viaja dentro de la página: las
fichas de los clientes con sus indicadores calculados, y el detalle de
facturación que el agente va a consultar. Decidí vos el formato; tené en cuenta
que la página tiene un tope de tamaño y que el parseo ocurre en un celular.

Tres cosas sobre el método:

**Verificá las ventanas de cálculo.** Los indicadores de la ficha (facturación de
12 meses, variaciones, última compra, operaciones) tienen que dar **exactamente**
lo mismo que el análisis comercial del que salió el export. Elegí dos clientes
grandes, recalculalos y comparalos contra lo que ya está publicado en la base de
clientes de Notion. Si no dan, la ventana que elegiste está mal, no los datos.

**La inflación.** El reporte arranca hace varios años y la inflación argentina es
alta: comparar pesos de años distintos engaña. Resolvelo y hacé que el agente lo
aclare cuando corresponda.

**La calidad de los datos.** El maestro de Mirol está sucio: localidades escritas
de quince formas, columnas vacías, observaciones de vendedor mezcladas con marcas
de riesgo. Limpialo con criterio y decime qué decidiste tirar y por qué.

---

## 5. Cliente de prueba

Antes de probar nada contra datos reales, armá un cliente de prueba para no
ensuciar Notion: en la base de clientes, con un nombre inequívoco que lo ordene
último, razón social que diga que es ficticio, y contactos ficticios. También en
los datos que viajan en la página, con comprobantes sintéticos.

Dos cosas importantes:

- **Sus números se calculan desde sus propias filas sintéticas, no se escriben a
  mano.** En la versión de referencia yo me comí ese error y la ficha terminó
  contradiciendo al reporte sobre el único cliente que existe para probar.
- Armalo para que **dispare todas las alertas y todos los puntos a averiguar a la
  vez**. Es el cliente con el que vas a verificar que cada regla se ve.

Todo lo que se releve contra él tiene que quedar marcado como prueba, de forma que
se pueda borrar en bloque sin tocar un solo dato real.

---

## 6. Cómo te quiero ver probar

No me digas que funciona: mostrame que probaste.

1. **Las ventanas de cálculo**, contra los dos clientes que elegiste.
2. **El bucle del agente**, simulado de punta a punta con herramientas encadenadas:
   buscar cliente → abrir ficha → consultar el reporte → leer Notion → intentar
   guardar con un valor inválido (tiene que ser rechazado con las opciones
   válidas) → guardar bien → corregir un dato de la ficha. Mostrame la traza.
3. **El modo degradado**, completo.
4. **Una escritura real en Notion contra el cliente de prueba**, de cada tipo.
   Es la única forma de saber que los nombres de propiedad y las opciones están
   bien: no lo des por hecho porque el código compila.
5. Publicá el artifact y pasame el link.

---

## 7. Cómo quiero que trabajes

- Trabajá en una branch nueva, `claude/asistente-mapplics`, en una carpeta propia.
  **No toques `banco-prueba/`**: lo quiero intacto para comparar.
- **No inventes un número.** Si no lo podés verificar, decí que no lo sabés.
- **Verificá contra la fuente antes de cablear.** Cada vez que vayas a escribir en
  una base o a llamar una herramienta, traé primero una lectura y mirá qué forma
  tiene de verdad. Un nombre de propiedad mal escrito o un argumento con la forma
  equivocada no siempre falla ruidosamente.
- **Si encontrás un error mío o de la versión de referencia, decímelo**, no lo
  copies.
- **Contame los límites en la cara**, con la razón técnica, no con un rodeo. Si
  algo no se puede hacer en este entorno, quiero saberlo cuando lo descubrís, no
  al final.
- Reglas de la base de conocimiento, que valen también para vos: lo nuevo entra
  como "A validar" o "Borrador", nunca directo "Vigente"; no modifiques una ficha
  "Vigente" sin mostrarme la diferencia y preguntarme; llená siempre Origen/Fuente
  y Última revisión; **no cargues datos sensibles** (sueldos, datos de salud o
  personales, credenciales, cuentas bancarias).
- Commiteá con mensajes que expliquen el *por qué*, no el *qué*. Al final, un
  `README.md` con la arquitectura, lo que verificaste contra cada fuente, los
  límites conocidos y cómo regenerar los datos.

Cuando termines, decime **en qué se diferencia de la versión de referencia**: qué
quedó mejor, qué quedó peor, qué aportó concretamente Mapplics, y qué te costó
más averiguar.

===
