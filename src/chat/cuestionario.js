// Cuestionario base de relevamiento del punto de venta.
//
// Es el que se le hace a TODOS los clientes al terminar la visita. Las
// preguntas especiales que genera el motor de reglas se agregan despues de
// estas.
//
// tipo:
//   opciones -> el vendedor responde con el numero de la opcion
//   texto    -> respuesta libre
//   numero   -> se valida que sea numerico
//   foto     -> acepta imagen (o "saltar")
//
// obligatoria: si es false, el vendedor puede escribir SALTAR.

export const CUESTIONARIO_BASE = [
  {
    id: 'contacto',
    texto: '¿Con quien hablaste? Nombre y cargo.',
    tipo: 'texto',
    obligatoria: true,
  },
  {
    id: 'resultado',
    texto: '¿Como salio la visita?',
    tipo: 'opciones',
    opciones: [
      'Cerre pedido',
      'Quedo cotizacion pendiente',
      'Solo relevamiento / seguimiento',
      'No me atendieron',
      'Visita fallida (cerrado, mudado)',
    ],
    obligatoria: true,
  },
  {
    id: 'stock_facbsa',
    texto: '¿Que stock nuestro tienen hoy en el punto de venta?',
    tipo: 'opciones',
    opciones: ['Bien surtido', 'Stock justo', 'Casi sin stock', 'Sin stock nuestro', 'No pude verlo'],
    obligatoria: true,
  },
  {
    id: 'competencia',
    texto: '¿Que marcas de la competencia viste en el mostrador o deposito? Si no viste ninguna, escribi NINGUNA.',
    tipo: 'texto',
    obligatoria: true,
  },
  {
    id: 'precio_percibido',
    texto: '¿Como ven nuestro precio frente a la competencia?',
    tipo: 'opciones',
    opciones: ['Mas barato', 'Parecido', 'Un poco mas caro', 'Mucho mas caro', 'No se hablo de precio'],
    obligatoria: true,
  },
  {
    id: 'exhibicion',
    texto: '¿Tienen material nuestro a la vista (cartel, folleteria, exhibidor)?',
    tipo: 'opciones',
    opciones: ['Si, bien exhibido', 'Algo, pero poco', 'Nada'],
    obligatoria: true,
  },
  {
    id: 'foto',
    texto: 'Mandame una foto del punto de venta o de la gondola. Si no pudiste sacarla, escribi SALTAR.',
    tipo: 'foto',
    obligatoria: false,
  },
  {
    id: 'proximo_paso',
    texto: '¿Cual es el proximo paso concreto y para cuando? (ej: "mandar cotizacion de 200 jabalinas el lunes")',
    tipo: 'texto',
    obligatoria: true,
  },
  {
    id: 'observaciones',
    texto: 'Ultima: ¿algo mas que la oficina tenga que saber? Si no, escribi NO.',
    tipo: 'texto',
    obligatoria: false,
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
  }));

  const cierre = CUESTIONARIO_BASE.filter((p) => p.id === 'foto' || p.id === 'observaciones').map(
    (p) => ({ ...p, origen: 'base', reglaId: null })
  );

  return [...base, ...especiales, ...cierre];
}

// Formatea una pregunta para mandarla por WhatsApp.
export function formatearPregunta(pregunta, indice, total) {
  const L = [`*${indice}/${total}* · ${pregunta.texto}`];

  if (pregunta.contexto) {
    L.push('');
    L.push(`_${pregunta.contexto}_`);
  }

  if (pregunta.tipo === 'opciones' && pregunta.opciones) {
    L.push('');
    pregunta.opciones.forEach((op, i) => L.push(`*${i + 1}.* ${op}`));
    L.push('');
    L.push('_Respondé con el número._');
  }

  if (!pregunta.obligatoria) {
    L.push('');
    L.push('_Podés escribir SALTAR para omitirla._');
  }

  return L.join('\n');
}

// Valida y normaliza lo que contesto el vendedor.
// Devuelve { ok, valor, respuesta, error }
export function validarRespuesta(pregunta, entrada) {
  const texto = String(entrada?.texto ?? '').trim();
  const esFoto = entrada?.tipo === 'image';

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
    return { ok: false, error: 'Mandame la foto o escribi SALTAR.' };
  }

  if (!texto) {
    return { ok: false, error: 'No me llego texto. Probá de nuevo.' };
  }

  if (pregunta.tipo === 'opciones') {
    const numero = Number(texto);
    if (Number.isInteger(numero) && numero >= 1 && numero <= pregunta.opciones.length) {
      const opcion = pregunta.opciones[numero - 1];
      return { ok: true, valor: opcion, respuesta: opcion };
    }
    // Tambien aceptamos que escriba la opcion con palabras.
    const coincidencia = pregunta.opciones.find((op) =>
      op.toLowerCase().includes(texto.toLowerCase())
    );
    if (coincidencia && texto.length >= 3) {
      return { ok: true, valor: coincidencia, respuesta: coincidencia };
    }
    return {
      ok: false,
      error: `Respondeme con un numero del 1 al ${pregunta.opciones.length}.`,
    };
  }

  if (pregunta.tipo === 'numero') {
    const numero = Number(texto.replace(/\./g, '').replace(',', '.'));
    if (Number.isNaN(numero)) return { ok: false, error: 'Necesito un numero.' };
    return { ok: true, valor: String(numero), respuesta: texto };
  }

  if (texto.length < 2) {
    return { ok: false, error: 'Contame un poco mas, con una palabra no alcanza.' };
  }

  return { ok: true, valor: null, respuesta: texto };
}
