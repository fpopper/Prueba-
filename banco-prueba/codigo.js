"use strict";
/* ---------------------------------------------------------------------------
   Un solo hilo de chat, como el de WhatsApp. El vendedor dice a quien va a
   visitar, el asistente le da la ficha y los desafios, y al salir el vendedor
   le cuenta como le fue — escribiendo o dictando.

   Igual que el asistente real:
   - Numeros de la ficha        -> reporte comercial (Notion no los guarda, por regla)
   - Cuestionario y competidores -> Notion en vivo, con copia local de respaldo
   - La visita relevada          -> se escribe en Notion; copia en el store del artifact
---------------------------------------------------------------------------- */

const DS = {
  clientes:   "collection://15fe220d-098a-833c-a387-8734d2fd64c2",
  preguntas:  "collection://3e4d3d4d-46d3-47f1-8b8f-154ced5f8f6c",
  competidor: "collection://9565aa60-dd06-4d91-be98-74fe18a2f9b1",
  visitas:    "b5db6f27-f801-4d88-aa55-20f865befe82",
  compPdV:    "877214b9-50b3-4057-8b05-96156c4ac261",
};
const NOTION = "Notion";

const CLIENTES = JSON.parse(document.getElementById("datos-clientes").textContent);

/* Copia local del cuestionario. Si Notion contesta, gana Notion. */
const CUESTIONARIO_LOCAL = [
  {id:"contacto",orden:1,texto:"¿Con quién hablaste? Nombre y cargo.",tipo:"texto",obl:true,busca:"nombre y cargo de la persona"},
  {id:"resultado",orden:2,texto:"¿Cómo salió la visita?",tipo:"opciones",obl:true,busca:"resultado de la visita",
   opciones:["Cerré pedido","Cotización pendiente","Solo relevamiento","No me atendieron","Visita fallida"]},
  {id:"stock_facbsa",orden:3,texto:"¿Qué stock nuestro tienen hoy en el punto de venta?",tipo:"opciones",obl:true,busca:"cuánto stock de FACBSA hay",
   opciones:["Bien surtido","Stock justo","Casi sin stock","Sin stock nuestro","No pude verlo"]},
  {id:"competencia_quien",orden:4,texto:"¿A quién más le compran? Nombrá el proveedor. Si nos compran todo a nosotros, escribí NINGUNO.",tipo:"texto",obl:true,busca:"qué otros proveedores le venden"},
  {id:"competencia_familia",orden:5,texto:"¿En qué producto nos compite?",tipo:"opciones",obl:true,omite:true,busca:"en qué familia compite",
   opciones:["Jabalinas","Tomacables","Cable IRAM 2467","Pararrayos","Soldadura exotérm.","Conectores","Conjuntos","En ninguno"]},
  {id:"competencia_participacion",orden:6,texto:"¿Qué parte de ese producto le compran a él?",tipo:"opciones",obl:true,omite:true,busca:"qué porción se lleva la competencia",
   opciones:["Todo se lo compran","La mayor parte","Mitad y mitad","Una parte chica","Casi nada","No aplica"]},
  {id:"competencia_precio",orden:7,texto:"¿Cómo está el precio de él contra el nuestro?",tipo:"opciones",obl:true,omite:true,busca:"brecha de precio",
   opciones:["Mucho más barato","Algo más barato","Parecido al nuestro","Algo más caro","No lo sabe","No aplica"]},
  {id:"competencia_motivo",orden:8,texto:"¿Por qué le compran a él y no a nosotros?",tipo:"opciones",obl:true,omite:true,busca:"motivo por el que compra a la competencia",
   opciones:["Precio","Entrega o stock","Plazo de pago","Costumbre o relación","Lo pide el pliego","No nos conocían","No aplica"]},
  {id:"exhibicion",orden:9,texto:"¿Tienen material nuestro a la vista (cartel, folletería, exhibidor)?",tipo:"opciones",obl:true,busca:"si hay cartelería de FACBSA",
   opciones:["Bien exhibido","Algo pero poco","Nada"]},
  {id:"proximo_paso",orden:10,texto:"¿Cuál es el próximo paso concreto y para cuándo?",tipo:"texto",obl:true,busca:"próximo paso comprometido y su fecha"},
  {id:"observaciones",orden:99,texto:"Última: ¿algo más que la oficina tenga que saber? Si no, escribí NO.",tipo:"texto",obl:false,busca:"cualquier otro dato relevante"},
];
let CUESTIONARIO = CUESTIONARIO_LOCAL.slice();
let COMPETIDORES = ["GenRod","Argenjab","Metal Ce","Metali","Priolo","LCT"];

/* ---------------------------------------------------------------------------
   A QUIEN ATIENDE: solo distribuidoras de materiales electricos — el mayorista
   con mostrador y deposito que le revende al electricista. No constructoras, no
   distribuidoras de energia (EDESUR y companía), no fabricantes, no industria.
   En los datos, Actividad "Distribuidor eléctrico" y Canal "Distribuidor"
   coinciden uno a uno: 203 clientes, el 52% de la facturacion.
--------------------------------------------------------------------------- */
const ACTIVIDAD_FOCO = "Distribuidor eléctrico";
const esDistribuidor = c => c.act === ACTIVIDAD_FOCO || c.can === "Distribuidor";
const CARTERA = CLIENTES.filter(esDistribuidor);

/* --- reglas de negocio (las mismas del asistente) --- */
const PLAZOS = {
  "Distribuidor":{d:60,p:120}, "Distribuidora eléctrica":{d:120,p:240},
  "Venta Directa":{d:120,p:240}, "_obra":{d:180,p:365}, "_defecto":{d:90,p:180},
};
const CAIDA = 0.15, CONC_ALERTA = 0.10, CONC_CRIT = 0.20;
const RATIO_TOM = 2/3, MIN_JAB = 20;

const plazos = c => c.act === "Constructora" ? PLAZOS._obra : (PLAZOS[c.can] || PLAZOS._defecto);
const pesos = n => { n = Number(n)||0;
  if (Math.abs(n) >= 1e6) return "$" + (n/1e6).toFixed(1).replace(".",",") + "M";
  if (Math.abs(n) >= 1e3) return "$" + Math.round(n/1e3) + "k";
  return "$" + Math.round(n); };
const pct = (v,d=0) => v===null||v===undefined ? "-" : (v*100).toFixed(d).replace(".",",")+"%";
const uds = n => Math.round(Number(n)||0).toLocaleString("es-AR");
const fecha = s => { if(!s) return "-"; const [a,m,d]=s.split("-"); return `${d}/${m}/${a}`; };
const flecha = v => v===null ? "" : Math.abs(v)<0.005 ? "▬" : v>0 ? "▲" : "▼";

function gapTomacables(c){
  if (c.jab < MIN_JAB) return 0;
  return Math.max(0, Math.round(c.jab * RATIO_TOM - c.tom));
}
function marcasDe(c){
  const m = /Anotado por el vendedor en Mirol:\s*(.+)$/.exec(c.par || "");
  return m ? m[1].trim() : null;
}
function alertas(c){
  const out = [], pl = plazos(c), gap = gapTomacables(c), marcas = marcasDe(c);
  if (c.part >= CONC_CRIT) out.push({n:"CRITICO",t:`Esta cuenta es el ${pct(c.part,1)} de la facturación total. Perderla sería un golpe estructural.`});
  else if (c.part >= CONC_ALERTA) out.push({n:"ALERTA",t:`Cuenta de alta concentración: ${pct(c.part,1)} del total de la empresa.`});
  if ((c.seg==="A"||c.seg==="B") && c.vTrim!==null && c.vTrim <= -CAIDA)
    out.push({n:"CRITICO",t:`Riesgo de churn: segmento ${c.seg} con caída de ${pct(Math.abs(c.vTrim))} en el último trimestre.`});
  if (c.dias === null) out.push({n:"ALERTA",t:"Sin compras registradas en el período."});
  else if (c.dias >= pl.p) out.push({n:"CRITICO",t:`Sin comprar hace ${c.dias} días. Cuenta prácticamente perdida.`});
  else if (c.dias >= pl.d) out.push({n:"ALERTA",t:`Sin comprar hace ${c.dias} días (para ${c.can||"este canal"} ya es mucho).`});
  if (gap > 0) out.push({n:"OPORTUNIDAD",t:`Gap de tomacables: compra ${uds(c.jab)} jabalinas y sólo ${uds(c.tom)} tomacables. Faltan ${uds(gap)}.`});
  /* Que deje de comprar una familia entera es perder la gondola, aunque el total aguante. */
  (c.perd || []).forEach(([fam, monto]) =>
    out.push({n:"CRITICO", t:`Perdió la góndola de ${fam}: el año pasado nos compró ${pesos(monto)} y este año nada.`}));
  if (c.meses !== undefined && c.meses <= 2 && c.f12 >= 2e6)
    out.push({n:"ALERTA", t:`Repone ${c.meses === 1 ? "una sola vez" : "dos veces"} en el año y compra fuerte: o tiene stock parado o se queda sin.`});
  if (marcas) out.push({n:"CRITICO",t:`Anotado en el sistema: ${marcas}. Verificalo antes de tomar pedido.`});
  return out;
}
const ICONO = {CRITICO:"🔴",ALERTA:"🟠",OPORTUNIDAD:"🟢",INFO:"ℹ️"};

function armarFicha(c){
  const L = [], pl = plazos(c), gap = gapTomacables(c);
  L.push(`**${c.n}**`);
  L.push([c.seg?`Segmento ${c.seg}`:null, c.act, c.can, [c.loc,c.prov].filter(Boolean).join(", ")].filter(Boolean).join(" · "));
  const donde = [c.dir, c.tel].filter(Boolean).join(" · ");
  if (donde) L.push("📍 " + donde);
  if (c.hor) L.push("🕗 " + c.hor);
  L.push("");
  L.push(`💰 Facturación 12m: ${pesos(c.f12)}` + (c.part ? ` (${pct(c.part,1)} del total)` : "") + (c.rank ? ` · #${c.rank} del ranking` : ""));
  if (c.vAnual !== null) L.push(`${flecha(c.vAnual)} vs 12m anteriores: ${pct(c.vAnual)}`);
  if (c.vTrim !== null) L.push(`${flecha(c.vTrim)} último trimestre: ${pct(c.vTrim)}`);
  L.push(c.ult ? `🗓️ Última compra: ${fecha(c.ult)} (hace ${c.dias} días · para ${c.can||"este canal"} el límite es ${pl.d})`
               : "🗓️ Sin compras registradas en el período.");
  if (c.ops) L.push(`🧾 ${c.ops} operaciones · repone ${c.meses !== undefined ? c.meses : "?"} de los últimos 12 meses`);
  if (c.ven) L.push(`👤 Atiende: ${c.ven}`);
  if (c.pag) L.push(`💳 Condición de pago: ${c.pag}`);
  if (c.con && c.con.length){ L.push(""); L.push("*Con quién hablar:*");
    c.con.forEach(p => L.push(`• ${p.nom}${p.car?" — "+p.car:""}${p.rol?" ("+p.rol+")":""}${p.tel?" · "+p.tel:""}`)); }
  if (c.fam && c.fam.length){ L.push(""); L.push("*Qué tiene en góndola:*"); c.fam.forEach(([k,v]) => L.push(`• ${k}: ${pesos(v)}`)); }
  if (c.perd && c.perd.length){ L.push(""); L.push("*Góndola que perdimos:*");
    c.perd.forEach(([k,v]) => L.push(`• ${k}: ${pesos(v)} el año pasado, nada este año`)); }
  if (c.jab >= 1){ L.push("");
    L.push(`🔩 Jabalinas ${uds(c.jab)} u. · Tomacables ${uds(c.tom)} u.` + (gap>0 ? ` — faltan ${uds(gap)}` : " — ratio sano")); }
  const al = alertas(c);
  if (al.length){ L.push(""); L.push("*Atención:*"); al.forEach(a => L.push(`${ICONO[a.n]||"•"} ${a.t}`)); }
  if (c.par) { L.push(""); L.push("🗒️ " + c.par.replace(/\s*·\s*Anotado por el vendedor en Mirol:.*$/,"")); }
  return L.join("\n");
}

function preguntasEspeciales(c){
  const out = [], pl = plazos(c), gap = gapTomacables(c), marcas = marcasDe(c);
  (c.perd || []).forEach(([fam, monto]) =>
    out.push({p:`El año pasado nos compraba ${fam} por ${pesos(monto)} y este año nada. ¿Quién le está surtiendo esa góndola ahora, y por qué nos la sacaron?`,
              m:"Perder una familia entera es perder el espacio en el mostrador, no una venta puntual."}));
  if (marcas)
    out.push({p:`Figura anotado "${marcas}". ¿Sigue vigente o ya se regularizó?`,
              m:"Es una nota vieja de un vendedor, no un estado verificado. Chequealo antes de tomar pedido."});
  if ((c.seg==="A"||c.seg==="B") && c.vTrim!==null && c.vTrim<=-CAIDA)
    out.push({p:"¿Por qué bajaron las compras? ¿Entró otro proveedor, se frenó una obra, o hubo un problema con nosotros?",
              m:`Es segmento ${c.seg} y cayó ${pct(Math.abs(c.vTrim))} en el trimestre.`});
  if (c.dias !== null && c.dias >= pl.d)
    out.push({p:`Hace ${c.dias} días que no compra. ¿Qué pasó? ¿Está comprando en otro lado?`,
              m:`Para ${c.can||"este canal"} el límite es ${pl.d} días.`});
  if (gap > 0)
    out.push({p:`Compra ${uds(c.jab)} jabalinas y sólo ${uds(c.tom)} tomacables. ¿A quién le compra los tomacables?`,
              m:`Faltan ${uds(gap)} tomacables para el ratio normal.`});
  if (c.meses !== undefined && c.meses <= 3 && c.f12 >= 2e6)
    out.push({p:`Repone pocas veces al año y compra fuerte. ¿Se le queda stock parado, o se queda sin y le vende otra marca al que entra?`,
              m:`Compró en ${c.meses} de los últimos 12 meses.`});
  if (c.part >= CONC_CRIT)
    out.push({p:"¿Hay riesgo de que esta cuenta se abra a otro proveedor? ¿Qué los tiene con nosotros?",
              m:`Concentra el ${pct(c.part,1)} de la facturación de FACBSA.`});
  return out.slice(0,4);
}

/* --- estado --- */
const S = {
  vendedor:null, cliente:null, visita:null, ultimoDia:null,
  mcp:null, sample:null, db:null, tools:0, notionOk:false,
  modo:"guion",          // "agente" cuando Claude puede conducir con herramientas
  turnos:[],             // el dialogo que ve el agente
  ocupado:false, confirmar:null, abortar:null,
};
const $ = s => document.querySelector(s);
const el = (t,c,x) => { const e=document.createElement(t); if(c)e.className=c; if(x!==undefined)e.textContent=x; return e; };
const guardar = (k,v) => { try{ localStorage.setItem(k,v); }catch(_){} };
const leer = k => { try{ return localStorage.getItem(k); }catch(_){ return null; } };

const VENDEDORES = [...new Set(CLIENTES.map(c=>c.ven).filter(Boolean))].sort();
const PRUEBA = CLIENTES.find(c => c.prueba) || null;
const esPersona = v => !/\b(S\.?A\.?|S\.?R\.?L\.?|REPRESENT|VENTA DIRECTA|MOSTRADOR)\b/i.test(String(v||""));
function nombrePila(v){
  const s = String(v||"").trim();
  if (!s || !esPersona(s)) return "";
  const w = s.split(/[\s-]+/)[0];
  return w.charAt(0) + w.slice(1).toLowerCase();
}
const vocativo = v => nombrePila(v) ? ", " + nombrePila(v) : "";

/* --- el hilo --- */
function hora(){ const d=new Date(); return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"); }
function bajar(){ requestAnimationFrame(()=>{ const c=$("#cuerpo"); c.scrollTop = c.scrollHeight; }); }
function separadorDia(){
  const hoy = new Date().toDateString();
  if (S.ultimoDia === hoy) return;
  S.ultimoDia = hoy;
  $("#hilo").append(el("div","dia","Hoy"));
}
function burbuja(clase, texto){
  separadorDia();
  const d = el("div","msg "+clase);
  if (clase==="ficha" || clase==="bot") pintarTexto(d, texto);
  else d.textContent = texto;
  if (clase==="bot"||clase==="yo"||clase==="ficha") d.append(el("span","hora",hora()));
  $("#hilo").append(d); bajar(); return d;
}
function pensando(on, que){
  let v = document.getElementById("pensando-x");
  if (!on){ if (v) v.remove(); return; }
  if (!v){
    v = el("div","pensando"); v.id = "pensando-x";
    v.append(el("i"), el("i"), el("i"), el("span","que",""));
    const parar = el("button","parar","Parar"); parar.type = "button";
    parar.onclick = () => { if (S.abortar) S.abortar.abort(); };
    v.append(parar);
    $("#hilo").append(v);
  }
  const q = v.querySelector(".que");
  if (q) q.textContent = que || "";
  bajar();
}
/* Lo que el vendedor ve mientras el agente usa una herramienta. */
function actividad(txt){ pensando(true, txt); }

/* Pinta el markdown pobre que usamos: **titulo** y *subtitulo* por renglon. */
function pintarTexto(d, texto){
  String(texto).split("\n").forEach((ln,i) => {
    if (i) d.append(document.createElement("br"));
    const t = /^\*\*(.+)\*\*$/.exec(ln), s = /^\*(.+)\*$/.exec(ln);
    if (t) d.append(el("b","reng-tit",t[1]));
    else if (s){ const b=document.createElement("b"); b.textContent=s[1]; d.append(b); }
    else d.append(document.createTextNode(ln));
  });
}
/* Burbuja que se va llenando mientras el agente escribe. */
function burbujaStream(){
  separadorDia();
  const d = el("div","msg bot");
  const cuerpo = el("span");
  d.append(cuerpo);
  $("#hilo").append(d); bajar();
  let ultimo = null;
  return {
    poner(t){
      const limpio = String(t||"").replace(/\n*\s*OPC(I(O(N(E(S)?)?)?)?)?:?[\s\S]*$/i, "").trim();
      if (limpio === ultimo) return;
      ultimo = limpio; cuerpo.textContent = ""; pintarTexto(cuerpo, limpio); bajar();
    },
    cerrar(t){ if (t !== undefined) this.poner(t); d.append(el("span","hora",hora())); bajar(); },
    quitar(){ d.remove(); },
    vacio(){ return !ultimo; },
  };
}
function chips(opciones, cb){
  limpiarChips();
  if (!opciones || !opciones.length) return;
  const d = el("div","opciones"); d.id = "opciones-x";
  opciones.forEach(o => {
    const texto = typeof o === "string" ? o : o.t;
    const b = el("button", (typeof o!=="string" && o.tenue) ? "tenue" : null, texto); b.type = "button";
    b.onclick = () => { d.remove(); burbuja("yo", texto); cb(texto, o); };
    d.append(b);
  });
  $("#hilo").append(d); bajar();
}
function limpiarChips(){ const v = document.getElementById("opciones-x"); if (v) v.remove(); }
function barra(titulo, sub, vivo){
  $("#titulo").textContent = titulo;
  const s = $("#subtitulo"); s.textContent = sub; s.classList.toggle("vivo", !!vivo);
}

/* --- texto --- */
function normal(s){ return String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]/g," ").replace(/\s+/g," ").trim(); }
function calzar(valor, opciones){
  if (!valor) return null;
  const v = normal(valor);
  let hit = opciones.find(o => normal(o) === v);
  if (hit) return hit;
  hit = opciones.find(o => normal(o).includes(v) || v.includes(normal(o)));
  return hit || null;
}
const RELLENO = /^(hola|buenas|che|dale|ok|si|sí|ahora|hoy|ya)?\s*(voy|estoy yendo|salgo|paso|arranco|visito|vengo)?\s*(a|para|por|de)?\s*(ver|visitar|pasar por|ir a)?\s*(a|al|a la|el|la|los|las)?\s*(cliente|firma|empresa)?\s*/i;
const limpiarPedido = t => String(t||"").replace(RELLENO,"").replace(/[.?!]+$/,"").trim() || String(t||"").trim();

function buscarClientes(q){
  const v = normal(q);
  if (!v) return [];
  /* Primero los distribuidores del vendedor; los de otro canal se encuentran
     igual, pero el agente avisa que quedan fuera del alcance. */
  const mios  = CARTERA.filter(c => c.ven === S.vendedor);
  const otros = CARTERA.filter(c => c.ven !== S.vendedor);
  const pool  = mios.concat(otros, CLIENTES.filter(c => !esDistribuidor(c)));
  const palabras = v.split(" ").filter(w => w.length >= 3);
  const capas = [
    c => normal(c.n) === v,
    c => normal(c.n).startsWith(v),
    c => normal(c.n).includes(v),
    c => palabras.length > 0 && palabras.every(w => normal(c.n).includes(w)),
    c => palabras.length > 0 && palabras.some(w => w.length >= 4 && normal(c.n).includes(w)),
    c => v.length >= 4 && normal([c.loc,c.prov,c.cuit].filter(Boolean).join(" ")).includes(v),
  ];
  const out = [];
  for (const f of capas){ for (const c of pool){ if (f(c) && !out.includes(c)) out.push(c); } if (out.length) break; }
  return out;
}
function prioridad(c){
  const a = alertas(c);
  if (a.some(x=>x.n==="CRITICO")) return 0;
  if (a.some(x=>x.n==="ALERTA")) return 1;
  if (a.some(x=>x.n==="OPORTUNIDAD")) return 2;
  return 3;
}
function urgentes(n){
  return CARTERA.filter(c => c.ven === S.vendedor && !c.prueba)
    .sort((a,b) => prioridad(a)-prioridad(b) || b.f12-a.f12).slice(0,n);
}

/* ===========================================================================
   EL REPORTE COMERCIAL

   El vendedor pregunta en castellano, el codigo va a las filas de facturacion
   de ese cliente y las responde. Claude no ve el reporte: lo consulta con
   herramientas que corren aca, en la pagina, con los numeros de verdad.

   Fila: [mesIdx, cliIdx, artIdx, cantidad, pesos, usd, dia, cbteIdx, nro, kilos]
=========================================================================== */
const VENTAS = JSON.parse(document.getElementById("datos-ventas").textContent);
const V_MES = VENTAS.mes, V_RUB = VENTAS.rub, V_ART = VENTAS.art, V_CBTE = VENTAS.cbte;
const V_DESDE = V_MES[0], V_HASTA = V_MES[V_MES.length-1], V_CORTE = VENTAS.corte;

const V_IDX = (() => {
  const m = new Map();
  for (let i = 0; i < VENTAS.f.length; i++){
    const c = VENTAS.f[i][1], a = m.get(c);
    if (a) a.push(i); else m.set(c, [i]);
  }
  return m;
})();

/* Como le dice el vendedor a cada familia. */
const SINONIMOS = {
  jabalina:"JABALINAS IRAM 2309", jabalinas:"JABALINAS IRAM 2309",
  tomacable:"TOMA STANDARD", tomacables:"TOMA STANDARD", toma:"TOMA STANDARD", tomas:"TOMA STANDARD",
  conector:"CONECTORES", conectores:"CONECTORES",
  pararrayo:"PARARRAYOS", pararrayos:"PARARRAYOS",
  soldadura:"SOLDADURA CU-AL-TERM", exotermica:"SOLDADURA CU-AL-TERM", cadweld:"SOLDADURA CU-AL-TERM",
  conjunto:"CONJUNTOS", conjuntos:"CONJUNTOS",
  varilla:"VARILLAS DE ACERO COBRE", varillas:"VARILLAS DE ACERO COBRE",
};
const RUBROS_CABLE = ["ALAMBRES AW","ALAMBRES CW FINOS","CONDUWELD 20 %","CONDUWELD 30 %"];

function filtroProducto(texto){
  const q = normal(texto);
  if (!q) return { ok:true, pasa:()=>true, etiqueta:"todo" };
  const palabras = q.split(" ").filter(Boolean);
  for (const w of palabras){
    if (SINONIMOS[w]){
      const rub = SINONIMOS[w];
      return { ok:true, etiqueta:rub, pasa:r => V_RUB[V_ART[r[2]][1]] === rub };
    }
  }
  if (/\b(cable|cables|conduweld|alambre|alambres|2467|aw|cw)\b/.test(q))
    return { ok:true, etiqueta:"cable (AW, CW y Conduweld)", pasa:r => RUBROS_CABLE.includes(V_RUB[V_ART[r[2]][1]]) };
  const rub = V_RUB.find(x => normal(x).includes(q));
  if (rub) return { ok:true, etiqueta:rub, pasa:r => V_RUB[V_ART[r[2]][1]] === rub };
  const hayArt = V_ART.some(a => normal(a[0]).includes(q));
  if (hayArt) return { ok:true, etiqueta:texto, pasa:r => normal(V_ART[r[2]][0]).includes(q) };
  return { ok:false, etiqueta:texto };
}

function filasDe(iCli, desde, hasta, filtro){
  const idx = V_IDX.get(iCli) || [];
  const d = desde || V_DESDE, h = hasta || V_HASTA;
  const out = [];
  for (const k of idx){
    const r = VENTAS.f[k], m = V_MES[r[0]];
    if (m < d || m > h) continue;
    if (filtro && !filtro.pasa(r)) continue;
    out.push(r);
  }
  return out;
}
const fechaDe = r => `${V_MES[r[0]]}-${String(r[6]).padStart(2,"0")}`;
const periodoPedido = (a) => {
  const d = /^\d{4}-\d{2}$/.test(String(a.desde||"")) ? a.desde : V_DESDE;
  const h = /^\d{4}-\d{2}$/.test(String(a.hasta||"")) ? a.hasta : V_HASTA;
  return d <= h ? [d,h] : [h,d];
};
const sinProducto = (f) => ({
  error: `No tengo "${f.etiqueta}" en el reporte de este cliente.`,
  familias: V_RUB.filter(x => x !== "(sin rubro)"),
});

/* --- las tres consultas --- */
function qPorMes(iCli, a){
  const [d,h] = periodoPedido(a);
  const f = filtroProducto(a.producto || "");
  if (!f.ok) return sinProducto(f);
  const fil = filasDe(iCli, d, h, f);
  const porMes = new Map();
  for (const r of fil){
    const m = V_MES[r[0]], e = porMes.get(m) || {mes:m, pesos:0, usd:0, cbtes:new Set()};
    e.pesos += r[4]; e.usd += r[5]; e.cbtes.add(r[8]); porMes.set(m, e);
  }
  const filas = [...porMes.values()].sort((x,y)=>x.mes<y.mes?-1:1)
    .map(e => ({ mes:e.mes, pesos:Math.round(e.pesos), usd:Math.round(e.usd), comprobantes:e.cbtes.size }));
  const corte = filas.length > 36 ? filas.slice(-36) : filas;
  return {
    cliente: CLIENTES[iCli].n, producto: f.etiqueta, periodo: `${d} a ${h}`,
    meses_con_compra: filas.length,
    total_pesos: Math.round(fil.reduce((s,r)=>s+r[4],0)),
    total_usd: Math.round(fil.reduce((s,r)=>s+r[5],0)),
    serie: corte,
    nota: filas.length > 36 ? "Se devolvieron los ultimos 36 meses con compra." : undefined,
  };
}
function qPorProducto(iCli, a){
  const [d,h] = periodoPedido(a);
  const f = filtroProducto(a.producto || "");
  if (!f.ok) return sinProducto(f);
  const porArticulo = String(a.nivel||"").toLowerCase().startsWith("art");
  const fil = filasDe(iCli, d, h, f);
  const g = new Map();
  for (const r of fil){
    const k = porArticulo ? V_ART[r[2]][0] : V_RUB[V_ART[r[2]][1]];
    const e = g.get(k) || {nombre:k, unidades:0, kilos:0, pesos:0, usd:0, ultima:""};
    e.unidades += r[3]; e.kilos += r[9]; e.pesos += r[4]; e.usd += r[5];
    const fe = fechaDe(r); if (fe > e.ultima) e.ultima = fe;
    g.set(k, e);
  }
  const lista = [...g.values()].sort((x,y)=>y.pesos-x.pesos).slice(0,12).map(e => ({
    nombre:e.nombre, unidades:Math.round(e.unidades*100)/100, kilos:Math.round(e.kilos),
    pesos:Math.round(e.pesos), usd:Math.round(e.usd), ultima:e.ultima }));
  return {
    cliente: CLIENTES[iCli].n, nivel: porArticulo ? "articulo" : "familia",
    filtro: f.etiqueta, periodo: `${d} a ${h}`,
    total_pesos: Math.round(fil.reduce((s,r)=>s+r[4],0)),
    items: lista,
    nota: !lista.length ? `Este cliente no compro ${f.etiqueta} en ese periodo.`
        : g.size > 12 ? `Hay ${g.size}; se devolvieron los 12 mas grandes.` : undefined,
  };
}
function qComprobantes(iCli, a){
  const [d,h] = periodoPedido(a);
  const f = filtroProducto(a.producto || "");
  if (!f.ok) return sinProducto(f);
  const fil = filasDe(iCli, d, h, f);
  const g = new Map();
  for (const r of fil){
    const k = r[7] + "-" + r[8];
    const e = g.get(k) || {fecha:fechaDe(r), tipo:V_CBTE[r[7]], numero:r[8], pesos:0, usd:0, lineas:[]};
    e.pesos += r[4]; e.usd += r[5];
    e.lineas.push({ articulo:V_ART[r[2]][0], cantidad:Math.round(r[3]*100)/100, pesos:Math.round(r[4]) });
    g.set(k, e);
  }
  const lim = Math.max(1, Math.min(Number(a.limite) || 6, 12));
  const lista = [...g.values()].sort((x,y)=> x.fecha<y.fecha?1:-1).slice(0, lim).map(e => ({
    ...e, pesos:Math.round(e.pesos), usd:Math.round(e.usd),
    lineas: e.lineas.sort((p,q)=>q.pesos-p.pesos).slice(0,6) }));
  return { cliente: CLIENTES[iCli].n, filtro: f.etiqueta, periodo: `${d} a ${h}`,
           comprobantes_en_el_periodo: g.size, ultimos: lista };
}
function resumenLocal(iCli, pregunta){
  const f = filtroProducto(pregunta);
  const usar = f.ok && f.etiqueta !== "todo" ? f : null;
  const serie = qPorMes(iCli, usar ? {desde:V_MES[V_MES.length-12], producto:usar.etiqueta} : {desde:V_MES[V_MES.length-12]});
  const prod = qPorProducto(iCli, {desde:V_MES[V_MES.length-12]});
  const L = [`*${CLIENTES[iCli].n} — últimos 12 meses del reporte*`];
  if (usar) L.push(`Filtrado por: ${usar.etiqueta}`);
  L.push(`Total ${pesos(serie.total_pesos)} (US$ ${uds(serie.total_usd)}) en ${serie.meses_con_compra} meses con compra.`, "");
  serie.serie.slice(-12).forEach(m => L.push(`• ${m.mes}: ${pesos(m.pesos)}`));
  if (!usar && prod.items.length){ L.push("", "*Por familia:*");
    prod.items.slice(0,6).forEach(i => L.push(`• ${i.nombre}: ${pesos(i.pesos)}${i.unidades?` · ${uds(i.unidades)} u.`:""} · última ${fecha(i.ultima)}`)); }
  return L.join("\n");
}


/* ===========================================================================
   NOTION — leer y escribir, con los nombres de propiedad verificados contra
   el workspace. Todo lo que escribe pasa antes por el vendedor.
=========================================================================== */
const BASES = {
  clientes:     { ds:DS.clientes,   titulo:"Cliente",   nombre:"Clientes" },
  contactos:    { ds:"collection://3260ec70-6f22-4c54-840b-c3479f5fcf92", titulo:"Contacto", nombre:"Contactos de clientes" },
  competidores: { ds:DS.competidor, titulo:"Competidor", nombre:"Competidores" },
  cuestionario: { ds:DS.preguntas,  titulo:"Pregunta",  nombre:"Preguntas del relevamiento" },
  visitas:      { ds:"collection://b5db6f27-f801-4d88-aa55-20f865befe82", titulo:"Visita", nombre:"Visitas relevadas" },
  reglas:       { ds:"collection://65de220d-098a-8331-8caa-87c60d020af0", titulo:"Regla", nombre:"Reglas de negocio" },
};
const urlNotion = new Map();   // nombre de cliente -> url de su pagina

async function filasNotion(ds, limite, filtro){
  const data = { mode:"rows", data_source_url:ds, limit:Math.min(limite||20, 100) };
  if (filtro) data.filter = filtro;
  const r = await S.mcp.callTool(NOTION, "notion-query-data-sources", { data });
  return (r.payload && r.payload.results) || [];
}
async function urlClienteEnNotion(nombre){
  if (urlNotion.has(nombre)) return urlNotion.get(nombre);
  if (!S.mcp) return null;
  try{
    const rows = await filasNotion(DS.clientes, 1, { type:"group", operator:"and", filters:[
      { type:"property", property:"Cliente", propertyType:"title", operator:"string_is", value:{type:"exact", value:nombre} }]});
    const u = rows.length ? rows[0].url : null;
    urlNotion.set(nombre, u);
    return u;
  }catch(_){ return null; }
}
/* notion-update-page quiere el uuid con guiones, no la url de la pagina. */
function uuidDe(url){
  const m = /([0-9a-f]{32})/i.exec(String(url||""));
  if (!m) return null;
  const h = m[1].toLowerCase();
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
/* La relacion viene como texto JSON con las urls de las paginas. */
const relacionTiene = (celda, url) => !!url && String(celda||"").includes(String(url).split("/p/")[1] || "\u0000");

function fechaVence(txt){
  const m = /(\d{1,2})\s*[\/-]\s*(\d{1,2})(?:\s*[\/-]\s*(\d{2,4}))?/.exec(String(txt||""));
  if (!m) return null;
  const d = Number(m[1]), mes = Number(m[2]);
  let a = m[3] ? Number(m[3]) : new Date().getFullYear();
  if (a < 100) a += 2000;
  if (d < 1 || d > 31 || mes < 1 || mes > 12) return null;
  return `${a}-${String(mes).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}
const opcionesDe = id => {
  const p = CUESTIONARIO.find(x => x.id === id) || CUESTIONARIO_LOCAL.find(x => x.id === id);
  return (p && p.opciones) || [];
};
/* Una opcion que Notion no conozca tumba el alta entera: la validamos antes. */
function opcionValida(valor, id, etiqueta){
  if (valor === undefined || valor === null || valor === "") return null;
  const ops = opcionesDe(id);
  if (!ops.length) return String(valor);
  const ok = calzar(valor, ops);
  if (!ok) throw new Error(`"${valor}" no es un valor valido para ${etiqueta}. Tiene que ser uno de: ${ops.join(" | ")}.`);
  return ok;
}
const FAMILIA_NOTION = { "Soldadura exotérm.":"Soldadura exotérmica" };

/* Copia local de la visita, en el store del artifact. */
async function guardarLocal(v){
  if (!S.db) return false;
  try {
    const id = v.inicio.replace(/[:.]/g,"-") + "-" + normal(v.cliente).slice(0,24).replace(/ /g,"-");
    await S.db.collection("visitas").doc(id).set(v);
    return true;
  } catch(_){ return false; }
}

async function escribirVisita(d){
  if (!S.mcp) throw new Error("Notion no esta conectado en este telefono. Guarda la visita como observacion y avisale al vendedor que quedo solo en el registro local.");
  const c = resolverCliente(d.cliente);
  const marca = c.prueba ? "[PRUEBA] " : "";
  const hoy = new Date().toISOString().slice(0,10);
  const resultado  = opcionValida(d.resultado,  "resultado",    "Resultado");
  const stock      = opcionValida(d.stock,      "stock_facbsa", "Stock de FACBSA");
  const exhibicion = opcionValida(d.exhibicion, "exhibicion",   "Exhibicion");
  const comp = d.competencia || {};
  const familia       = opcionValida(comp.familia,       "competencia_familia",       "Familia de competencia");
  const participacion = opcionValida(comp.participacion, "competencia_participacion", "Participacion de competencia");
  const precio        = opcionValida(comp.precio,        "competencia_precio",        "Precio relativo");
  const motivo        = opcionValida(comp.motivo,        "competencia_motivo",        "Motivo");

  const completa = !!(resultado && stock && exhibicion && d.proximo_paso && d.contacto);
  const props = {
    "Visita": `${marca}${c.n} — ${fecha(hoy)}`,
    "date:Fecha:start": hoy, "date:Fecha:is_datetime": 0,
    "Estado": d.estado === "Cancelada" ? "Cancelada" : (completa ? "Completa" : "Incompleta"),
    "Canal": "Carga manual",
  };
  const url = await urlClienteEnNotion(c.n);
  if (url) props["Cliente"] = [url];
  if (resultado)  props["Resultado"] = resultado;
  if (stock)      props["Stock de FACBSA"] = stock;
  if (exhibicion) props["Exhibición"] = exhibicion;
  if (d.proximo_paso){
    props["Próximo paso"] = String(d.proximo_paso);
    const v = /^\d{4}-\d{2}-\d{2}$/.test(String(d.vence||"")) ? d.vence : fechaVence(d.proximo_paso);
    if (v){ props["date:Vence:start"] = v; props["date:Vence:is_datetime"] = 0; }
  }
  const obs = [
    c.prueba ? "VISITA DE PRUEBA — generada desde el banco de ensayo del asistente. Se puede borrar." : null,
    `Relevó: ${S.vendedor || "sin identificar"}.`,
    d.contacto ? "Habló con: " + d.contacto : null,
    d.observaciones || null,
  ].filter(Boolean).join(" · ");
  if (obs) props["Observaciones"] = obs;
  if (d.preguntas_especiales) props["Preguntas especiales"] = String(d.preguntas_especiales);

  await S.mcp.callTool(NOTION, "notion-create-pages", { parent:{ data_source_id: DS.visitas }, pages:[{ properties: props }] });

  let competencia = "sin competencia relevada";
  if (comp.quien && !/^(ninguno|ninguna|nadie|nada|no)\b/i.test(String(comp.quien).trim())){
    const conocido = calzar(comp.quien, COMPETIDORES);
    const cp = {
      "Registro": `${marca}${conocido || comp.quien} — ${familia || "sin familia"}`,
      "date:Fecha:start": hoy, "date:Fecha:is_datetime": 0,
    };
    if (url) cp["Cliente"] = [url];
    const fam = FAMILIA_NOTION[familia] || familia;
    if (fam && fam !== "En ninguno") cp["Familia"] = fam;
    if (participacion && participacion !== "No aplica") cp["Participación"] = participacion;
    if (precio && precio !== "No aplica") cp["Precio relativo"] = precio;
    if (motivo && motivo !== "No aplica") cp["Motivo"] = motivo;
    if (!conocido) cp["Competidor nuevo"] = String(comp.quien);
    await S.mcp.callTool(NOTION, "notion-create-pages", { parent:{ data_source_id: DS.compPdV }, pages:[{ properties: cp }] });
    competencia = `${conocido || comp.quien}${fam ? " en " + fam : ""}`;
  }
  const guardada = { cliente:c.n, prueba:!!c.prueba, vendedor:S.vendedor, inicio:new Date().toISOString(),
                     estado: props["Estado"], respuestas:{ resultado, stock_facbsa:stock, exhibicion,
                     contacto:d.contacto, proximo_paso:d.proximo_paso, observaciones:d.observaciones,
                     competencia_quien:comp.quien, competencia_familia:familia } };
  await guardarLocal(guardada);
  S.visita = guardada;
  return { ok:true, estado:props["Estado"], cliente:c.n, competencia,
           ligada_al_cliente: !!url,
           aviso: url ? undefined : "No encontre la ficha del cliente en Notion, asi que la visita quedo sin relacionar." };
}

const CAMPOS_CLIENTE = {
  particularidades:  "Particularidades",
  condicion_de_pago: "Condición de pago",
  horario:           "Horario de atención",
  telefono:          "Teléfono",
  email:             "Email",
  direccion:         "Dirección",
  zona:              "Zona",
};
async function actualizarCliente(nombre, campos){
  if (!S.mcp) throw new Error("Notion no esta conectado en este telefono, no puedo modificar la ficha.");
  const c = resolverCliente(nombre);
  const url = await urlClienteEnNotion(c.n);
  if (!url) throw new Error(`No encuentro la ficha de ${c.n} en Notion.`);
  const props = {};
  for (const [k,v] of Object.entries(campos || {})){
    const prop = CAMPOS_CLIENTE[k];
    if (prop && v !== undefined && v !== null && String(v).trim()) props[prop] = String(v).trim();
  }
  if (!Object.keys(props).length)
    throw new Error(`No me pasaste nada para cambiar. Los campos que puedo tocar son: ${Object.keys(CAMPOS_CLIENTE).join(", ")}.`);
  const id = uuidDe(url);
  if (!id) throw new Error(`No pude resolver el id de la ficha de ${c.n} en Notion.`);
  await S.mcp.callTool(NOTION, "notion-update-page",
    { page_id: id, command: "update_properties", properties: props });
  if (props["Particularidades"]) c.par = props["Particularidades"];
  if (props["Horario de atención"]) c.hor = props["Horario de atención"];
  if (props["Teléfono"]) c.tel = props["Teléfono"];
  if (props["Dirección"]) c.dir = props["Dirección"];
  if (props["Condición de pago"]) c.pag = props["Condición de pago"];
  return { ok:true, cliente:c.n, cambiado:Object.keys(props) };
}

async function leerNotion(que, buscar, cliente){
  if (!S.mcp) throw new Error("Notion no esta conectado en este telefono.");
  const b = BASES[que];
  if (!b) throw new Error(`No conozco la base "${que}". Las que puedo leer son: ${Object.keys(BASES).join(", ")}.`);
  const q = String(buscar || "").trim();
  let filtro = null;
  if (q && (que === "clientes" || que === "competidores" || que === "reglas" || que === "cuestionario"))
    filtro = { type:"group", operator:"and", filters:[
      { type:"property", property:b.titulo, propertyType:"title", operator:"string_contains", value:{type:"exact", value:q} }]};
  let filas = await filasNotion(b.ds, que === "cuestionario" ? 40 : 25, filtro);
  if (cliente && (que === "contactos" || que === "visitas")){
    const c = resolverCliente(cliente);
    const url = await urlClienteEnNotion(c.n);
    filas = filas.filter(f => relacionTiene(f["Cliente"], url));
  }
  /* Resultados chicos: el agente paga cada ronda. */
  const podar = f => {
    const o = {};
    for (const [k,v] of Object.entries(f)){
      if (k === "url" || k.startsWith("date:") && k.endsWith(":is_datetime")) continue;
      if (v === "" || v === null || v === undefined) continue;
      o[k.replace(/^date:(.+):start$/,"$1")] = typeof v === "string" && v.length > 300 ? v.slice(0,300) + "…" : v;
    }
    return o;
  };
  return { base:b.nombre, encontradas:filas.length, filas:filas.slice(0,12).map(podar) };
}

/* ===========================================================================
   LAS HERRAMIENTAS DEL AGENTE
=========================================================================== */
const IDX_CLIENTE = new Map(CLIENTES.map((c,i) => [c, i]));
function resolverCliente(nombre){
  const q = String(nombre || "").trim();
  if (!q){
    if (S.cliente) return S.cliente;
    throw new Error("Decime de que cliente. Si no sabes el nombre exacto, usa buscar_cliente primero.");
  }
  const cands = buscarClientes(limpiarPedido(q));
  if (!cands.length) throw new Error(`No tengo ningun cliente que se llame "${q}". Usa buscar_cliente con una parte del nombre.`);
  if (cands.length > 1 && normal(cands[0].n) !== normal(q)){
    const exacto = cands.find(c => normal(c.n) === normal(q));
    if (exacto) return exacto;
    throw new Error(`"${q}" coincide con varios: ${cands.slice(0,5).map(c=>c.n).join(" | ")}. Preguntale al vendedor cual es, o usa el nombre completo.`);
  }
  return cands[0];
}
function resumenCliente(c){
  return { cliente:c.n, segmento:c.seg, canal:c.can, actividad:c.act,
           localidad:[c.loc,c.prov].filter(Boolean).join(", ") || undefined,
           facturacion_12m:c.f12, ultima_compra:c.ult, dias_sin_comprar:c.dias,
           repone_meses_de_12:c.meses, gondola_perdida:(c.perd||[]).map(x=>x[0]),
           atiende:c.ven, es_cliente_de_prueba:c.prueba ? true : undefined,
           fuera_de_alcance: esDistribuidor(c) ? undefined :
             `No es distribuidora de materiales: es ${c.act || "de actividad sin clasificar"}. Este asistente atiende solo distribuidoras.` };
}
const PERIODO = { type:"string", description:"Mes en formato AAAA-MM." };

function herramientas(){
  const lista = [
    { name:"buscar_cliente",
      description:"Busca clientes de la cartera por una parte del nombre, la localidad o el CUIT, y devuelve un resumen de cada uno. Sin texto, devuelve los clientes del vendedor que mas urgencia tienen hoy. Usalo antes de abrir una ficha cuando no tenes el nombre exacto.",
      inputSchema:{ type:"object", properties:{
        texto:{ type:"string", description:"Parte del nombre, localidad o CUIT. Vacio = los mas urgentes del vendedor." } } },
      execute: a => {
        actividad("buscando el cliente…");
        const q = String((a&&a.texto) || "").trim();
        const cs = q ? buscarClientes(limpiarPedido(q)) : urgentes(6);
        return { encontrados: cs.length, clientes: cs.slice(0,6).map(resumenCliente),
                 cartera_del_vendedor: CARTERA.filter(c => c.ven === S.vendedor && !c.prueba).length };
      } },

    { name:"ficha_cliente",
      description:"Abre la ficha completa de un cliente y la deja fijada como el cliente de esta visita: facturacion de 12 meses, variaciones, ranking, que compra, ratio jabalinas/tomacables, alertas y los puntos que conviene averiguar adentro. Llamalo apenas sepas a quien va a visitar: devuelve la ficha ya escrita para mostrarsela al vendedor.",
      inputSchema:{ type:"object", properties:{
        cliente:{ type:"string", description:"Nombre del cliente, como lo devolvio buscar_cliente." } },
        required:["cliente"] },
      execute: a => {
        const c = resolverCliente(a && a.cliente);
        actividad("abriendo la ficha…");
        fijarCliente(c);
        burbuja("ficha", armarFicha(c));
        return { cliente:c.n, ficha_ya_mostrada_al_vendedor:true,
                 es_distribuidora_de_materiales: esDistribuidor(c),
                 fuera_de_alcance: esDistribuidor(c) ? undefined :
                   `Ojo: ${c.n} es ${c.act || "de actividad sin clasificar"}, no una distribuidora de materiales. Avisale al vendedor: las reglas del canal distribuidor no le aplican.`,
                 alertas: alertas(c).map(x => `${x.n}: ${x.t}`),
                 puntos_a_averiguar: preguntasEspeciales(c).map(e => ({ pregunta:e.p, por_que:e.m })) };
      } },

    { name:"reporte_ventas",
      description:"Consulta el reporte comercial de un cliente: lo que facturo de verdad, linea por linea. vista='por_mes' da la serie mes a mes en pesos y dolares; vista='por_producto' da el ranking por familia o por articulo con unidades, kilos, pesos y ultima compra; vista='comprobantes' da las ultimas facturas con sus lineas. Usalo siempre que haga falta un numero: nunca estimes.",
      inputSchema:{ type:"object", properties:{
        cliente:{ type:"string", description:"Nombre del cliente. Si se omite, el de la visita en curso." },
        vista:{ type:"string", enum:["por_mes","por_producto","comprobantes"], description:"Por defecto por_mes." },
        desde:PERIODO, hasta:PERIODO,
        nivel:{ type:"string", enum:["familia","articulo"], description:"Solo para por_producto. Por defecto familia." },
        producto:{ type:"string", description:"Filtro: jabalinas, tomacables, cable, conectores, pararrayos, soldadura, conjuntos, varillas, o parte del nombre de un articulo." },
        limite:{ type:"number", description:"Solo para comprobantes: 1 a 12. Por defecto 6." } } },
      execute: a => {
        a = a || {};
        const c = resolverCliente(a.cliente);
        const i = IDX_CLIENTE.get(c);
        const v = String(a.vista || "por_mes");
        actividad(`revisando el reporte de ${nombreCorto(c.n)}…`);
        if (v === "por_producto") return qPorProducto(i, a);
        if (v === "comprobantes") return qComprobantes(i, a);
        return qPorMes(i, a);
      } },

    { name:"notion_leer",
      description:"Lee la base de conocimiento de FACBSA en Notion. que='contactos' trae las personas de un cliente con su rol en la compra; 'visitas' las visitas anteriores de ese cliente; 'competidores' el catalogo con nivel de amenaza y en que familias compite; 'reglas' las reglas de negocio vigentes; 'clientes' la ficha administrativa; 'cuestionario' que datos hay que traer de cada visita.",
      inputSchema:{ type:"object", properties:{
        que:{ type:"string", enum:["contactos","visitas","competidores","reglas","clientes","cuestionario"] },
        cliente:{ type:"string", description:"Para contactos y visitas: de que cliente. Si se omite, el de la visita en curso." },
        buscar:{ type:"string", description:"Para competidores, reglas, clientes y cuestionario: texto a buscar en el titulo." } },
        required:["que"] },
      execute: async (a) => {
        a = a || {};
        actividad(`leyendo ${String(a.que||"Notion")} en Notion…`);
        return await leerNotion(String(a.que), a.buscar, a.cliente);
      } },

    { name:"notion_guardar_visita",
      description:"Escribe la visita relevada en Notion y, si hubo competencia, la registra en Competencia en el punto de venta. Llamalo cuando ya tengas lo que hace falta; antes de escribir, el vendedor ve un resumen y confirma. Si un valor de lista no es valido te lo digo y volves a intentar.",
      inputSchema:{ type:"object", properties:{
        cliente:{ type:"string" },
        contacto:{ type:"string", description:"Nombre y cargo de con quien hablo." },
        resultado:{ type:"string", description:"Una de las opciones de Resultado." },
        stock:{ type:"string", description:"Una de las opciones de Stock de FACBSA." },
        exhibicion:{ type:"string", description:"Una de las opciones de Exhibicion." },
        proximo_paso:{ type:"string", description:"El compromiso concreto que quedo." },
        vence:{ type:"string", description:"Fecha del proximo paso en AAAA-MM-DD, si la hay." },
        observaciones:{ type:"string", description:"Lo que la oficina tiene que saber y no entra en ningun campo." },
        preguntas_especiales:{ type:"string", description:"Los puntos a averiguar y que contesto el vendedor, una por renglon." },
        competencia:{ type:"object", description:"Si nombro un competidor: {quien, familia, participacion, precio, motivo}." } },
        required:["cliente"] },
      execute: async (a) => {
        a = a || {};
        const c = resolverCliente(a.cliente);
        const resumen = [
          a.contacto ? "Habló con: " + a.contacto : null,
          a.resultado ? "Resultado: " + a.resultado : null,
          a.stock ? "Stock: " + a.stock : null,
          a.exhibicion ? "Exhibición: " + a.exhibicion : null,
          a.competencia && a.competencia.quien ? "Competencia: " + a.competencia.quien +
            (a.competencia.familia ? " en " + a.competencia.familia : "") : null,
          a.proximo_paso ? "Próximo paso: " + a.proximo_paso : null,
          a.observaciones ? "Nota: " + a.observaciones : null,
        ].filter(Boolean).join("\n");
        pensando(false);
        const r = await pedirConfirmacion(`*Esto es lo que voy a cargar en ${c.n}:*`, resumen,
                                          c.prueba ? "Es el cliente de prueba: va marcado [PRUEBA]." : null);
        if (!r.ok) return { cancelado:true, el_vendedor_dijo: r.texto || "que todavia no lo guardes" };
        actividad("escribiendo en Notion…");
        return await escribirVisita(a);
      } },

    { name:"notion_actualizar_cliente",
      description:"Corrige la ficha administrativa de un cliente en Notion cuando el vendedor avisa que un dato cambio: particularidades, condicion de pago, horario de atencion, telefono, email, direccion o zona. Pisa el valor anterior, asi que el vendedor confirma antes. No sirve para facturacion ni saldos: eso no vive en Notion.",
      inputSchema:{ type:"object", properties:{
        cliente:{ type:"string" },
        particularidades:{ type:"string", description:"Lo que hay que saber antes de entrar. Pisa lo que habia: incluí tambien lo que siga valiendo." },
        condicion_de_pago:{ type:"string" }, horario:{ type:"string" },
        telefono:{ type:"string" }, email:{ type:"string" },
        direccion:{ type:"string" }, zona:{ type:"string" } },
        required:["cliente"] },
      execute: async (a) => {
        a = a || {};
        const c = resolverCliente(a.cliente);
        const campos = {};
        for (const k of Object.keys(CAMPOS_CLIENTE)) if (a[k]) campos[k] = a[k];
        if (!Object.keys(campos).length)
          throw new Error(`No me pasaste nada para cambiar. Campos posibles: ${Object.keys(CAMPOS_CLIENTE).join(", ")}.`);
        const antes = { particularidades:c.par, condicion_de_pago:c.pag, horario:c.hor,
                        telefono:c.tel, direccion:c.dir, zona:c.zona };
        const detalle = Object.entries(campos).map(([k,v]) =>
          `${CAMPOS_CLIENTE[k]}\nantes: ${antes[k] || "(vacío)"}\nqueda: ${v}`).join("\n\n");
        pensando(false);
        const r = await pedirConfirmacion(`*Voy a cambiar la ficha de ${c.n} en Notion:*`, detalle,
                                          "Pisa lo que estaba. Mirá que no se pierda nada.");
        if (!r.ok) return { cancelado:true, el_vendedor_dijo: r.texto || "que no lo cambies" };
        actividad("actualizando la ficha en Notion…");
        return await actualizarCliente(c.n, campos);
      } },
  ];
  return S.tools ? lista.slice(0, Math.max(3, S.tools)) : lista;
}

function pedirConfirmacion(titulo, detalle, nota){
  burbuja("bot", [titulo, "", detalle, nota ? "\n" + nota : ""].filter(Boolean).join("\n"));
  return new Promise(resolve => {
    S.confirmar = resolve;
    chips(["Sí, dale", {t:"No, esperá", tenue:true}], t => {
      if (S.confirmar !== resolve) return;
      S.confirmar = null;
      resolve({ ok: /^s/i.test(normal(t)) });
    });
  });
}

/* ===========================================================================
   EL AGENTE
=========================================================================== */
const nombreCorto = n => String(n).split(/\s+/).slice(0,2).join(" ");
function fijarCliente(c){
  S.cliente = c;
  barra(c.n, [c.loc,c.prov].filter(Boolean).join(", ") || "Visita en curso", false);
}

function reglas(){
  const hoy = new Date().toISOString().slice(0,10);
  const c = S.cliente;
  const pedidos = (CUESTIONARIO.length ? CUESTIONARIO : CUESTIONARIO_LOCAL)
    .filter(p => p.obl)
    .map(p => `- ${p.texto}` + (p.opciones && p.opciones.length ? `  [${p.opciones.join(" | ")}]` : "  [texto libre]"))
    .join("\n");
  return `Sos el asistente de visitas de la fuerza de ventas de FACBSA, fábrica argentina de conductores bimetálicos para puesta a tierra (jabalinas, tomacables, cable IRAM 2467, conectores, pararrayos, soldadura exotérmica, conjuntos). Hablás por chat con un vendedor que está en la calle.

Hoy es ${hoy}. El vendedor es ${S.vendedor || "todavía no identificado"}${S.vendedor ? ` y tiene ${CARTERA.filter(x=>x.ven===S.vendedor&&!x.prueba).length} distribuidoras en cartera` : ""}.
${c ? `La visita en curso es a ${c.n} (segmento ${c.seg||"-"}, ${c.can||"-"}, ${[c.loc,c.prov].filter(Boolean).join(", ")}).` : "Todavía no hay un cliente abierto."}

CÓMO TRABAJÁS
Pensá como un jefe de ventas que conoce la cuenta, no como un formulario. Antes de la visita: entendé a quién va a ver, mirá la ficha, y decile en dos o tres líneas qué está en juego y qué tiene que resolver adentro. Después de la visita: escuchá cómo le fue y sacá vos lo que puedas de lo que contó.

Tenés herramientas. Usalas en vez de suponer:
- Un número de facturación, unidades, kilos o fechas de compra sale SIEMPRE de reporte_ventas. Nunca estimes ni redondees de memoria.
- Con quién hablar, qué pasó en visitas anteriores, quién es un competidor o qué dice una regla: notion_leer.
- Cuando tengas lo de la visita, notion_guardar_visita. El vendedor confirma antes de que se escriba.
- Si avisa que cambió un dato de la ficha (horario, teléfono, quién decide, una condición), notion_actualizar_cliente.

A QUIÉN ATENDÉS
Exclusivamente DISTRIBUIDORAS DE MATERIALES ELÉCTRICOS: el mayorista con mostrador y depósito que le revende al electricista, al instalador y a la obra chica. Son ${CARTERA.length} clientes y la mitad de la facturación de FACBSA.
No atendés constructoras, distribuidoras de energía (EDESUR, EDENOR, ENERSA y demás), fabricantes ni industria. Si el vendedor nombra un cliente de otro tipo, la herramienta te lo va a marcar como fuera de alcance: decíselo en una línea y pasale la ficha igual si la pide, aclarando que las reglas de abajo no le aplican.

CÓMO SE LEE UN DISTRIBUIDOR
No compra para usar: compra para revender. Eso cambia qué mirar.
- Lo que nos factura es sell-in. Lo que decide la próxima compra es el sell-out: si lo que compró quedó en el depósito, no repone por más relación que haya.
- Sin stock no hay venta. Si el mostrador no tiene jabalina nuestra, le vende la del competidor al electricista que entró a comprarla. El quiebre de stock es plata perdida que no aparece en ningún número.
- La góndola es espacio disputado. Que deje de comprar una familia entera, aunque el total aguante, significa que otro se quedó con ese lugar: es la señal más grave y la más fácil de pasar por alto.
- El que decide la compra casi nunca es el que atiende el mostrador, pero el del mostrador es el que le recomienda la marca al electricista. Hay que trabajar a los dos.
- Cada cuánto repone importa tanto como cuánto compra. El que compra fuerte una o dos veces al año tiene stock parado o se queda sin.
- Nuestra ventaja es la norma IRAM: contra el importado barato lo que vende es el certificado, sobre todo si el distribuidor trabaja obra.

REGLAS DEL NEGOCIO QUE YA SABÉS
- Inactividad en este canal: 60 días sin comprar es alarma, 120 lo da por perdido.
- Una cuenta que concentra 10% o más de la facturación total de FACBSA es de alta exposición; 20% o más es estructural.
- Un segmento A o B que cae 15% o más en el trimestre es riesgo de churn: hay que entender por qué.
- Quien compra jabalinas debería comprar alrededor de 2 tomacables cada 3 jabalinas. Si compra menos, los está comprando en otro lado.
- El reporte va de ${V_DESDE} a ${V_HASTA} (corte ${V_CORTE}). Los últimos 12 meses son ${V_MES[V_MES.length-12]} a ${V_HASTA}.
- El reporte arranca en 2022 y la inflación es alta: si comparás pesos de años distintos, aclarálo o pasá a dólares.
- Competidores conocidos: ${COMPETIDORES.join(", ")}.

QUÉ TIENE QUE TRAER CADA VISITA
${pedidos}
No se lo preguntes como un cuestionario ni todo junto. Si ya lo dijo, no lo repreguntes. Si algo quedó vago, pedí la precisión que falta. De a una o dos preguntas por mensaje.

CÓMO ESCRIBÍS
Castellano rioplatense, de vos. Corto: dos a cinco renglones, salvo que te pidan detalle. Sin saludos de oficina, sin "¡excelente!", sin resumir lo que el vendedor te acaba de decir. Nada de viñetas largas ni tablas: esto se lee en un teléfono, caminando.
Si la respuesta es de una lista cerrada, o hay dos o tres caminos claros, terminá el mensaje con un último renglón así:
OPCIONES: primera | segunda | tercera
Ese renglón no se muestra como texto: se convierte en botones. No lo uses para preguntas abiertas.`;
}

function separarOpciones(txt){
  const m = /\n?\s*OPCIONES\s*:\s*(.+?)\s*$/i.exec(txt || "");
  if (!m) return [String(txt||"").trim(), null];
  const ops = m[1].split("|").map(s => s.trim()).filter(Boolean).slice(0,6);
  return [String(txt).slice(0, m.index).trim(), ops.length ? ops : null];
}

async function agente(texto){
  S.turnos.push({ role:"user", content: texto });
  if (S.turnos.length > 26) S.turnos = S.turnos.slice(-26);
  if (S.turnos[0].role !== "user") S.turnos = S.turnos.slice(1);

  const entrada = [
    { role:"user", content: reglas() },
    { role:"assistant", content: "Listo. Soy el asistente de visitas de FACBSA." },
    ...S.turnos,
  ];
  const burb = burbujaStream();
  pensando(true, "pensando…");
  S.abortar = new AbortController();
  let txt = "";
  try {
    const r = await S.sample(entrada, {
      modelTier: "default",
      tools: herramientas(),
      signal: S.abortar.signal,
      onText: ({ text }) => { pensando(false); burb.poner(text); },
    });
    txt = String((r && r.text) || "").trim();
  } catch(e){
    pensando(false);
    const cod = e && e.code;
    if (cod === "cancelled"){ burb.quitar(); burbuja("sistema","Lo corté."); return; }
    burb.quitar();
    if (cod === "not_granted" || cod === "tools_unavailable"){
      S.modo = "guion"; S.sample = cod === "not_granted" ? null : S.sample;
      burbuja("sistema","No puedo usar el agente en este teléfono. Sigo con el relevamiento pregunta por pregunta.");
      arrancarGuion(texto);
      return;
    }
    if (cod === "rate_limited"){ burbuja("bot","Me quedé sin crédito por ahora. Probá de nuevo en un rato."); return; }
    if (cod === "overloaded" || cod === "server_unavailable"){ burbuja("bot","Se me colgó la conexión. Repetímelo y lo intento de nuevo."); return; }
    burbuja("bot","No pude contestarte ahora. Repetímelo, o pedime la ficha o el reporte y te los paso igual.");
    return;
  } finally {
    pensando(false); S.abortar = null;
  }

  const [cuerpo, ops] = separarOpciones(txt);
  if (!cuerpo && !ops){ burb.quitar(); burbuja("bot","Me quedé sin palabras. Repetímelo."); return; }
  burb.cerrar(cuerpo || "…");
  S.turnos.push({ role:"assistant", content: txt || "(sin texto)" });
  if (ops) chips(ops, t => recibir(t));
}

/* ===========================================================================
   MODO SIN AGENTE — el guion de siempre, para que la calle no quede a pie
=========================================================================== */
function aplica(p, r){
  if (!p.omite) return true;
  const v = (r.competencia_quien || "").trim().toLowerCase();
  if (!v) return true;
  return !/^(ninguno|ninguna|no|nadie|nada|ningun)\b/.test(v);
}
function pendientesDe(v){
  const r = v.respuestas, pre = v.opcPreguntadas || [];
  return (CUESTIONARIO.length ? CUESTIONARIO : CUESTIONARIO_LOCAL)
    .filter(p => (p.obl || pre.includes(p.id)) && aplica(p,r) && !r[p.id])
    .concat(v.especiales.filter(e => !r["esp_"+e.i]).map(e => ({
      id:"esp_"+e.i, texto:e.p, contexto:e.m, tipo:"texto", obl:true, orden:60+e.i })))
    .sort((a,b)=>(a.orden||50)-(b.orden||50));
}
function guardarRespuesta(p, valor){
  if (p.tipo === "opciones"){
    const ok = calzar(valor, p.opciones);
    if (!ok) return false;
    S.visita.respuestas[p.id] = ok; return true;
  }
  const t = String(valor||"").trim();
  if (!t) return false;
  S.visita.respuestas[p.id] = t; return true;
}
function arrancarGuion(texto){
  const cands = buscarClientes(limpiarPedido(texto || ""));
  if (!S.cliente && cands.length === 1) abrirGuion(cands[0]);
  else if (!S.cliente && cands.length > 1)
    chips(cands.slice(0,5).map(c=>c.n), t => { const c = cands.find(x=>x.n===t); if (c) abrirGuion(c); });
  else if (!S.cliente) burbuja("bot","Decime el nombre del cliente y te paso la ficha.");
  else siguienteGuion();
}
function abrirGuion(c){
  fijarCliente(c);
  S.visita = { cliente:c.n, prueba:!!c.prueba, vendedor:S.vendedor, inicio:new Date().toISOString(),
               estado:"EN_CURSO", respuestas:{}, opcPreguntadas:[],
               especiales:preguntasEspeciales(c).map((e,i)=>({...e,i})) };
  burbuja("ficha", armarFicha(c));
  if (S.visita.especiales.length){
    const L = ["*Lo que tenés que resolver adentro*",""];
    S.visita.especiales.forEach((e,i)=>{ L.push(`${i+1}. ${e.p}`); L.push(`    ↳ ${e.m}`); L.push(""); });
    burbuja("bot", L.join("\n").trim());
  }
  burbuja("bot","Cuando salgas, contame cómo te fue.");
}
function siguienteGuion(){
  if (!S.visita) return;
  const pend = pendientesDe(S.visita);
  if (!pend.length){
    const lista = CUESTIONARIO.length ? CUESTIONARIO : CUESTIONARIO_LOCAL;
    const opc = lista.find(p => !p.obl && aplica(p,S.visita.respuestas)
      && !S.visita.respuestas[p.id] && !S.visita.opcPreguntadas.includes(p.id));
    if (opc){ S.visita.opcPreguntadas.push(opc.id); burbuja("bot", opc.texto); return; }
    burbuja("bot","Listo, tengo todo. ¿Lo cargo?");
    chips(["Cargar la visita",{t:"Todavía no",tenue:true}], async t => {
      if (!/^cargar/i.test(t)) return;
      pensando(true,"escribiendo en Notion…");
      const r = S.visita.respuestas;
      try {
        await escribirVisita({ cliente:S.visita.cliente, contacto:r.contacto, resultado:r.resultado,
          stock:r.stock_facbsa, exhibicion:r.exhibicion, proximo_paso:r.proximo_paso,
          observaciones:r.observaciones, preguntas_especiales:S.visita.especiales
            .map((e,i)=> r["esp_"+i] ? `${e.p} → ${r["esp_"+i]}` : null).filter(Boolean).join("\n"),
          competencia:{ quien:r.competencia_quien, familia:r.competencia_familia,
            participacion:r.competencia_participacion, precio:r.competencia_precio, motivo:r.competencia_motivo } });
        pensando(false); burbuja("sistema","Cargada en Notion.");
      } catch(e){ pensando(false); burbuja("sistema","No pude escribirla en Notion: " + (e && e.message || "error") + " Quedó guardada acá."); }
    });
    return;
  }
  const p = pend[0];
  burbuja("bot", p.texto + (p.contexto ? `\n    ↳ ${p.contexto}` : ""));
  if (p.tipo === "opciones") chips(p.opciones, v => { guardarRespuesta(p,v); siguienteGuion(); });
}
function turnoGuion(texto){
  if (!S.visita){ arrancarGuion(texto); return; }
  const pend = pendientesDe(S.visita);
  if (pend.length) guardarRespuesta(pend[0], texto);
  siguienteGuion();
}

/* ===========================================================================
   LA CONVERSACION
=========================================================================== */
function saludar(){
  burbuja("bot","Hola 👋 Soy el asistente de visitas de FACBSA.");
  const g = leer("facbsa.vendedor");
  if (g && VENDEDORES.includes(g)){
    burbuja("bot", `Sos ${g}, ¿no?`);
    chips([nombrePila(g) ? `Sí, soy ${nombrePila(g)}` : "Sí, soy yo", {t:"Soy otro", tenue:true}],
      t => { if (/^soy otro$/i.test(t)) preguntarQuien(); else elegirVendedor(g); });
  } else preguntarQuien();
}
function preguntarQuien(){
  S.vendedor = null;
  burbuja("bot","¿Quién sos? Tocá tu nombre o escribilo.");
  chips(VENDEDORES, t => elegirVendedor(t));
}
function elegirVendedor(v){
  S.vendedor = v; guardar("facbsa.vendedor", v);
  S.turnos = []; S.cliente = null; S.visita = null;
  const n = CARTERA.filter(c => c.ven === v && !c.prueba).length;
  barra("Asistente de visitas", v + " · " + n + (n===1?" distribuidora":" distribuidoras"), true);
  const abre = `Listo${vocativo(v)}. Tenés ${n} ${n===1?"distribuidora":"distribuidoras"} en cartera.\n¿A quién vas a visitar? Decime el nombre, o preguntame lo que quieras del cliente y lo busco.`;
  burbuja("bot", abre);
  S.turnos.push({ role:"assistant", content: abre });
  const op = urgentes(3).map(c => c.n);
  if (PRUEBA) op.push({t:"Cliente de prueba", tenue:true});
  chips(op, t => recibir(t === "Cliente de prueba" && PRUEBA ? PRUEBA.n : t));
}

function ayuda(){
  burbuja("bot", ["*Para qué te sirvo*","",
    "Atiendo distribuidoras de materiales eléctricos. Si el cliente es de otro rubro te lo aviso.","",
    "Decime a quién vas a visitar y te paso la ficha y lo que conviene resolver adentro.",
    "Preguntame lo que quieras de ese cliente: cuánto lleva, qué compra, cuándo fue el último pedido,",
    "con quién conviene hablar, qué pasó la visita anterior. Lo busco en el reporte y en Notion.",
    "Al salir contame cómo te fue y yo lo dejo cargado.","",
    "Si cambió un dato de la ficha (horario, teléfono, quién decide), decímelo y lo corrijo en Notion.","",
    "*Atajos:* ficha · reporte · otro cliente · mis visitas · quién soy · ayuda"].join("\n"));
}
async function misVisitas(){
  if (!S.db){ burbuja("bot","Las visitas guardadas se leen cuando abrís esta página con tu cuenta de Claude."); return; }
  pensando(true,"buscando tus visitas…");
  let docs = [];
  try { const r = await S.db.collection("visitas").orderBy("inicio","desc").limit(10).get(); docs = r.docs || r || []; }
  catch(_){ pensando(false); burbuja("bot","No pude leer las visitas guardadas."); return; }
  pensando(false);
  if (!docs.length){ burbuja("bot","Todavía no cargaste ninguna visita desde este teléfono."); return; }
  const L = ["*Tus últimas visitas*",""];
  docs.forEach(d => {
    const v = d.data ? d.data() : d, r = v.respuestas || {};
    L.push(`• ${v.prueba?"[PRUEBA] ":""}${v.cliente} — ${fecha((v.inicio||"").slice(0,10))}`);
    const det = [r.resultado, r.proximo_paso].filter(Boolean).join(" · ");
    if (det) L.push(`    ${det}`);
  });
  burbuja("bot", L.join("\n"));
}
function comando(texto){
  const t = normal(texto);
  if (!t) return false;
  if (/^(ayuda|help|que podes hacer|que haces)$/.test(t)){ ayuda(); return true; }
  if (/^(mis visitas|visitas|historial)$/.test(t)){ misVisitas(); return true; }
  if (/^(quien soy|cambiar vendedor|no soy yo|soy otro)$/.test(t)){ preguntarQuien(); return true; }
  if (/^(otro cliente|cambiar cliente|cambiar de cliente)$/.test(t)){
    S.cliente = null; S.visita = null;
    barra("Asistente de visitas", S.vendedor || "FACBSA", true);
    burbuja("bot","Dale. ¿A quién vas a ver ahora?");
    S.turnos.push({ role:"assistant", content:"¿A quién vas a ver ahora?" });
    const op = urgentes(3).map(c => c.n);
    chips(op, x => recibir(x));
    return true;
  }
  if (S.cliente){
    if (/^(ficha|la ficha|datos|los datos)$/.test(t)){ burbuja("ficha", armarFicha(S.cliente)); return true; }
    if (/^(reporte|ventas|el reporte|las ventas)$/.test(t)){ burbuja("bot", resumenLocal(IDX_CLIENTE.get(S.cliente), "")); return true; }
  }
  return false;
}

async function recibir(texto){
  const t = String(texto||"").trim();
  if (!t) return;
  /* Una confirmacion pendiente se lleva lo que el vendedor escriba. */
  if (S.confirmar){
    const f = S.confirmar; S.confirmar = null; limpiarChips();
    burbuja("yo", t);
    f({ ok: /^(si|s|dale|ok|mandalo|cargalo|guardalo|confirmo|va)$/.test(normal(t)), texto:t });
    return;
  }
  if (S.ocupado) return;
  if (!S.vendedor){ burbuja("yo", t); const v = calzar(t, VENDEDORES); if (v) elegirVendedor(v); else preguntarQuien(); return; }
  S.ocupado = true;
  try {
    limpiarChips();
    burbuja("yo", t);
    if (comando(t)) return;
    if (S.modo === "agente") await agente(t);
    else turnoGuion(t);
  } finally { S.ocupado = false; }
}

/* --- compositor --- */
const entrada = $("#entrada");
function enviar(){
  const t = entrada.value.trim(); if (!t) return;
  entrada.value = ""; entrada.style.height = "auto";
  recibir(t);
}
entrada.addEventListener("input", () => {
  entrada.style.height = "auto";
  entrada.style.height = Math.min(entrada.scrollHeight, 120) + "px";
});
entrada.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing){ e.preventDefault(); enviar(); }
});
$("#enviar").addEventListener("click", enviar);
$("#dictar").addEventListener("click", () => {
  entrada.focus();
  if (leer("facbsa.pista-mic") !== "1"){
    guardar("facbsa.pista-mic","1");
    burbuja("sistema","Tocá la tecla del micrófono de tu teclado y hablá normal: lo que dictes entra como texto y queda asentado. (En WhatsApp vas a poder mandar el audio directo.)");
  }
});

/* --- Notion en vivo: el cuestionario y los competidores mandan desde ahi --- */
async function cargarDeNotion(){
  if (!S.mcp) return;
  try {
    const rows = await filasNotion(DS.preguntas, 40);
    const activas = rows.filter(x => x["Activa"] === "__YES__" && x["Identificador"]);
    if (activas.length >= 5){
      CUESTIONARIO = activas.map(x => ({
        id: x["Identificador"], orden: Number(x["Orden"]) || 50, texto: x["Pregunta"],
        tipo: (x["Tipo"] === "Texto libre" || x["Tipo"] === "Foto") ? "texto" : "opciones",
        opciones: (x["Opciones"]||"").split(/<br\s*\/?>|\r?\n/i).map(s=>s.trim()).filter(Boolean),
        obl: x["Obligatoria"] === "__YES__",
        omite: /competencia_(familia|participacion|precio|motivo)/.test(x["Identificador"]||""),
      })).filter(p => p.tipo !== "opciones" || p.opciones.length).sort((a,b)=>a.orden-b.orden);
      S.notionOk = true;
    }
  } catch(_){}
  try {
    const rows = await filasNotion(DS.competidor, 40);
    const nombres = rows.map(x => x["Competidor"]).filter(Boolean);
    if (nombres.length){ COMPETIDORES = nombres; S.notionOk = true; }
  } catch(_){}
}

/* --- arranque --- */
saludar();

(async () => {
  const use = (window.claude && window.claude.use) ? window.claude.use.bind(window.claude) : null;
  if (!use){
    burbuja("sistema","Esta página se está viendo fuera de claude.ai: el agente y Notion no contestan. La ficha y el relevamiento funcionan igual.");
    return;
  }
  const [sample, db, mcp] = await Promise.all([
    use("sample").catch(()=>null), use("db").catch(()=>null), use("mcp").catch(()=>null),
  ]);
  S.sample = sample; S.db = db; S.mcp = mcp;
  if (sample){
    const lim = await sample.limits().catch(()=>null);
    S.tools = (lim && lim.tools && lim.tools.maxCount) || 0;
    if (S.tools >= 3) S.modo = "agente";
  }
  if (mcp) await cargarDeNotion();
  const faltan = [];
  if (S.modo !== "agente") faltan.push("el agente");
  if (!mcp) faltan.push("Notion");
  if (faltan.length)
    burbuja("sistema", "No pude conectar " + faltan.join(" ni ") +
      " en este teléfono. Sigo igual, pero con el relevamiento pregunta por pregunta y sin escribir en Notion.");
  else if (S.tools < 6)
    burbuja("sistema", `Este teléfono me deja usar ${S.tools} herramientas de las 6. Puedo leer la ficha y el reporte, pero no escribir en Notion.`);
})();
