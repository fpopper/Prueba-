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
  if (c.ops) L.push(`🧾 ${c.ops} operaciones en 12 meses`);
  if (c.ven) L.push(`👤 Atiende: ${c.ven}`);
  if (c.pag) L.push(`💳 Condición de pago: ${c.pag}`);
  if (c.con && c.con.length){ L.push(""); L.push("*Con quién hablar:*");
    c.con.forEach(p => L.push(`• ${p.nom}${p.car?" — "+p.car:""}${p.rol?" ("+p.rol+")":""}${p.tel?" · "+p.tel:""}`)); }
  if (c.fam && c.fam.length){ L.push(""); L.push("*Qué compra:*"); c.fam.forEach(([k,v]) => L.push(`• ${k}: ${pesos(v)}`)); }
  if (c.jab >= 1){ L.push("");
    L.push(`🔩 Jabalinas ${uds(c.jab)} u. · Tomacables ${uds(c.tom)} u.` + (gap>0 ? ` — faltan ${uds(gap)}` : " — ratio sano")); }
  const al = alertas(c);
  if (al.length){ L.push(""); L.push("*Atención:*"); al.forEach(a => L.push(`${ICONO[a.n]||"•"} ${a.t}`)); }
  if (c.par) { L.push(""); L.push("🗒️ " + c.par.replace(/\s*·\s*Anotado por el vendedor en Mirol:.*$/,"")); }
  return L.join("\n");
}

function preguntasEspeciales(c){
  const out = [], pl = plazos(c), gap = gapTomacables(c), marcas = marcasDe(c);
  if ((c.seg==="A"||c.seg==="B") && c.vTrim!==null && c.vTrim<=-CAIDA)
    out.push({p:"¿Por qué bajaron las compras? ¿Entró otro proveedor, se frenó una obra, o hubo un problema con nosotros?",
              m:`Es segmento ${c.seg} y cayó ${pct(Math.abs(c.vTrim))} en el trimestre.`});
  if (c.dias !== null && c.dias >= pl.d)
    out.push({p:`Hace ${c.dias} días que no compra. ¿Qué pasó? ¿Está comprando en otro lado?`,
              m:`Para ${c.can||"este canal"} el límite es ${pl.d} días.`});
  if (gap > 0)
    out.push({p:`Compra ${uds(c.jab)} jabalinas y sólo ${uds(c.tom)} tomacables. ¿A quién le compra los tomacables?`,
              m:`Faltan ${uds(gap)} tomacables para el ratio normal.`});
  if (c.can === "Distribuidora eléctrica")
    out.push({p:"¿Estamos homologados en su pliego? ¿Cuándo abre la próxima licitación o renovación?",
              m:"En distribuidoras la compra pasa por pliego: lo que manda es la homologación."});
  if (marcas)
    out.push({p:`Figura anotado "${marcas}". ¿Sigue vigente o ya se regularizó?`,
              m:"Es una nota vieja de un vendedor, no un estado verificado."});
  if (c.part >= CONC_CRIT)
    out.push({p:"¿Hay riesgo de que esta cuenta se abra a otro proveedor? ¿Qué los tiene con nosotros?",
              m:`Concentra el ${pct(c.part,1)} de la facturación de FACBSA.`});
  return out.slice(0,4);
}

/* --- estado --- */
const S = {
  vendedor:null, fase:"quien", cliente:null, visita:null, candidatos:null,
  mcp:null, sample:null, db:null, notionOk:false, ocupado:false, ultimoDia:null,
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
  if (clase==="ficha" || clase==="bot"){
    texto.split("\n").forEach((ln,i) => {
      if (i) d.append(document.createElement("br"));
      const t = /^\*\*(.+)\*\*$/.exec(ln), s = /^\*(.+)\*$/.exec(ln);
      if (t){ const b=el("b","reng-tit",t[1]); d.append(b); }
      else if (s){ const b=document.createElement("b"); b.textContent=s[1]; d.append(b); }
      else d.append(document.createTextNode(ln));
    });
  } else d.textContent = texto;
  if (clase==="bot"||clase==="yo"||clase==="ficha") d.append(el("span","hora",hora()));
  $("#hilo").append(d); bajar(); return d;
}
function pensando(on){
  const v = document.getElementById("pensando-x");
  if (on && !v){ const d=el("div","pensando"); d.id="pensando-x"; d.append(el("i"),el("i"),el("i")); $("#hilo").append(d); bajar(); }
  if (!on && v) v.remove();
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
  const mios = CLIENTES.filter(c => c.ven === S.vendedor);
  const pool = mios.concat(CLIENTES.filter(c => c.ven !== S.vendedor));
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
  return CLIENTES.filter(c => c.ven === S.vendedor && !c.prueba)
    .sort((a,b) => prioridad(a)-prioridad(b) || b.f12-a.f12).slice(0,n);
}

/* --- cuestionario pendiente --- */
function aplica(p, r){
  if (!p.omite) return true;
  const v = (r.competencia_quien || "").trim().toLowerCase();
  if (!v) return true;
  return !/^(ninguno|ninguna|no|nadie|nada|ningun)\b/.test(v);
}
function pendientes(){
  const r = S.visita.respuestas, pre = S.visita.opcPreguntadas || [];
  return CUESTIONARIO.filter(p => (p.obl || pre.includes(p.id)) && aplica(p,r) && !r[p.id])
    .concat(S.visita.especiales.filter(e => !r["esp_"+e.i]).map(e => ({
      id:"esp_"+e.i, texto:e.p, contexto:e.m, tipo:"texto", obl:true, busca:e.p, orden:60+e.i, especial:true })))
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

/* --- conversacion --- */
function saludar(){
  const g = leer("facbsa.vendedor");
  burbuja("bot","Hola 👋 Soy el asistente de visitas de FACBSA.\nDecime a quién vas a visitar y te paso la ficha y lo que hay que resolver adentro. Al salir me contás cómo te fue.");
  if (g && VENDEDORES.includes(g)){
    S.fase = "quien";
    burbuja("bot",`Sos ${g}, ¿no?`);
    chips([nombrePila(g) ? `Sí, soy ${nombrePila(g)}` : "Sí, soy yo", {t:"Soy otro", tenue:true}], (t) => {
      if (t === "Soy otro") preguntarQuien(); else elegirVendedor(g);
    });
  } else preguntarQuien();
}
function preguntarQuien(){
  S.fase = "quien";
  burbuja("bot","¿Quién sos? Tocá tu nombre o escribilo.");
  chips(VENDEDORES, t => elegirVendedor(t));
}
function elegirVendedor(v){
  S.vendedor = v; guardar("facbsa.vendedor", v);
  const n = CLIENTES.filter(c => c.ven === v && !c.prueba).length;
  barra("Asistente de visitas", v + " · " + n + (n===1?" cliente":" clientes"), true);
  burbuja("bot", `Listo${vocativo(v)}. Tenés ${n} ${n===1?"cliente":"clientes"} en cartera.`);
  pedirCliente();
}
function pedirCliente(){
  S.fase = "cliente"; S.cliente = null; S.visita = null; S.candidatos = null;
  if (S.vendedor) barra("Asistente de visitas", S.vendedor, true);
  burbuja("bot","¿A quién vas a visitar? Escribime el nombre — con una parte alcanza.");
  const op = urgentes(3).map(c => c.n);
  if (PRUEBA) op.push({t:"Cliente de prueba", tenue:true, prueba:true});
  chips(op, (t,o) => {
    if (o && o.prueba) abrirCliente(PRUEBA); else resolverCliente(t);
  });
}
function resolverCliente(texto){
  const q = limpiarPedido(texto);
  const cands = buscarClientes(q);
  if (!cands.length){
    burbuja("bot", `No encuentro ninguno que se llame "${q}". Probá con otra parte del nombre, o con la localidad.`);
    const op = urgentes(3).map(c => c.n);
    if (PRUEBA) op.push({t:"Cliente de prueba", tenue:true, prueba:true});
    chips(op, (t,o) => { if (o && o.prueba) abrirCliente(PRUEBA); else resolverCliente(t); });
    return;
  }
  if (cands.length === 1){ abrirCliente(cands[0]); return; }
  S.candidatos = cands.slice(0,5);
  burbuja("bot", cands.length > 5
    ? `Tengo ${cands.length} que coinciden. Estos son los más grandes — si no está, afiná el nombre.`
    : "Tengo varios parecidos. ¿Cuál es?");
  chips(S.candidatos.map(c => c.n + (c.loc ? " — " + c.loc : "")).concat([{t:"Ninguno de estos", tenue:true}]),
    (t) => {
      if (t === "Ninguno de estos"){ burbuja("bot","Dale, escribime el nombre de otra forma."); S.candidatos=null; return; }
      const c = S.candidatos.find(x => t.startsWith(x.n));
      if (c) abrirCliente(c); else resolverCliente(t);
    });
}

function textoDesafios(v){
  const L = ["*Lo que tenés que resolver adentro*", "Te lo vuelvo a preguntar al salir.", ""];
  v.especiales.forEach((e,i) => { L.push(`${i+1}. ${e.p}`); L.push(`    ↳ ${e.m}`); L.push(""); });
  return L.join("\n").trim();
}
function abrirCliente(c){
  limpiarChips();
  S.cliente = c; S.fase = "visita";
  S.visita = { cliente:c.n, prueba:!!c.prueba, vendedor:S.vendedor, inicio:new Date().toISOString(),
               estado:"DECLARADA", respuestas:{}, opcPreguntadas:[],
               especiales:preguntasEspeciales(c).map((e,i)=>({...e,i})), historia:[] };
  barra(c.n, [c.loc, c.prov].filter(Boolean).join(", ") || "Visita en curso", false);
  if (c.prueba) burbuja("sistema","Cliente de prueba. Todo lo que cargues queda marcado [PRUEBA] en Notion y se puede borrar sin tocar un solo dato real.");
  burbuja("ficha", armarFicha(c));
  if (S.visita.especiales.length) burbuja("bot", textoDesafios(S.visita));
  chips(["Entro ahora","Ya salí, te cuento",{t:"Otro cliente",tenue:true}], t => {
    if (t === "Otro cliente"){ pedirCliente(); return; }
    S.visita.estado = "EN_CURSO";
    burbuja("bot", t === "Entro ahora"
      ? "Dale. Cuando salgas, contame cómo te fue — escribiendo o dictando, todo junto si querés."
      : "Contame cómo te fue. Tirame todo junto, yo después te pregunto lo que falte.");
  });
}

/* --- el agente --- */
async function interpretar(texto){
  const pend = pendientes();
  if (!S.sample) return { comentario:null, respuestas:{} };
  const guia = pend.map(p => ({ id:p.id, pregunta:p.texto, busca:p.busca,
    opciones:p.tipo==="opciones" ? p.opciones : undefined })).slice(0,8);
  const prompt =
`Sos el asistente de relevamiento de la fuerza de ventas de FACBSA, fábrica argentina de conductores bimetálicos para puesta a tierra.
El vendedor acaba de salir de visitar a ${S.cliente.n} y te está contando cómo le fue, hablando natural.

Tenés que hacer dos cosas:
1. Extraer de lo que dijo las respuestas a los puntos pendientes. Para los puntos con opciones, devolvé EXACTAMENTE una de las opciones listadas, nunca un texto propio. Si de lo que dijo no se deduce la respuesta, no la inventes: omití ese id.
2. Escribir un comentario de UNA línea, máximo 15 palabras, como le hablarías a un vendedor en la calle. Sin saludos ni florituras. Si no entendiste nada, decilo.

Competidores conocidos: ${COMPETIDORES.join(", ")}.
Puntos pendientes: ${JSON.stringify(guia)}

Lo que dijo el vendedor: """${texto}"""

Devolvé sólo JSON: {"comentario":"...","respuestas":{"id":"valor"}}`;
  try {
    const r = await S.sample.json(prompt, { modelTier:"default" });
    return { comentario: r && r.comentario || null, respuestas: (r && r.respuestas) || {} };
  } catch(e){
    if (e && e.code === "not_granted") { S.sample = null; return { comentario:null, respuestas:{}, sinAgente:true }; }
    return { comentario:null, respuestas:{}, error:(e && e.code) || "error" };
  }
}

async function turno(texto){
  S.visita.historia.push({ rol:"vendedor", t:texto });
  if (S.visita.estado === "DECLARADA") S.visita.estado = "EN_CURSO";
  limpiarChips();

  const antes = pendientes();
  const esperada = antes[0];
  let tomada = false;
  if (esperada && esperada.tipo === "opciones" && calzar(texto, esperada.opciones))
    tomada = guardarRespuesta(esperada, texto);

  if (!tomada){
    pensando(true);
    const r = await interpretar(texto);
    pensando(false);
    let n = 0;
    for (const [id,val] of Object.entries(r.respuestas||{})){
      const p = antes.find(x => x.id === id);
      if (p && guardarRespuesta(p, val)) n++;
    }
    if (r.sinAgente) burbuja("bot","No puedo usar el agente acá, así que te las pregunto una por una.");
    else if (r.error) burbuja("bot","No pude procesar eso. Te lo pregunto directo.");
    else if (r.comentario) burbuja("bot", r.comentario);
    /* Si el agente no sacó nada, tomo el texto como respuesta a lo que estaba preguntando. */
    if (!n && esperada && esperada.tipo !== "opciones") guardarRespuesta(esperada, texto);
  }
  siguiente();
}

function siguiente(){
  const pend = pendientes();
  if (!pend.length){
    /* Las no obligatorias se preguntan una sola vez, recien cuando no falta nada. */
    const opc = CUESTIONARIO.find(p => !p.obl && aplica(p,S.visita.respuestas)
      && !S.visita.respuestas[p.id] && !S.visita.opcPreguntadas.includes(p.id));
    if (opc){
      S.visita.opcPreguntadas.push(opc.id);
      burbuja("bot", opc.texto);
      if (opc.tipo === "opciones")
        chips(opc.opciones, v => { guardarRespuesta(opc, v); S.visita.historia.push({rol:"vendedor",t:v}); siguiente(); });
      return;
    }
    burbuja("bot","Listo, tengo todo. ¿Cerramos el relevamiento?");
    chips(["Cerrar relevamiento",{t:"Agregar algo más",tenue:true}], t => {
      if (t === "Cerrar relevamiento") cerrar();
      else burbuja("bot","Dale, contame.");
    });
    return;
  }
  const p = pend[0];
  const total = CUESTIONARIO.filter(x=>x.obl).length + S.visita.especiales.length;
  const hechas = Object.keys(S.visita.respuestas).length;
  let t = `${Math.min(hechas+1,total)}/${total} · ${p.texto}`;
  if (p.contexto) t += `\n    ↳ ${p.contexto}`;
  burbuja("bot", t);
  if (p.tipo === "opciones")
    chips(p.opciones, v => { guardarRespuesta(p, v); S.visita.historia.push({rol:"vendedor",t:v}); siguiente(); });
}

/* --- cierre y guardado --- */
async function urlClienteEnNotion(nombre){
  if (!S.mcp) return null;
  try{
    const r = await S.mcp.callTool(NOTION,"notion-query-data-sources",{ data:{ mode:"rows", data_source_url:DS.clientes, limit:1,
      filter:{ type:"group", operator:"and", filters:[
        { type:"property", property:"Cliente", propertyType:"title", operator:"string_is", value:{type:"exact", value:nombre} }]}}});
    const rows = (r.payload && r.payload.results) || [];
    return rows.length ? rows[0].url : null;
  }catch(_){ return null; }
}
function fechaVence(txt){
  const m = /(\d{1,2})\s*[\/-]\s*(\d{1,2})(?:\s*[\/-]\s*(\d{2,4}))?/.exec(String(txt||""));
  if (!m) return null;
  const hoy = new Date();
  const d = Number(m[1]), mes = Number(m[2]);
  let a = m[3] ? Number(m[3]) : hoy.getFullYear();
  if (a < 100) a += 2000;
  if (d < 1 || d > 31 || mes < 1 || mes > 12) return null;
  const iso = `${a}-${String(mes).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}
async function guardarEnNotion(v){
  if (!S.mcp) return { ok:false, motivo:"sin-notion" };
  const r = v.respuestas;
  const marca = v.prueba ? "[PRUEBA] " : "";
  const completa = !pendientesDe(v).length;
  const props = {
    "Visita": `${marca}${v.cliente} — ${fecha(v.inicio.slice(0,10))}`,
    "date:Fecha:start": v.inicio.slice(0,10), "date:Fecha:is_datetime": 0,
    "Estado": v.estado === "CANCELADA" ? "Cancelada" : (completa ? "Completa" : "Incompleta"),
    "Canal": "Carga manual",
  };
  const url = await urlClienteEnNotion(v.cliente);
  if (url) props["Cliente"] = [url];
  if (r.resultado) props["Resultado"] = r.resultado;
  if (r.stock_facbsa) props["Stock de FACBSA"] = r.stock_facbsa;
  if (r.exhibicion) props["Exhibición"] = r.exhibicion;
  if (r.proximo_paso){
    props["Próximo paso"] = r.proximo_paso;
    const vence = fechaVence(r.proximo_paso);
    if (vence){ props["date:Vence:start"] = vence; props["date:Vence:is_datetime"] = 0; }
  }
  const obs = [
    v.prueba ? "VISITA DE PRUEBA — generada desde el banco de ensayo del asistente. Se puede borrar." : null,
    `Relevó: ${v.vendedor || "sin identificar"}.`,
    r.contacto ? "Habló con: " + r.contacto : null,
    r.observaciones && !/^no$/i.test(r.observaciones.trim()) ? r.observaciones : null,
  ].filter(Boolean).join(" · ");
  if (obs) props["Observaciones"] = obs;
  const esp = v.especiales.map((e,i) => r["esp_"+i] ? `${e.p} → ${r["esp_"+i]}` : null).filter(Boolean).join("\n");
  if (esp) props["Preguntas especiales"] = esp;
  try {
    await S.mcp.callTool(NOTION,"notion-create-pages",{ parent:{ data_source_id: DS.visitas }, pages:[{ properties: props }]});
  } catch(e){ return { ok:false, motivo:(e && e.code) || "error" }; }

  if (r.competencia_quien && aplica({omite:true}, r)) {
    const cp = {
      "Registro": `${marca}${calzar(r.competencia_quien, COMPETIDORES) || r.competencia_quien} — ${r.competencia_familia || "sin familia"}`,
      "date:Fecha:start": v.inicio.slice(0,10), "date:Fecha:is_datetime": 0,
    };
    if (url) cp["Cliente"] = [url];
    const fam = { "Soldadura exotérm.":"Soldadura exotérmica" }[r.competencia_familia] || r.competencia_familia;
    if (fam && fam !== "En ninguno") cp["Familia"] = fam;
    if (r.competencia_participacion && r.competencia_participacion !== "No aplica") cp["Participación"] = r.competencia_participacion;
    if (r.competencia_precio && r.competencia_precio !== "No aplica") cp["Precio relativo"] = r.competencia_precio;
    if (r.competencia_motivo && r.competencia_motivo !== "No aplica") cp["Motivo"] = r.competencia_motivo;
    if (!calzar(r.competencia_quien, COMPETIDORES)) cp["Competidor nuevo"] = r.competencia_quien;
    try { await S.mcp.callTool(NOTION,"notion-create-pages",{ parent:{ data_source_id: DS.compPdV }, pages:[{ properties: cp }]}); } catch(_){}
  }
  return { ok:true };
}
function pendientesDe(v){
  const r = v.respuestas;
  return CUESTIONARIO.filter(p => p.obl && aplica(p,r) && !r[p.id])
    .concat(v.especiales.filter(e => !r["esp_"+e.i]));
}

async function cerrar(){
  limpiarChips();
  const faltan = pendientesDe(S.visita).length;
  S.visita.estado = faltan ? "INCOMPLETA" : "COMPLETA";
  S.visita.fin = new Date().toISOString();
  const v = JSON.parse(JSON.stringify(S.visita));
  pensando(true);
  const n = await guardarEnNotion(v);
  await guardarLocal(v);
  pensando(false);

  const r = v.respuestas;
  const res = [
    r.resultado ? "Resultado: " + r.resultado : null,
    r.contacto ? "Habló con " + r.contacto : null,
    r.stock_facbsa ? "Stock: " + r.stock_facbsa : null,
    r.competencia_quien ? "Competencia: " + r.competencia_quien : null,
    r.proximo_paso ? "Próximo paso: " + r.proximo_paso : null,
  ].filter(Boolean);
  burbuja("bot", `*${v.cliente}* — relevamiento ${faltan ? "cerrado con " + faltan + " punto(s) sin contestar" : "completo"}.\n\n` + res.join("\n"));
  burbuja("sistema", n.ok
    ? (v.prueba ? "Cargada en Notion como [PRUEBA], en Visitas relevadas." : "Cargada en Notion, en Visitas relevadas.")
    : n.motivo === "sin-notion"
      ? "Notion no está conectado en este teléfono. La visita quedó guardada acá."
      : "No pude escribir en Notion ahora. La visita quedó guardada acá y se puede recargar después.");
  S.fase = "libre";
  chips(["Voy a otro cliente",{t:"Por hoy terminé",tenue:true}], t => {
    if (t === "Por hoy terminé"){ burbuja("bot","Listo. Buen día de calle 👋"); S.fase="libre"; }
    else pedirCliente();
  });
}
async function guardarLocal(v){
  if (!S.db) return false;
  try {
    const id = v.inicio.replace(/[:.]/g,"-") + "-" + normal(v.cliente).slice(0,24).replace(/ /g,"-");
    await S.db.collection("visitas").doc(id).set(v);
    return true;
  } catch(_){ return false; }
}
function cancelar(){
  limpiarChips();
  if (!S.visita || S.fase !== "visita"){ burbuja("bot","No hay ninguna visita abierta."); return; }
  S.visita.estado = "CANCELADA";
  burbuja("sistema","Visita cancelada. No se cargó nada.");
  S.fase = "libre";
  chips(["Otro cliente"], () => pedirCliente());
}

/* --- comandos --- */
async function misVisitas(){
  if (!S.db){ burbuja("bot","Las visitas guardadas se leen cuando abrís esta página con tu cuenta de Claude."); return; }
  pensando(true);
  let docs = [];
  try { const r = await S.db.collection("visitas").orderBy("inicio","desc").limit(10).get(); docs = r.docs || r || []; }
  catch(_){ pensando(false); burbuja("bot","No pude leer las visitas guardadas."); return; }
  pensando(false);
  if (!docs.length){ burbuja("bot","Todavía no relevaste ninguna visita."); return; }
  const L = ["*Tus últimas visitas*",""];
  docs.forEach(d => {
    const v = d.data ? d.data() : d, r = v.respuestas || {};
    L.push(`• ${v.prueba?"[PRUEBA] ":""}${v.cliente} — ${fecha((v.inicio||"").slice(0,10))}`);
    const det = [r.resultado, r.proximo_paso].filter(Boolean).join(" · ");
    if (det) L.push(`    ${det}`);
  });
  burbuja("bot", L.join("\n"));
}
function ayuda(){
  burbuja("bot", ["*Cómo se usa*","",
    "• Decime a quién vas a visitar y te paso la ficha.",
    "• Al salir, contame todo junto: yo saco lo que puedo y te pregunto lo que falte.",
    "• Para dictar, tocá el micrófono de tu teclado.","",
    "*Atajos:* ficha · desafíos · otro cliente · mis visitas · cerrar · cancelar"].join("\n"));
}
function comando(texto){
  const t = normal(texto);
  if (!t) return false;
  if (/^(ayuda|help|que puedo hacer)$/.test(t)){ ayuda(); return true; }
  if (/^(mis visitas|visitas|historial)$/.test(t)){ misVisitas(); return true; }
  if (/^(otro cliente|cambiar cliente|cambiar de cliente|otro)$/.test(t)){ pedirCliente(); return true; }
  if (/^(quien soy|cambiar vendedor|no soy yo)$/.test(t)){ preguntarQuien(); return true; }
  if (S.fase === "visita"){
    if (/^(ficha|la ficha|datos|los datos)$/.test(t)){ burbuja("ficha", armarFicha(S.cliente)); return true; }
    if (/^(desafios|retos|que tengo que averiguar|pendientes)$/.test(t)){
      burbuja("bot", S.visita.especiales.length ? textoDesafios(S.visita) : "Esta visita no tiene desafíos especiales: es relevamiento de rutina.");
      return true;
    }
    if (/^(cerrar|cerrar relevamiento|listo|termine)$/.test(t)){ cerrar(); return true; }
    if (/^(cancelar|cancelar visita)$/.test(t)){ cancelar(); return true; }
  }
  return false;
}

/* --- entrada --- */
async function recibir(texto){
  const t = String(texto||"").trim();
  if (!t || S.ocupado) return;
  S.ocupado = true;
  try {
    burbuja("yo", t);
    if (comando(t)) return;
    if (S.fase === "quien"){
      const v = calzar(t, VENDEDORES);
      if (v) elegirVendedor(v);
      else { burbuja("bot","No te tengo en la lista de vendedores habilitados. Tocá tu nombre:"); chips(VENDEDORES, x => elegirVendedor(x)); }
      return;
    }
    if (S.fase === "cliente"){ resolverCliente(t); return; }
    if (S.fase === "visita"){ await turno(t); return; }
    // fase libre
    const cands = buscarClientes(limpiarPedido(t));
    if (cands.length){ S.fase = "cliente"; resolverCliente(t); }
    else { burbuja("bot","¿Vas a visitar a alguien? Decime el nombre."); S.fase = "cliente"; }
  } finally { S.ocupado = false; }
}

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

/* --- Notion en vivo --- */
async function cargarDeNotion(){
  if (!S.mcp) return;
  try {
    const r = await S.mcp.callTool(NOTION,"notion-query-data-sources",
      { data:{ mode:"rows", data_source_url:DS.preguntas, limit:40 } }, { cache:{ staleTime:60000 } });
    const rows = (r.payload && r.payload.results) || [];
    const activas = rows.filter(x => x["Activa"] === "__YES__" && x["Identificador"]);
    if (activas.length >= 5){
      CUESTIONARIO = activas.map(x => ({
        id: x["Identificador"], orden: Number(x["Orden"]) || 50, texto: x["Pregunta"],
        tipo: (x["Tipo"] === "Texto libre" || x["Tipo"] === "Foto") ? "texto" : "opciones",
        opciones: (x["Opciones"]||"").split(/<br\s*\/?>|\r?\n/i).map(s=>s.trim()).filter(Boolean),
        obl: x["Obligatoria"] === "__YES__",
        omite: /competencia_(familia|participacion|precio|motivo)/.test(x["Identificador"]||""),
        busca: x["Qué busca en el audio"] || x["Pregunta"],
      })).filter(p => p.tipo !== "opciones" || p.opciones.length).sort((a,b)=>a.orden-b.orden);
      S.notionOk = true;
    }
  } catch(_){}
  try {
    const r = await S.mcp.callTool(NOTION,"notion-query-data-sources",
      { data:{ mode:"rows", data_source_url:DS.competidor, limit:40 } }, { cache:{ staleTime:300000 } });
    const rows = (r.payload && r.payload.results) || [];
    const nombres = rows.map(x => x["Competidor"]).filter(Boolean);
    if (nombres.length) { COMPETIDORES = nombres; S.notionOk = true; }
  } catch(_){}
}

/* --- boot --- */
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
  if (mcp) await cargarDeNotion();
  const faltan = [];
  if (!sample) faltan.push("el agente");
  if (!mcp) faltan.push("Notion");
  if (faltan.length)
    burbuja("sistema", "No pude conectar " + faltan.join(" ni ") + " en este teléfono. El relevamiento funciona igual, pregunta por pregunta, y queda guardado acá.");
})();
