// Todos los textos que ve el vendedor. Estan juntos para que Comercial pueda
// corregir el tono sin tocar la logica.

export const TEXTOS = {
  noRegistrado: (telefono) =>
    `Hola. Este numero (${telefono}) no esta habilitado para cargar visitas.\n\n` +
    'Pedile a la oficina que te de de alta y volve a escribir.',

  bienvenida: (nombre) =>
    `Hola ${nombre} 👋\n\n` +
    'Soy el asistente de relevamiento de visitas de FACBSA.\n\n' +
    '*Antes de entrar al cliente*, decime a quien vas a visitar: escribí el nombre o el código.\n\n' +
    '_Ejemplos: "electrica del sur", "C-1042"_',

  pedirCliente:
    '¿A qué cliente vas a visitar? Escribí el nombre o el código.\n\n' +
    '_Si es un cliente nuevo que no está en el sistema, escribí: NUEVO seguido del nombre._',

  sinResultados: (texto) =>
    `No encontré ningún cliente con "${texto}".\n\n` +
    'Probá con menos palabras o con el código.\n' +
    'Si es un prospecto que todavía no está en el sistema, escribí *NUEVO ' +
    `${texto}*.`,

  elegirCliente: 'Encontré varios. ¿Cuál es?\n\n_Respondé con el número, o escribí OTRO para buscar de nuevo._',

  visitaAbierta: (cliente) =>
    `Ya tenés una visita abierta en *${cliente}*.\n\n` +
    'Cuando salgas escribí *FIN* y arrancamos el relevamiento.\n' +
    'Si te equivocaste de cliente, escribí *CANCELAR*.',

  enVisita:
    '✅ Anotado. Andá tranquilo.\n\n' +
    '*Cuando salgas del cliente, escribí FIN* y te tomo el relevamiento.',

  arrancaRelevamiento: (total) =>
    `Listo, vamos con el relevamiento. Son ${total} preguntas cortas.\n\n` +
    '_Podés escribir CANCELAR en cualquier momento (se pierde lo cargado)._',

  cierre: (cliente) =>
    `✅ Relevamiento de *${cliente}* guardado. Gracias.\n\n` +
    'Cuando salgas para el próximo cliente, decime a quién vas a visitar.',

  cancelado: 'Listo, cancelé la visita. Cuando quieras arrancamos de nuevo.',

  nadaQueCancelar: 'No tenés ninguna visita abierta.',

  finSinVisita:
    'No tenés ninguna visita abierta.\n\n' +
    'Primero decime a qué cliente vas a visitar y después, al salir, escribí FIN.',

  ayuda:
    '*Cómo se usa*\n\n' +
    '1️⃣ Antes de entrar al cliente, escribí su nombre o código. Te paso la ficha y qué averiguar adentro.\n' +
    '2️⃣ Cuando salís, escribí *FIN* y te tomo el relevamiento.\n\n' +
    '*Comandos*\n' +
    '• *FIN* — terminé la visita, arrancar el relevamiento\n' +
    '• *FICHA* — volver a ver la ficha del cliente\n' +
    '• *CANCELAR* — anular la visita en curso\n' +
    '• *ESTADO* — en qué quedamos\n' +
    '• *AYUDA* — este mensaje',

  errorInterno:
    'Se me complicó procesando eso. Probá de nuevo en un momento; si sigue igual, avisale a la oficina.',
};
