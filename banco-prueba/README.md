# Banco de prueba del asistente de visitas

Ambiente para probar el asistente de la fuerza de ventas **en la calle, sin
WhatsApp**, con la misma arquitectura que va a tener el servidor real:

| Pieza | De dónde sale |
|---|---|
| Ficha del cliente (números, variaciones, ranking, días sin comprar) | la arma el código con los datos del reporte comercial — por regla, Notion no guarda facturación |
| Cuestionario y catálogo de competidores | Notion en vivo (*Preguntas del relevamiento*, *Competidores*), con copia local de respaldo |
| Conversación (interpretar lo que dicta el vendedor) | Claude, vía la capacidad `sample` del artifact — sin API key |
| Visita relevada | se escribe en Notion (*Visitas relevadas* y *Competencia en el punto de venta*) y queda una copia en el store del artifact |

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

- Declarar `mcp` impide compartir la página por link público: cada vendedor
  tiene que abrirla con su cuenta y tener el conector de Notion conectado.
- Para que la copia local de la visita se guarde, el vendedor necesita nivel
  Contributor sobre el artifact.
- El dictado va por el micrófono del teclado del teléfono: el frame del
  artifact rechaza la Web Speech API.
- Si `sample` o `mcp` no responden, el relevamiento sigue funcionando
  pregunta por pregunta y queda guardado localmente.

## Archivos

- `plantilla.html` — cáscara de la página (estilos, vistas, compositor).
- `codigo.js` — lógica: ficha, preguntas especiales, chat, validación y carga.
- `fichas.json` — 319 clientes A/B/C con sus 12 meses, derivados del reporte
  comercial y cruzados contra la base de clientes de Notion.
- `armar.js` — ensambla los tres en el HTML que se publica.
