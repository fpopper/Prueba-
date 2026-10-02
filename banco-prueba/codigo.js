"use strict";
/* ---------------------------------------------------------------------------
   El asistente corre como corre el de WhatsApp: el codigo arma la ficha, Claude
   conversa, Notion manda las reglas y recibe la visita.

   - Numeros de la ficha  -> reporte comercial (Notion no los guarda, por regla)
   - Cuestionario y competidores -> Notion en vivo, con copia local de respaldo
   - La visita relevada   -> se escribe en Notion; copia en el store del artifact
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
  L.push("");
  L.push(`💰 Facturación 12m: ${pesos(c.f12)}` + (c.part ? ` (${pct(c.part,1)} del total)` : "") + (c.rank ? ` · #${c.rank} del ranking` : ""));
  if (c.vAnual !== null) L.push(`${flecha(c.vAnual)} vs 12m anteriores: ${pct(c.vAnual)}`);
  if (c.vTrim !== null) L.push(`${flecha(c.vTrim)} último trimestre: ${pct(c.vTrim)}`);
  L.push(c.ult ? `🗓️ Última compra: ${fecha(c.ult)} (hace ${c.dias} días · para ${c.can||"este canal"} el límite es ${pl.d})`
               : "🗓️ Sin compras registradas en el período.");
  if (c.ops) L.push(`🧾 ${c.ops} operaciones en 12 meses`);
  if (c.ven) L.push(`👤 Atiende: ${c.ven}`);
  if (c.pag) L.push(`💳 Condición de pago: ${c.pag}`);
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
  vendedor: null, vista: "quien", cliente: null, visita: null,
  filtro: "prioridad", mcp: null, sample: null, db: null, notionOk: false, aviso: null,
};
const $ = s => document.querySelector(s);
const el = (t,c,x) => { const e=document.createElement(t); if(c)e.className=c; if(x!==undefined)e.textContent=x; return e; };
const guardar = (k,v) => { try{ localStorage.setItem(k,v); }catch(_){} };
const leer = k => { try{ return localStorage.getItem(k); }catch(_){ return null; } };

const VENDEDORES = [...new Set(CLIENTES.map(c=>c.ven).filter(Boolean))].sort();

/* --- arranque --- */
function pintarVendedores(){
  const cont = $("#quien"); cont.textContent = "";
  VENDEDORES.forEach(v => {
    const n = CLIENTES.filter(c=>c.ven===v).length;
    const b = el("button"); b.type="button";
    const ini = el("span","ini", v.split(/[\s-]/).filter(Boolean).slice(0,2).map(w=>w[0]).join(""));
    const nom = el("span","nom", v);
    const cant = el("span","cant", n + (n===1?" cliente":" clientes"));
    b.append(ini,nom,cant);
    b.onclick = () => { S.vendedor = v; guardar("facbsa.vendedor", v); irA("lista"); };
    cont.append(b);
  });
}

function irA(v){
  S.vista = v;
  ["quien","lista","chat","oficina"].forEach(x => { $("#v-"+x).hidden = x!==v; });
  $("#pestanas").hidden = !(v==="lista"||v==="oficina");
  $("#volver").hidden = v!=="chat";
  $("#comp").hidden = v!=="chat";
  $("#pista").hidden = v!=="chat";
  $("#acciones").hidden = !(v==="chat" && S.visita && S.visita.estado==="EN_CURSO");
  $("#pestanas").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.vista===v)));
  if (v==="lista"){ $("#titulo").firstChild.nodeValue = "Mis clientes"; $("#subtitulo").textContent = S.vendedor; pintarLista(); }
  if (v==="oficina"){ $("#titulo").firstChild.nodeValue = "Oficina"; $("#subtitulo").textContent = "Visitas relevadas"; pintarOficina(); }
  if (v==="chat" && S.cliente){ $("#titulo").firstChild.nodeValue = S.cliente.n; $("#subtitulo").textContent = [S.cliente.loc,S.cliente.prov].filter(Boolean).join(", "); }
  if (v==="quien"){ $("#titulo").firstChild.nodeValue = "Asistente de visitas"; $("#subtitulo").textContent = "FACBSA"; }
  $("#cuerpo").scrollTop = 0;
}

function prioridad(c){
  const a = alertas(c);
  if (a.some(x=>x.n==="CRITICO")) return 0;
  if (a.some(x=>x.n==="ALERTA")) return 1;
  if (a.some(x=>x.n==="OPORTUNIDAD")) return 2;
  return 3;
}
function pintarLista(){
  const q = ($("#q").value||"").trim().toLowerCase();
  let cs = CLIENTES.filter(c => c.ven === S.vendedor);
  if (S.filtro === "todos") cs = CLIENTES.slice();
  else if (["A","B","C"].includes(S.filtro)) cs = cs.filter(c => c.seg === S.filtro);
  if (q) cs = CLIENTES.filter(c => (c.n+" "+(c.loc||"")+" "+(c.cuit||"")).toLowerCase().includes(q));
  if (S.filtro === "prioridad" && !q) cs.sort((a,b) => prioridad(a)-prioridad(b) || b.f12-a.f12);
  else cs.sort((a,b) => b.f12 - a.f12);

  const L = $("#lista"); L.textContent = "";
  if (!cs.length){ L.append(el("p","vacio","Ningún cliente con ese criterio.")); return; }
  cs.slice(0,80).forEach(c => {
    const al = alertas(c), p = prioridad(c);
    const b = el("button","cli" + (p===0?" rojo":p===1?" ambar":"")); b.type="button";
    const l1 = el("div","l1");
    l1.append(el("span","nombre",c.n), el("span","seg "+(c.seg||""),c.seg||"–"), el("span","plata",pesos(c.f12)));
    const l2 = el("div","l2");
    l2.append(el("span",null,[c.loc,c.prov].filter(Boolean).join(", ") || "Sin localidad"));
    if (c.dias !== null) l2.append(el("span",null,"·"), el("span",null,`hace ${c.dias} d`));
    b.append(l1,l2);
    const top = al.find(x=>x.n==="CRITICO") || al.find(x=>x.n==="ALERTA");
    if (top) b.append(el("div","l3"+(top.n==="ALERTA"?" ambar":""), ICONO[top.n]+" "+top.t));
    b.onclick = () => abrirCliente(c);
    L.append(b);
  });
  if (cs.length > 80) L.append(el("p","vacio",`Mostrando 80 de ${cs.length}. Usá el buscador.`));
}

/* --- chat --- */
function burbuja(clase, texto){
  const d = el("div","msg "+clase);
  if (clase==="ficha"){
    d.innerHTML = "";
    texto.split("\n").forEach((ln,i) => {
      if (i) d.append(document.createElement("br"));
      const m = /^\*\*(.+)\*\*$/.exec(ln) || /^\*(.+)\*$/.exec(ln);
      if (m) { const b=document.createElement("b"); b.textContent=m[1]; d.append(b); }
      else d.append(document.createTextNode(ln));
    });
  } else d.textContent = texto;
  $("#hilo").append(d); bajar(); return d;
}
function bajar(){ requestAnimationFrame(()=>{ $("#cuerpo").scrollTop = $("#cuerpo").scrollHeight; }); }
function pensando(on){
  const v = $("#pensando-x");
  if (on && !v){ const d=el("div","pensando"); d.id="pensando-x"; d.append(el("i"),el("i"),el("i"),el("span",null,"Pensando…")); $("#hilo").append(d); bajar(); }
  if (!on && v) v.remove();
}
function botonera(opciones, cb){
  const vieja = $("#opciones-x"); if (vieja) vieja.remove();
  if (!opciones || !opciones.length) return;
  const d = el("div","opciones"); d.id="opciones-x";
  opciones.forEach(o => { const b=el("button",null,o); b.type="button";
    b.onclick = () => { d.remove(); burbuja("yo", o); cb(o); }; d.append(b); });
  $("#hilo").append(d); bajar();
}
function limpiarBotonera(){ const v=$("#opciones-x"); if(v) v.remove(); }

function aplica(p, r){
  if (!p.omite) return true;
  const v = (r.competencia_quien || "").trim().toLowerCase();
  if (!v) return true;
  return !/^(ninguno|ninguna|no|nadie|nada|ningun)\b/.test(v);
}
function pendientes(){
  const r = S.visita.respuestas;
  return CUESTIONARIO.filter(p => p.obl && aplica(p,r) && !r[p.id])
    .concat(S.visita.especiales.filter(e => !S.visita.respuestas["esp_"+e.i]).map(e => ({
      id:"esp_"+e.i, texto:e.p, contexto:e.m, tipo:"texto", obl:true, busca:e.p, especial:true })))
    .sort((a,b)=>(a.orden||50)-(b.orden||50));
}

function abrirCliente(c){
  S.cliente = c;
  S.visita = { cliente:c.n, vendedor:S.vendedor, inicio:new Date().toISOString(),
               estado:"DECLARADA", respuestas:{}, especiales:preguntasEspeciales(c).map((e,i)=>({...e,i})), historia:[] };
  $("#hilo").textContent = "";
  irA("chat");
  burbuja("ficha", armarFicha(c));
  if (S.visita.especiales.length){
    const L = ["❗ Averiguá esto adentro — te lo vuelvo a preguntar al salir:",""];
    S.visita.especiales.forEach((e,i) => { L.push(`${i+1}. ${e.p}`); L.push(`   ${e.m}`); L.push(""); });
    burbuja("bot", L.join("\n").trim());
  }
  botonera(["Entro ahora","Ya salí, te cuento"], v => {
    S.visita.estado = "EN_CURSO"; $("#acciones").hidden = false;
    if (v === "Entro ahora") burbuja("bot","Dale. Cuando salgas, contame cómo te fue — hablando o escribiendo, como te salga.");
    else burbuja("bot","Contame cómo te fue. Podés tirarme todo junto, yo después te pregunto lo que falte.");
  });
}

/* --- el agente --- */
function normal(s){ return String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]/g," ").replace(/\s+/g," ").trim(); }
function calzar(valor, opciones){
  if (!valor) return null;
  const v = normal(valor);
  let hit = opciones.find(o => normal(o) === v);
  if (hit) return hit;
  hit = opciones.find(o => normal(o).includes(v) || v.includes(normal(o)));
  return hit || null;
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
    return { comentario:null, respuestas:{}, error:e && e.code || "error" };
  }
}

async function turno(texto){
  burbuja("yo", texto);
  limpiarBotonera();
  S.visita.historia.push({ rol:"vendedor", t:texto });

  const antes = pendientes();
  const esperada = antes[0];

  /* Si acaba de contestar una pregunta puntual, intento tomarla directo. */
  let tomada = false;
  if (esperada && esperada.tipo === "opciones" && calzar(texto, esperada.opciones)) {
    tomada = guardarRespuesta(esperada, texto);
  }

  if (!tomada) {
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
    else if (!n && esperada && esperada.tipo !== "opciones") { tomada = guardarRespuesta(esperada, texto); }
  }
  siguiente();
}

function siguiente(){
  const pend = pendientes();
  if (!pend.length){
    burbuja("bot","Listo, tengo todo. ¿Cerramos el relevamiento?");
    botonera(["Cerrar relevamiento"], () => cerrar());
    return;
  }
  const p = pend[0];
  const total = CUESTIONARIO.filter(x=>x.obl).length + S.visita.especiales.length;
  const hechas = Object.keys(S.visita.respuestas).length;
  let t = `${Math.min(hechas+1,total)}/${total} · ${p.texto}`;
  if (p.contexto) t += `\n\n${p.contexto}`;
  burbuja("bot", t);
  if (p.tipo === "opciones") botonera(p.opciones, v => { guardarRespuesta(p, v); S.visita.historia.push({rol:"vendedor",t:v}); siguiente(); });
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
async function guardarEnNotion(v){
  if (!S.mcp) return { ok:false, motivo:"sin-notion" };
  const r = v.respuestas;
  const props = {
    "Visita": `${v.cliente} — ${fecha(v.inicio.slice(0,10))}`,
    "date:Fecha:start": v.inicio.slice(0,10), "date:Fecha:is_datetime": 0,
    "Estado": "Completa", "Canal": "Carga manual",
  };
  const url = await urlClienteEnNotion(v.cliente);
  if (url) props["Cliente"] = [url];
  if (r.resultado) props["Resultado"] = r.resultado;
  if (r.stock_facbsa) props["Stock de FACBSA"] = r.stock_facbsa;
  if (r.exhibicion) props["Exhibición"] = r.exhibicion;
  if (r.proximo_paso) props["Próximo paso"] = r.proximo_paso;
  const obs = [r.contacto ? "Habló con: "+r.contacto : null,
               r.observaciones && !/^no$/i.test(r.observaciones.trim()) ? r.observaciones : null].filter(Boolean).join(" · ");
  if (obs) props["Observaciones"] = obs;
  const esp = v.especiales.map((e,i) => r["esp_"+i] ? `${e.p} → ${r["esp_"+i]}` : null).filter(Boolean).join("\n");
  if (esp) props["Preguntas especiales"] = esp;
  try {
    await S.mcp.callTool(NOTION,"notion-create-pages",{ parent:{ data_source_id: DS.visitas }, pages:[{ properties: props }]});
  } catch(e){ return { ok:false, motivo: (e && e.code) || "error" }; }

  if (r.competencia_quien && aplica({omite:true}, r)) {
    const cp = {
      "Registro": `${calzar(r.competencia_quien, COMPETIDORES) || r.competencia_quien} — ${r.competencia_familia || "sin familia"}`,
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

async function cerrar(){
  limpiarBotonera();
  S.visita.estado = "COMPLETA"; S.visita.fin = new Date().toISOString();
  $("#acciones").hidden = true;
  pensando(true);
  const v = JSON.parse(JSON.stringify(S.visita));
  let nota = "";
  const n = await guardarEnNotion(v);
  if (n.ok) nota = "Quedó cargada en Notion, en Visitas relevadas.";
  else if (n.motivo === "sin-notion") nota = "Quedó guardada acá. Notion no está conectado en este teléfono.";
  else nota = "Quedó guardada acá. Notion rechazó la escritura (" + n.motivo + ").";
  if (S.db){
    try { await S.db.collection("visitas").doc(v.inicio.replace(/[:.]/g,"-")+"-"+normal(v.cliente).slice(0,24).replace(/ /g,"-")).set(v); }
    catch(_){ nota += " No pude guardar la copia local."; }
  }
  pensando(false);
  burbuja("bot", "Listo. " + nota);
  botonera(["Volver a mis clientes"], () => irA("lista"));
}
function cancelar(){
  limpiarBotonera(); S.visita.estado = "CANCELADA"; $("#acciones").hidden = true;
  burbuja("sistema","Visita cancelada.");
  botonera(["Volver a mis clientes"], () => irA("lista"));
}

/* --- oficina --- */
async function pintarOficina(){
  const L = $("#oficina"); L.textContent = "";
  if (S.aviso) L.append(avisoEl(S.aviso));
  if (!S.db){ L.append(el("p","vacio","Las visitas se guardan cuando abrís esta página con tu cuenta de Claude.")); return; }
  let docs = [];
  try { const r = await S.db.collection("visitas").orderBy("inicio","desc").limit(40).get(); docs = r.docs || r || []; }
  catch(_){ L.append(el("p","vacio","No pude leer las visitas guardadas.")); return; }
  if (!docs.length){ L.append(el("p","vacio","Todavía no hay visitas relevadas. Abrí un cliente y relevá la primera.")); return; }
  docs.forEach(d => {
    const v = d.data ? d.data() : d; const r = v.respuestas || {};
    const c = el("div","vis");
    c.append(el("h3",null,v.cliente));
    const m = el("div","meta");
    m.append(el("span",null,v.vendedor||"–"), el("span",null,"·"), el("span",null,fecha((v.inicio||"").slice(0,10))),
             el("span",null,"·"), el("span",null,v.estado||"–"));
    c.append(m);
    const dl = document.createElement("dl");
    const fila = (k,val) => { if(!val) return; dl.append(el("dt",null,k), el("dd",null,val)); };
    fila("Resultado", r.resultado); fila("Contacto", r.contacto); fila("Stock", r.stock_facbsa);
    fila("Exhibición", r.exhibicion); fila("Competencia", r.competencia_quien);
    if (r.competencia_familia && r.competencia_familia!=="En ninguno")
      fila("Compite en", [r.competencia_familia, r.competencia_participacion, r.competencia_motivo].filter(Boolean).join(" · "));
    fila("Próximo paso", r.proximo_paso); fila("Observaciones", r.observaciones);
    c.append(dl); L.append(c);
  });
}
function avisoEl(txt){ const d = el("div","aviso"); const b=el("b",null,"Nota"); d.append(b, el("span",null,txt)); return d; }

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
        tipo: x["Tipo"] === "Texto libre" || x["Tipo"] === "Foto" ? "texto" : "opciones",
        opciones: (x["Opciones"]||"").split(/<br\s*\/?>|\r?\n/i).map(s=>s.trim()).filter(Boolean),
        obl: x["Obligatoria"] === "__YES__", omite: /competencia_(familia|participacion|precio|motivo)/.test(x["Identificador"]||""),
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

/* --- eventos --- */
$("#q").addEventListener("input", pintarLista);
$("#filtros").addEventListener("click", e => {
  const b = e.target.closest("[data-f]"); if (!b) return;
  S.filtro = b.dataset.f;
  $("#filtros").querySelectorAll("[data-f]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.f===S.filtro)));
  pintarLista();
});
$("#pestanas").addEventListener("click", e => { const b=e.target.closest("[data-vista]"); if(b) irA(b.dataset.vista); });
$("#volver").onclick = () => irA("lista");
$("#cancelar").onclick = cancelar;
$("#cerrar").onclick = () => {
  const faltan = pendientes();
  if (faltan.length){ burbuja("bot", `Todavía faltan ${faltan.length} ${faltan.length===1?"punto":"puntos"}. El primero: ${faltan[0].texto}`); siguiente(); return; }
  cerrar();
};
const entrada = $("#entrada");
entrada.addEventListener("input", () => { entrada.style.height="auto"; entrada.style.height=Math.min(entrada.scrollHeight,120)+"px"; });
entrada.addEventListener("keydown", e => { if (e.key==="Enter" && !e.shiftKey){ e.preventDefault(); mandar(); } });
$("#enviar").onclick = mandar;
function mandar(){
  const t = entrada.value.trim(); if (!t || !S.visita || S.visita.estado!=="EN_CURSO") return;
  entrada.value=""; entrada.style.height="auto"; turno(t);
}

/* --- boot --- */
pintarVendedores();
const guardado = leer("facbsa.vendedor");
if (guardado && VENDEDORES.includes(guardado)){ S.vendedor = guardado; irA("lista"); } else irA("quien");

(async () => {
  const use = (window.claude && window.claude.use) ? window.claude.use.bind(window.claude) : null;
  if (!use){ S.aviso = "Esta página se está viendo fuera de claude.ai: el agente y Notion no responden, pero la ficha y el cuestionario funcionan igual."; return; }
  const [sample, db, mcp] = await Promise.all([
    use("sample").catch(()=>null), use("db").catch(()=>null), use("mcp").catch(()=>null),
  ]);
  S.sample = sample; S.db = db; S.mcp = mcp;
  if (mcp) await cargarDeNotion();
  const partes = [];
  if (!sample) partes.push("el agente conversacional");
  if (!mcp) partes.push("Notion");
  if (partes.length) S.aviso = "No pude conectar " + partes.join(" ni ") + " en este teléfono. El relevamiento funciona igual, con preguntas una por una.";
  else S.aviso = "Conectado: el agente lee lo que dictás y la visita se escribe en Notion" + (S.notionOk ? ", con el cuestionario y los competidores que están cargados ahí." : ".");
  if (S.vista === "oficina") pintarOficina();
})();
