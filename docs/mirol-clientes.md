# El maestro de clientes de Mirol

Análisis del export `CLIENTES.xls` de Mirol (exportado el 14-9-2026 por `MirolADM`).
Define qué campo del sistema alimenta cada campo de la ficha del cliente, qué
va a Notion y qué no.

**3.471 clientes · 117 columnas.** De esas 117, **38 tienen contenido real**;
las otras 79 están vacías, son constantes o no se usan.

## El resumen en una línea

Mirol es el maestro y sigue siéndolo. A Notion no van los 3.471 clientes: va
la capa cualitativa de las cuentas que alguien va a leer. Al asistente sí le
entra el archivo completo, porque el vendedor tiene que poder buscar cualquier
cliente desde el WhatsApp.

## Qué usamos de cada columna

### Identidad
| Mirol | Lleno | A dónde va | Nota |
| --- | --- | --- | --- |
| `CliNum` | 100% | `clientes.codigo` | La llave. Es por acá que se cruza con el reporte de ventas. |
| `CliNom` | 99,9% | `clientes.nombre` | 3.445 nombres distintos sobre 3.471 filas. |
| `CliNomFan` | 2,8% | — | **No se usa como nombre de fantasía.** Tiene `CERRO`, `NO VENDER`, `CAMBIO X 1729`: son marcas de baja y de fusión de duplicados metidas en el campo equivocado. |
| `CliCuit` | 99,9% | `clientes.cuit` | 123 son placeholder (`00-00000000-0`, `55-...`). Hay que descartarlos, no cargarlos. |
| `CliFec` | 99% | `clientes.cliente_desde` | Rango 1902 → 2026. Las anteriores a la fundación son basura de migración. |
| `TipCliCod` | 100% | **a definir** | 22 códigos. Es el candidato a `actividad`, pero falta la tabla. |
| `IVACod` | 100% | — | `IN` 3.342, el resto marginal. No discrimina nada útil. |

### Dónde se lo visita
| Mirol | Lleno | A dónde va | Nota |
| --- | --- | --- | --- |
| `CliDir` | 99,7% | `clientes.direccion` | |
| `CliLoc` | 99,5% | `clientes.localidad` | **636 valores distintos, y hay 15 formas de escribir Capital Federal** (`CAP.FED.` 332, `CAPITAL FEDERAL` 236, `CAP.FEDERAL` 190, `CAPITAL` 100, hasta `CAP.FERERAL`). Hay que normalizar antes de cargar o no se puede agrupar por nada. |
| `PciaCod` | 99,3% | `clientes.provincia` | Código de una letra (B, C, S, X…). Se traduce a nombre. |
| `CliCP` | 98,7% | — | |
| `CliZona` | 98,3% | — | **Coincide con `PciaCod` en 3.383 de 3.471 casos (97,5%).** No es una zona comercial: es la provincia otra vez. |
| `CliLugEnt` | 90,6% | `clientes.particularidades` | Texto libre: "RETIRAN SAN FERNANDO", "A CONVENIR". |

### Cómo se lo contacta
| Mirol | Lleno | A dónde va | Nota |
| --- | --- | --- | --- |
| `CliTel1` | 75% | `clientes.telefono` | |
| `CliTel2/3`, `CliFax`, `CliCel1-3` | 19% / 5% / 4% / <1% | — | El celular prácticamente no se carga. |
| `CliEmail` | 28,6% | `clientes.email` | |
| `CliCon1` | 54,4% | `cliente_contactos` | Un nombre suelto, sin cargo ni rol. 50 traen el teléfono embebido en el texto ("MARIO (CEL.1549942925)"). Sirve de semilla, no más. |
| `CliCon2` / `CliCon3` | 2,5% / 0,5% | `cliente_contactos` | |
| `CliURL` | 0,7% | — | 24 valores, y varios son mails, no webs. |

### Comercial
| Mirol | Lleno | A dónde va | Nota |
| --- | --- | --- | --- |
| `AgeNum` | 99% | `clientes` → vendedor | 15 códigos. El 19 tiene 1.443 clientes y el 11 otros 1.014: entre los dos, el 71% de la cartera. Falta la tabla de nombres. |
| `ConPagCod` | 56,3% | `clientes.condicion_pago` | 50 códigos sin tabla. |
| `CliCodBon` | 56,5% | **no se replica** | Bonificación base (30, 32, 20, 28…). Es precio: vive en Mirol. |
| `CliNLis` | 98,7% | — | 3.421 de 3.471 en la lista 3. En los hechos hay una sola lista. |
| `CliNot` | 67,5% | — | **No son notas: es el transporte.** `-CAMION` 742 veces, y después nombres de expresos (LA SEVILLANITA, CRUZ DEL SUR, EL IMPALA, INTERPROVINCIAL). |
| `CliObser` | 22,8% | ver abajo | Mezcla tres cosas distintas en un solo campo. |

### `CliObser`: tres campos metidos en uno
De los 790 clientes con observación:

1. **Riesgo crediticio — 217 clientes.** `NO VENDER` (27), `CERRO` (83), `INCOBRABLE` (21), `FC PEND.>60` (59). Esto **no es una particularidad, es una alerta operativa**: cambia, y si queda escrita a mano en una ficha envejece sin que nadie se entere.
2. **Descuentos.** `30+5`, `32+5`, `32+5+3`, `28+5`, `30+2+5`. Es la regla de descuentos en cascada ya registrada en Notion, escrita a mano acá.
3. **Condición de pago.** `PAGO ANTICIPADO`, `FACTURAR DOLAR DIVISA`.

Lo único que es realmente `particularidades` es lo que queda después de separar esas tres.

## Lo que NO se carga

- **Datos personales:** `CliTDoc`, `CliNDoc`, `CliFecNac`, `CliEstCiv` (63% lleno), `CliSexo` (63%). No tienen uso comercial y no van a la base de conocimiento.
- **79 columnas vacías o constantes.** Entre ellas, dos que duelen porque son justo lo que buscábamos:
  - `RamCod` (ramo) y `CatCliCod` (categoría): **vacías**. La actividad del cliente no está cargada en el sistema.
  - `CliDSaldo`, `CliDUltFec`, `CliDCantFC`, `CliSemafCl/De/Ct`: **vacías**. La deuda vencida no viene en este export; hace falta otro de cuenta corriente.
  - `CliGeoLoc`, `CliCanEmp`, `CliCanSuc`: vacías.
- **`CliMail3Co`** está 98,9% lleno pero con valores tipo `B  0.00`, `B  2.50`: el contenido no coincide con el nombre de la columna.

## Calidad de datos: lo que este archivo deja ver

- **`CliBaja` = S en 8 clientes de 3.471.** El maestro nunca se depura. El estado real de un cliente no se puede leer de acá: hay que derivarlo de la última compra, que es exactamente lo que hace la regla de inactividad por canal.
- Las bajas reales están escritas como texto en `CliObser` y `CliNomFan` (`CERRO`, `NO VENDER`).
- La localidad no es agrupable sin normalizar.
- La zona comercial no existe como dato.

---

# Lo que respondió Comercial (1-10-2026)

| Pregunta | Respuesta |
| --- | --- |
| `TipCliCod` | **Es la actividad del cliente.** Falta la tabla de códigos. |
| `AgeNum` | Sin tabla. Se deduce del territorio (abajo) y se confirmará cruzando con el reporte de ventas. |
| `ConPagCod` | Sin tabla. **No se usa**: la condición de pago se toma del texto de `CliObser`. |
| `CliObser` | **Son las observaciones que va poniendo el vendedor.** |
| Deuda vencida | Está en otro lado. **Fuera de alcance por ahora.** |

## `TipCliCod`: 5 de 22 códigos deducidos

La tabla está en Mirol y todavía no la tenemos. Estos cinco salen del patrón de
nombres de los clientes de cada grupo y **están a confirmar**:

| Código | Clientes | Actividad propuesta | En qué me basé |
| --- | --- | --- | --- |
| 60 | 390 | Distribuidor eléctrico | Casas de materiales eléctricos |
| 62 | 106 | Contratista electromecánico | Pfisterer, Elecnor, empresas de ingeniería |
| 61 | 21 | Distribuidora eléctrica | Edesur, Edenor, Edelap, EPE Santa Fe |
| 64 | 16 | Industria | Industrias y plantas |
| 63 | 5 | Cooperativa eléctrica | Cooperativas eléctricas |

Los 60–64 forman una familia coherente. Los códigos 1 a 10 concentran **2.748
clientes (79%)** y no se pueden leer desde los nombres: ahí hay de todo.

**Con esa tabla de Mirol, el 100% de la cartera queda clasificada por actividad
de una sola vez.** Es la pieza que más rinde por lo poco que cuesta.

## `AgeNum`: el territorio sí se lee

Aunque no tengamos los nombres, el cruce con la provincia los identifica solo:

| Código | Clientes | Dónde está |
| --- | --- | --- |
| 19 | 1.443 | Todo el país, disperso — parece el mostrador / venta directa |
| 11 | 1.014 | CABA (562) y Buenos Aires (446), nada más |
| 12 | 326 | Buenos Aires (317) |
| 44 | 125 | NOA: Tucumán, Salta, Santiago, Jujuy, Catamarca |
| 70 | 110 | Litoral: Santa Fe (100), Entre Ríos (10) |

Los nombres salen del reporte de ventas, cruzando por código de cliente.

# El importador

`npm run importar-clientes -- CLIENTES.xlsx`

Mirol exporta **.xls** (Excel 97, binario). Hay que abrirlo y **guardarlo como
.xlsx o .csv**: el lector del proyecto no abre ese formato.

Corrido sobre el archivo real del 14-9-2026:

```
leídos 3.471 · cargados 3.467 · contactos semilla 1.994
CUIT descartado por ser relleno: 119
provincias traducidas: 3.379
con observación del vendedor: 3.165
con marca de riesgo: 236  (CERRÓ 83 · NO VENDER 67 · FACTURA PENDIENTE 62 · INCOBRABLE 24)
con actividad: 538     sin actividad: 2.929  ← falta la tabla de TipCliCod
```

Las 15 formas de escribir Capital Federal quedaron en una: **CABA, 901 clientes.**

## Qué hace con cada cosa

- **Localidad:** normaliza y unifica. De 636 variantes a 591 localidades reales.
- **Provincia:** traduce el código de una letra de AFIP (`B` → Buenos Aires).
- **CUIT:** descarta los de relleno (`00-…`, `55-…`).
- **Fecha de alta:** descarta lo anterior a 1950, que es basura de migración.
- **`CliObser`:** lo separa en tres. La marca de riesgo va al campo `marcas`, el
  descuento en cascada se descarta (el precio vive en Mirol) y lo que queda es
  la particularidad de verdad.
- **`CliCon1-3`:** los carga como contactos en estado **A confirmar**, extrayendo
  el teléfono cuando viene metido adentro del nombre.

## Las dos reglas que lo hacen reimportable

1. **`particularidades` no se pisa** si ya tiene algo. El vendedor la edita desde
   el WhatsApp y esa versión es más fresca que la del maestro.
2. **Un contacto no se duplica** ni se pisa si ya tiene cargo o rol puesto desde
   el chat: esa versión sabe más que Mirol, donde sólo hay un nombre suelto.

## Las marcas del vendedor

`NO VENDER`, `CERRÓ`, `INCOBRABLE`, `FACTURA PENDIENTE` son notas de una
persona, no un estado que el sistema haya verificado. La ficha las muestra
diciendo exactamente eso:

> 🟠 Anotado en el sistema: NO VENDER. Verificalo antes de tomar pedido.

Es la diferencia entre avisarle al vendedor y mentirle: nadie sabe de cuándo es
esa nota ni si el cliente se regularizó.
