# Reglas de negocio

Registro de las decisiones comerciales que gobiernan el sistema. **Esta es la
fuente de verdad**: si el código y este documento no coinciden, el que está mal
es el código.

Definidas por Comercial el 7 de septiembre de 2026. Cada regla dice dónde se
toca en el código, así que cambiar un criterio es editar un valor, no rehacer
nada.

---

## 1. Segmentación de clientes

**Por percentiles de la cartera, no por umbrales en pesos.**

| Banda | Definición | Modelo de atención |
|---|---|---|
| A | Las cuentas que acumulan el primer **50%** de la facturación | CLAVE. Contrato marco anual. |
| B | Hasta el **80%** | ESTRATÉGICO. Visita regular, upgrading hacia A, cross-selling activo. |
| C | Hasta el **95%** | DESARROLLO. Cross-selling y frecuencia. |
| D | La cola | REVISAR RENTABILIDAD. Pedido mínimo o canal mayorista. |

Las cuentas se ordenan de mayor a menor y se recorre el acumulado. La cuenta que
*cruza* un corte queda dentro de esa banda: con una sola cuenta activa, esa
cuenta es A. Una cuenta sin compras en el período cae en D.

**Por qué así.** Con la inflación argentina, una banda fija en pesos deja de
significar nada en pocos meses: un cliente sube de segmento sin haber vendido una
unidad más, y la dirección lee crecimiento donde no lo hubo. El corte por
percentiles se autoajusta y es el mismo Pareto que ya se usa para leer la
cartera, así que el segmento y el análisis hablan el mismo idioma.

**Contra.** Una cuenta puede cambiar de banda porque otra creció, no por mérito
propio. Al comparar dos períodos hay que mirar la facturación además del segmento.

`src/negocio/reglas.js` → `CORTES_PARETO`, `asignarSegmentos()`

---

## 2. Alertas sobre la cuenta

| Situación | Umbral | Nivel |
|---|---|---|
| Caída trimestral en segmento **A o B** | más de **15%** | CRÍTICO |
| Una cuenta concentra parte del total de FACBSA | **10%** alerta · **20%** crítico | ALERTA / CRÍTICO |
| **Deuda vencida** | cualquier importe mayor a cero | CRÍTICO |

La alerta de caída alcanza al segmento B además de A: en B es donde todavía se
puede revertir con una visita; cuando cae una cuenta A, muchas veces ya es tarde.

`src/negocio/reglas.js` → `CAIDA_CHURN`, `SEGMENTOS_CON_ALERTA_CHURN`,
`CONCENTRACION_ALERTA`, `CONCENTRACION_CRITICA`

---

## 3. Inactividad, por canal

El ciclo de compra no se parece entre canales, así que el plazo tampoco.

| Canal | Dormido | Prácticamente perdido |
|---|---|---|
| EMPRESA ENERGIA | 120 días | 240 días |
| DISTRIBUIDOR | 60 días | 120 días |
| CONSTRUCTORA | 180 días | 365 días |
| Cualquier otro, o sin canal cargado | 90 días | 180 días |

Una distribuidora eléctrica compra por licitación con ciclos largos; un
distribuidor debería reponer seguido y 60 días ya es señal; una constructora
compra por obra y puede estar medio año sin comprar sin que signifique nada.

`src/negocio/reglas.js` → `INACTIVIDAD_POR_CANAL`, `plazosInactividad()`

---

## 4. Cross-selling: el gap de tomacables

```
ratio_objetivo = 1 tomacable cada 1,5 jabalinas   (66,7%)
gap_unidades   = max(0, jabalinas / 1,5 − tomacables)
gap_pesos      = gap_unidades × precio promedio del tomacable en el período
```

- Se excluyen los clientes con **menos de 20 jabalinas**: con ese volumen el
  ratio es ruido y ensucia la priorización.
- **Gap invertido**: un cliente con ratio **arriba del 100%** compra más
  tomacables que jabalinas, así que probablemente las jabalinas se las compra a
  otro. Vale la misma lógica comercial al revés.
- Los tomacables se asocian a **jabalinas**, no a metros de cable. Es la
  corrección más importante del modelo.
- Es una **estimación comercial**, no una demanda insatisfecha comprobada. Tanto
  la ficha como el agente se lo aclaran al vendedor.

`src/negocio/reglas.js` → `RATIO_TOMACABLES_OBJETIVO`,
`MINIMO_JABALINAS_PARA_GAP`, `RATIO_GAP_INVERTIDO`

---

## 5. Competencia en el punto de venta

Se releva **por competidor y por familia de producto**. De cada uno, cuatro
datos:

| Dato | Escala |
|---|---|
| En qué nos compite | Familia de producto de FACBSA |
| Cuánto se lleva | Todo · La mayor parte · Mitad y mitad · Una parte chica · Casi nada |
| A qué precio | Mucho más barato · Algo más barato · Parecido · Algo más caro · No lo sabe |
| Por qué le compran a él | Precio · Entrega o stock · Plazo de pago · Costumbre o relación · Lo pide el pliego · No nos conocían |

**Tramos cerrados, no porcentajes.** El vendedor toca un botón: es rápido en la
calle y comparable entre cuentas. El vendedor rara vez sabe el porcentaje exacto,
y un tramo honesto vale más que un número inventado.

**El motivo es la parte que más rinde**, porque cada uno se corrige en un área
distinta: *entrega* es un problema de Producción, *costumbre* es frecuencia de
visita, *pliego* es una homologación pendiente.

Un competidor que no está en el catálogo no se fuerza dentro de otro: se guarda
con el nombre que dijo el vendedor y el reporte lo lista aparte.

`src/negocio/competencia.js`

---

## 6. Relevamiento de la visita

- **Máximo 4 preguntas especiales** por visita, ordenadas por criticidad. Más que
  eso y el vendedor las contesta de compromiso.
- Las preguntas especiales **no se pueden saltear**: son las que pidió la oficina
  para ese cliente. Si no las pudo averiguar, se registra eso mismo como respuesta.
- Los puntos de competencia son **condicionales**: si el vendedor dice que no le
  compran a nadie más, los cuatro siguientes no aplican y la visita se cierra igual.
- El **compromiso de la visita anterior** se muestra en la ficha como dato, sin
  ocupar uno de los cuatro lugares de preguntas especiales.

`src/chat/cuestionario.js`, `src/negocio/preguntas-especiales.js`

---

## 7. Operación

**Quién la usa.** Sólo **Venta Directa**: FACBSA, FACSA, N.ANTONUCCI y
SERGIO ELLERO. Los representantes externos no usan la herramienta, porque la
ficha expone facturación, ranking y peso de la cuenta sobre el total de FACBSA.
El alta de un vendedor cuyo agente no pertenece al grupo se rechaza.

**Actualización de la base.** Import **semanal** del Excel de ventas. Los
segmentos, los gaps y los días de inactividad se recalculan en cada import.

**Visitas que quedan abiertas.** Recordatorio a las **3 horas**; cierre
automático como INCOMPLETA a las **12 horas**, con lo que el vendedor alcanzó a
cargar. Nada de lo relevado se pierde y el panel las muestra aparte.

**Audios.** La **transcripción se guarda siempre**, para poder auditar qué dijo
el vendedor y qué entendió el sistema. **El audio no se descarga**: WhatsApp lo
borra solo a los pocos días.

`src/db/queries.js` → `altaVendedor()`, `src/chat/mantenimiento.js`

---

## Lo que falta definir

Estas son las únicas piezas que todavía tienen valores puestos por defecto.
Hasta que Comercial las confirme, el sistema funciona pero con supuestos.

### a) Catálogo de competidores — **el más importante**

La lista actual es una suposición. Hace falta, de cada competidor real: **cómo se
llama**, **cómo lo nombran los vendedores y los clientes** (para reconocerlo en
un audio) y **en qué familias nos compite**.

Puestos por defecto hoy: GENROD, SICAME, INTELLI, CIRPROTEC, ERICO / NVENT e
"importado sin marca".

### b) Familias de producto

Confirmar que la lista está completa y que los nombres coinciden con los que
salen del sistema: cable IRAM 2467, jabalinas lisas, tomacables, pararrayos,
soldadura exotérmica, conectores a compresión, conectores por perforación y
VARIOS (Conjuntos). ¿La línea importada de Intelli ya se vende?

### c) Columnas de cuenta corriente

¿El reporte que se exporta trae **deuda vencida** y **condición de pago**? ¿Con
qué encabezado exacto? Si vienen en un segundo archivo, hace falta saber cómo se
cruza con el de ventas. Sin esas columnas, el sistema no muestra nada de
cobranza, que es preferible a inventarlo.

### d) Motivos de compra a la competencia

¿Los seis motivos cubren los casos reales, o falta alguno que en FACBSA se repite?

### e) Puntos del relevamiento

Los doce puntos actuales: contacto, resultado de la visita, stock de FACBSA,
competencia (quién / en qué / cuánto / precio / por qué), precio percibido,
exhibición, foto, próximo paso y observaciones. ¿Falta alguno? ¿Sobra alguno?

### f) Canales

Están definidos EMPRESA ENERGIA, DISTRIBUIDOR y CONSTRUCTORA. Si hay más canales
en el sistema, cada uno necesita su plazo de inactividad; mientras tanto usan el
plazo por defecto (90/180).

### g) Modelo de atención por banda

Los textos de la tabla de segmentación venían atados a las bandas en pesos.
Ahora que el corte es por percentiles, conviene revisar que sigan describiendo lo
que Comercial espera de cada banda.
