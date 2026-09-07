// Cuestionario base de relevamiento del punto de venta.
//
// Es el que se le hace a TODOS los clientes al terminar la visita. Las
// preguntas especiales que genera el motor de reglas se agregan despues.
//
// tipo:
//   opciones -> se manda como botonera de WhatsApp (o lista, si son mas de 3)
//   texto    -> respuesta libre
//   numero   -> se valida que sea numerico
//   foto     -> acepta imagen (o "saltar")
//
// obligatoria: si es false, el vendedor puede escribir SALTAR.
//
// IMPORTANTE: los titulos de las opciones no pueden pasar de 20 caracteres.
// Es el limite de los botones de WhatsApp; si se pasan, Meta rechaza el mensaje.

export const LARGO_MAXIMO_OPCION = 20;

import { OPCIONES_MOTIVO, OPCIONES_PARTICIPACION, OPCIONES_PRECIO } from '../negocio/competencia.js';

export const CUESTIONARIO_BASE = [
  {
    id: 'contacto',
    texto: '¿Con quién hablaste? Nombre y cargo.',
    tipo: 'texto',
    obligatoria: true,
    // Pista para la extraccion automatica desde el audio.
    busca: 'nombre y cargo de la persona con la que hablo el vendedor',
  },
  {
    id: 'resultado',
    texto: '¿Cómo salió la visita?',
    tipo: 'opciones',
    opciones: [
      'Cerré pedido',
      'Cotización pendiente',
      'Solo relevamiento',
      'No me atendieron',
      'Visita fallida',
    ],
    obligatoria: true,
    busca: 'resultado concreto de la visita',
  },
  {
    id: 'stock_facbsa',
    texto: '¿Qué stock nuestro tienen hoy en el punto de venta?',
    tipo: 'opciones',
    opciones: ['Bien surtido', 'Stock justo', 'Casi sin stock', 'Sin stock nuestro', 'No pude verlo'],
    obligatoria: true,
    busca: 'cuanto stock de FACBSA hay en el cliente',
  },
  // --- Competencia ---------------------------------------------------------
  // No alcanza con "vi tal marca". Lo que hace falta para poder actuar es
  // quién, en qué producto, cuánto se lleva y por qué. Los cuatro puntos van
  // juntos y en ese orden.
  {
    id: 'competencia_quien',
    texto: '¿A quién más le compran? Nombrá el proveedor. Si nos compran todo a nosotros, escribí NINGUNO.',
    tipo: 'texto',
    obligatoria: true,
    busca: 'qué otros proveedores le venden a este cliente',
  },
  {
    id: 'competencia_familia',
    // Sin competencia declarada, estos cuatro puntos no van.
    omitirSi: { pregunta: 'competencia_quien', valorCoincide: '^(ninguno|ninguna|no|nadie|nada)\\b' },
    texto: '¿En qué producto nos compite?',
    tipo: 'opciones',
    opciones: [
      'Jabalinas',
      'Tomacables',
      'Cable IRAM 2467',
      'Pararrayos',
      'Soldadura exotérm.',
      'Conectores',
      'Conjuntos',
      'En ninguno',
    ],
    obligatoria: true,
    busca: 'en qué familia de producto nos compite ese proveedor',
  },
  {
    id: 'competencia_participacion',
    // Sin competencia declarada, estos cuatro puntos no van.
    omitirSi: { pregunta: 'competencia_quien', valorCoincide: '^(ninguno|ninguna|no|nadie|nada)\\b' },
    texto: '¿Qué parte de ese producto le compran a él?',
    tipo: 'opciones',
    opciones: [...OPCIONES_PARTICIPACION, 'No aplica'],
    obligatoria: true,
    busca: 'qué porción del consumo se lleva la competencia',
  },
  {
    id: 'competencia_precio',
    // Sin competencia declarada, estos cuatro puntos no van.
    omitirSi: { pregunta: 'competencia_quien', valorCoincide: '^(ninguno|ninguna|no|nadie|nada)\\b' },
    texto: '¿Cómo está el precio de él contra el nuestro?',
    tipo: 'opciones',
    opciones: [...OPCIONES_PRECIO, 'No aplica'],
    obligatoria: true,
    busca: 'brecha de precio contra la competencia',
  },
  {
    id: 'competencia_motivo',
    // Sin competencia declarada, estos cuatro puntos no van.
    omitirSi: { pregunta: 'competencia_quien', valorCoincide: '^(ninguno|ninguna|no|nadie|nada)\\b' },
    texto: '¿Por qué le compran a él y no a nosotros?',
    tipo: 'opciones',
    opciones: [...OPCIONES_MOTIVO, 'No aplica'],
    obligatoria: true,
    busca: 'motivo por el que el cliente le compra a la competencia',
  },
  {
    id: 'exhibicion',
    texto: '¿Tienen material nuestro a la vista (cartel, folletería, exhibidor)?',
    tipo: 'opciones',
    opciones: ['Sí, bien exhibido', 'Algo, pero poco', 'Nada'],
    obligatoria: true,
    busca: 'si hay cartelería o material de FACBSA a la vista',
  },
  {
    id: 'foto',
    texto: 'Mandame una foto del punto de venta o de la góndola. Si no pudiste sacarla, escribí SALTAR.',
    tipo: 'foto',
    obligatoria: false,
  },
  {
    id: 'proximo_paso',
    texto: '¿Cuál es el próximo paso concreto y para cuándo? (ej: "mandar cotización de 200 jabalinas el lunes")',
    tipo: 'texto',
    obligatoria: true,
    busca: 'proximo paso comprometido y su fecha',
  },
  {
    id: 'observaciones',
    texto: 'Última: ¿algo más que la oficina tenga que saber? Si no, escribí NO.',
    tipo: 'texto',
    obligatoria: false,
    busca: 'cualquier otro dato relevante que haya mencionado',
  },
];

// Arma la lista completa de preguntas de una visita: primero el relevamiento de
// rutina, despues lo especifico de este cliente. La foto y las observaciones
// quedan al final para que el vendedor no las use como excusa para cortar.
export function armarCuestionario(preguntasEspeciales = []) {
  const base = CUESTIONARIO_BASE.filter((p) => p.id !== 'foto' && p.id !== 'observaciones').map(
    (p) => ({ ...p, origen: 'base', reglaId: null })
  );

  const especiales = preguntasEspeciales.map((p, i) => ({
    id: `especial_${i + 1}`,
    texto: p.pregunta,
    contexto: p.motivo,
    tipo: p.tipo || 'texto',
    opciones: p.opciones || null,
    obligatoria: true,
    origen: 'especial',
    reglaId: p.id,
    busca: p.pregunta,
  }));

  const cierre = CUESTIONARIO_BASE.filter((p) => p.id === 'foto' || p.id === 'observaciones').map(
    (p) => ({ ...p, origen: 'base', reglaId: null })
  );

  return [...base, ...especiales, ...cierre];
}

/**
 * Un punto puede depender de otro: si el vendedor dijo que no le compran a
 * nadie más, las preguntas de competencia no aplican. Lo usan tanto el flujo
 * guiado como el cálculo de pendientes del agente, para que los dos coincidan
 * en qué falta.
 */
export function puntoAplica(punto, respuestas = {}) {
  const cond = punto.omitirSi;
  if (!cond) return true;
  const dada = respuestas[cond.pregunta];
  if (dada === undefined || dada === null) return true; // todavía no se sabe
  return !new RegExp(cond.valorCoincide, 'i').test(String(dada).trim());
}

// --- Presentacion ------------------------------------------------------------

/**
 * Convierte una pregunta en un mensaje listo para mandar.
 * Devuelve { texto, botones? , lista? }:
 *   hasta 3 opciones -> botonera (interactive/button)
 *   4 a 10 opciones  -> lista desplegable (interactive/list)
 * El transporte (WhatsApp o simulador) decide como renderizarlo.
 */
export function formatearPregunta(pregunta, indice, total) {
  const L = [`*${indice}/${total}* · ${pregunta.texto}`];

  if (pregunta.contexto) {
    L.push('');
    L.push(`_${pregunta.contexto}_`);
  }
  if (!pregunta.obligatoria) {
    L.push('');
    L.push('_Podés escribir SALTAR para omitirla._');
  }

  const mensaje = { texto: L.join('\n') };

  if (pregunta.tipo === 'opciones' && pregunta.opciones?.length) {
    const filas = pregunta.opciones.map((op, i) => ({ id: `op_${i + 1}`, titulo: op }));
    if (filas.length <= 3) {
      mensaje.botones = filas;
    } else {
      mensaje.lista = { boton: 'Elegir', filas };
    }
  }

  return mensaje;
}

// --- Validacion --------------------------------------------------------------

/**
 * Valida y normaliza lo que contesto el vendedor.
 * `entrada` puede traer texto, una foto, o el id de un boton (opcionId).
 * Devuelve { ok, valor, respuesta, error }
 */
export function validarRespuesta(pregunta, entrada) {
  const texto = String(entrada?.texto ?? '').trim();
  const esFoto = entrada?.tipo === 'image';

  // Respuesta por boton o por lista: viene el id, no hay ambigüedad.
  if (entrada?.opcionId && pregunta.tipo === 'opciones') {
    const indice = Number(String(entrada.opcionId).replace('op_', ''));
    const opcion = pregunta.opciones?.[indice - 1];
    if (opcion) return { ok: true, valor: opcion, respuesta: opcion };
  }

  const pidioSaltar = /^(saltar|omitir|paso|-)$/i.test(texto);

  if (pidioSaltar) {
    if (!pregunta.obligatoria) {
      return { ok: true, valor: null, respuesta: '(omitida)' };
    }
    // Las preguntas especiales son las que justifican la visita: si el vendedor
    // no las contesta, el relevamiento no sirve para nada.
    return {
      ok: false,
      error:
        pregunta.origen === 'especial'
          ? 'Esta no la puedo saltear: es la que pidió la oficina para este cliente. Si no pudiste averiguarlo, escribí por qué.'
          : 'Esta pregunta es obligatoria. Si no la pudiste ver, escribí por qué.',
    };
  }

  if (pregunta.tipo === 'foto') {
    if (esFoto) return { ok: true, valor: 'foto', respuesta: entrada.caption || '(foto)' };
    if (texto) return { ok: true, valor: null, respuesta: texto };
    return { ok: false, error: 'Mandame la foto o escribí SALTAR.' };
  }

  if (!texto) {
    return { ok: false, error: 'No me llegó texto. Probá de nuevo.' };
  }

  if (pregunta.tipo === 'opciones') {
    // Aunque haya botonera, algunos vendedores contestan escribiendo. Aceptamos
    // el numero de opcion y tambien el texto de la opcion.
    const numero = Number(texto);
    if (Number.isInteger(numero) && numero >= 1 && numero <= pregunta.opciones.length) {
      const opcion = pregunta.opciones[numero - 1];
      return { ok: true, valor: opcion, respuesta: opcion };
    }
    const coincidencia = pregunta.opciones.find((op) =>
      op.toLowerCase().includes(texto.toLowerCase())
    );
    if (coincidencia && texto.length >= 3) {
      return { ok: true, valor: coincidencia, respuesta: coincidencia };
    }
    return { ok: false, error: 'Elegí una de las opciones de arriba.' };
  }

  if (pregunta.tipo === 'numero') {
    const numero = Number(texto.replace(/\./g, '').replace(',', '.'));
    if (Number.isNaN(numero)) return { ok: false, error: 'Necesito un número.' };
    return { ok: true, valor: String(numero), respuesta: texto };
  }

  if (texto.length < 2) {
    return { ok: false, error: 'Contame un poco más, con una palabra no alcanza.' };
  }

  return { ok: true, valor: null, respuesta: texto };
}
