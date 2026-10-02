# Banco de prueba del asistente de visitas

Ambiente para probar el asistente de la fuerza de ventas **en la calle, sin
WhatsApp**. Es un hilo de chat único, como el de WhatsApp: el vendedor dice a
quién va a visitar, el asistente le devuelve la ficha y los desafíos a resolver
adentro, y al salir el vendedor le cuenta cómo le fue — escribiendo o dictando.

La arquitectura es la misma que va a tener el servidor real:

| Pieza | De dónde sale |
|---|---|
| Ficha del cliente (números, variaciones, ranking, días sin comprar) | la arma el código con los datos del reporte comercial — por regla, Notion no guarda facturación |
| Cuestionario y catálogo de competidores | Notion en vivo (*Preguntas del relevamiento*, *Competidores*), con copia local de respaldo |
| Conversación (interpretar lo que dicta el vendedor) | Claude, vía la capacidad `sample` del artifact — sin API key |
| Visita relevada | se escribe en Notion (*Visitas relevadas* y *Competencia en el punto de venta*) y queda una copia en el store del artifact |

## El hilo

1. El asistente saluda y pregunta quién es el vendedor (chips o texto libre).
2. `¿A quién vas a visitar?` — el vendedor escribe una parte del nombre.
   La búsqueda limpia el relleno ("voy a visitar a…") y va por capas: nombre
   exacto, empieza con, contiene, todas las palabras, alguna palabra, localidad
   o CUIT. Si hay varios, ofrece hasta cinco para desambiguar.
3. Manda la **ficha** y, aparte, **lo que hay que resolver adentro** (las
   preguntas especiales que disparan las reglas de negocio).
4. Al salir, el vendedor cuenta todo junto. El agente extrae lo que puede y el
   asistente pregunta sólo lo que falta, con botonera para las listas cerradas.
5. Cierra, resume y escribe en Notion.

Atajos en cualquier momento: `ficha` · `desafíos` · `otro cliente` ·
`mis visitas` · `cerrar` · `cancelar` · `ayuda`.

## Cliente de prueba

`ZZ PRUEBA — ELECTRICIDAD EL ENSAYO` existe en la base de Clientes de Notion
(con dos contactos ficticios) y en `fichas.json` con el flag `prueba`. Sus
números están puestos para que disparen los cuatro tipos de desafío: caída de
trimestre, días sin comprar, gap de tomacables y marca de riesgo en Mirol.

Todo lo que se releve contra él sale marcado `[PRUEBA]` en el título de la
visita y en Observaciones, así se borra en bloque sin tocar un solo dato real.

## Armar y publicar

```sh
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
  va por el micrófono del teclado del teléfono: el vendedor habla y entra como
  texto. En WhatsApp sí va a poder mandar el audio, porque Meta se lo entrega
  al servidor y la transcripción ocurre ahí.
- Declarar `mcp` impide compartir la página por link público: cada vendedor
  tiene que abrirla con su cuenta y tener el conector de Notion conectado.
- Para que la copia local de la visita se guarde, el vendedor necesita nivel
  Contributor sobre el artifact.
- Si `sample` o `mcp` no responden, el relevamiento sigue funcionando pregunta
  por pregunta y queda guardado localmente.

## Archivos

- `plantilla.html` — cáscara de la página (estilos, barra, hilo, compositor).
- `codigo.js` — reglas, ficha, desafíos, conversación, validación y carga.
- `fichas.json` — 319 clientes A/B/C del reporte comercial + el de prueba.
- `armar.js` — ensambla los tres en el HTML que se publica.
