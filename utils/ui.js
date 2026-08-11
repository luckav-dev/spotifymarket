'use strict';

const {
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    SectionBuilder,
    ThumbnailBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require('discord.js');

/**
 * Lenguaje visual del bot. Todo container sale de aqui.
 *
 * Sin accent color en ningun sitio: la jerarquia se construye con emojis,
 * markdown y separadores. No anadas setAccentColor aqui ni en los modulos.
 *
 * Tres niveles de jerarquia y ni uno mas, para que todos los paneles se lean
 * igual:
 *
 *   ## emoji TITULO        cabecera de panel        cabecera()
 *   **Etiqueta:** valor    dato dentro del panel    campos()
 *   -# nota                apunte al pie            pie()
 */

/** Flags para envios normales. */
const V2 = MessageFlags.IsComponentsV2;

/** Flags para respuestas efimeras. ephemeral: true esta obsoleto. */
const V2_EFIMERO = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

/** Limites reales de Discord, para no descubrirlos con un Invalid Form Body. */
const LIMITES = {
    caracteres: 4000,
    componentes: 40,
    filas: 5,
    botonesPorFila: 5,
    imagenesPorGaleria: 10,
    etiquetaBoton: 80,
    customId: 100
};

const ESTILOS = {
    primario: ButtonStyle.Primary,
    secundario: ButtonStyle.Secondary,
    exito: ButtonStyle.Success,
    peligro: ButtonStyle.Danger,
    enlace: ButtonStyle.Link
};

// ---------------------------------------------------------------- texto plano

/**
 * Recorta sin cortar una palabra por la mitad y sin dejar el caracter de
 * elipsis pegado a un espacio.
 * @param {string} texto
 * @param {number} max
 */
function truncar(texto, max) {
    const limpio = String(texto ?? '');
    if (limpio.length <= max) return limpio;

    const corte = limpio.slice(0, max - 1);
    const espacio = corte.lastIndexOf(' ');
    return `${(espacio > max * 0.6 ? corte.slice(0, espacio) : corte).trimEnd()}…`;
}

/** Escapa el markdown de un texto que viene del usuario. */
function plano(texto) {
    return String(texto ?? '').replace(/([*_`~|\\>])/g, '\\$1');
}

/** Valor en codigo inline. Para IDs, cifras y cualquier dato literal. */
function dato(valor) {
    const texto = String(valor ?? '');
    return texto ? `\`${texto.replace(/`/g, 'ˋ')}\`` : '`—`';
}

/** Bloque de codigo. */
function bloque(texto, lenguaje = '') {
    return `\`\`\`${lenguaje}\n${String(texto ?? '').replace(/```/g, "'''")}\n\`\`\``;
}

/** Texto pequeno de Discord. Para notas al pie, nunca para informacion critica. */
function pie(texto) {
    return `-# ${texto}`;
}

/** Cita. Multilinea: prefija todas las lineas, no solo la primera. */
function cita(texto) {
    return String(texto ?? '').split('\n').map(l => `> ${l}`).join('\n');
}

/** Lista con vinetas. Acepta strings o { emoji, texto } ya resueltos. */
function lista(items) {
    return items
        .filter(Boolean)
        .map(i => (typeof i === 'string' ? `- ${i}` : `- ${i.emoji ? `${i.emoji} ` : ''}${i.texto}`))
        .join('\n');
}

/** Miles con punto, como se escribe en espanol. */
function numero(valor) {
    return Number(valor ?? 0).toLocaleString('es-ES');
}

/** Timestamp de Discord, se localiza solo en el cliente de cada usuario. */
function fecha(ms, estilo = 'R') {
    return `<t:${Math.floor(ms / 1000)}:${estilo}>`;
}

/**
 * Duracion legible a partir de milisegundos: "2 d 4 h", "15 min".
 * Solo las dos unidades mas significativas — "1 d 3 h 12 min 8 s" no lo lee nadie.
 */
function duracion(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    if (!total) return '0 s';

    const partes = [
        { etiqueta: 'd', valor: Math.floor(total / 86400) },
        { etiqueta: 'h', valor: Math.floor((total % 86400) / 3600) },
        { etiqueta: 'min', valor: Math.floor((total % 3600) / 60) },
        { etiqueta: 's', valor: total % 60 }
    ].filter(p => p.valor > 0);

    return partes.slice(0, 2).map(p => `${p.valor} ${p.etiqueta}`).join(' ');
}

/**
 * Barra de progreso con bloques. Sin color disponible, la unica forma de que
 * una proporcion se lea de un vistazo es que ocupe espacio.
 * @param {number} actual
 * @param {number} total
 * @param {number} ancho  Numero de bloques.
 */
function barra(actual, total, ancho = 12) {
    if (!total || total < 0) return '─'.repeat(ancho);

    const proporcion = Math.min(Math.max(actual / total, 0), 1);
    const llenos = Math.round(proporcion * ancho);
    return `${'█'.repeat(llenos)}${'░'.repeat(ancho - llenos)}`;
}

// ------------------------------------------------------------- bloques de texto

/**
 * Cabecera de panel: titulo con icono y, opcionalmente, una linea de contexto.
 * Es el unico sitio donde se usa `##`.
 *
 * @param {object} emojis  EmojiManager
 * @param {{ emoji?: string, titulo: string, subtitulo?: string }} opciones
 * @returns {TextDisplayBuilder}
 */
function cabecera(emojis, { emoji, titulo, subtitulo }) {
    const icono = emoji ? emojis.rol(emoji) : '';
    const lineas = [`## ${icono ? `${icono} ` : ''}${titulo}`];
    if (subtitulo) lineas.push(subtitulo);

    return new TextDisplayBuilder().setContent(lineas.join('\n'));
}

/**
 * Bloque de campos etiqueta/valor. Sustituye a addFields del embed.
 *
 * El emoji se pasa como ROL, no como nombre de archivo: asi cambiar el icono
 * de "precio" en todo el bot es tocar config/emojis.json.
 *
 * @param {object} emojis
 * @param {Array<{ emoji?: string, etiqueta: string, valor: string|number, codigo?: boolean }>} filas
 * @returns {TextDisplayBuilder}
 */
function contenidoCampos(emojis, filas) {
    return filas
        .filter(Boolean)
        .map(f => {
            const icono = f.emoji ? emojis.rol(f.emoji) : '';
            const valor = f.codigo ? dato(f.valor) : f.valor;
            return `${icono ? `${icono} ` : ''}**${f.etiqueta}:** ${valor}`;
        })
        .join('\n');
}

function campos(emojis, filas) {
    return new TextDisplayBuilder().setContent(contenidoCampos(emojis, filas));
}

/** Cualquier texto suelto como componente. */
function texto(contenido) {
    return new TextDisplayBuilder().setContent(contenido);
}

// --------------------------------------------------------------- separadores

/** Separador sin linea, solo aire. Para agrupar sin cortar. */
function aire(grande = false) {
    return new SeparatorBuilder()
        .setDivider(false)
        .setSpacing(grande ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);
}

/** Separador con linea. Para cortar de verdad entre secciones. */
function linea(grande = true) {
    return new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(grande ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);
}

// -------------------------------------------------------------------- botones

/**
 * Aplica un emoji a un boton solo si existe.
 *
 * rol() y get() devuelven cadena vacia cuando falta el .png, y setEmoji('')
 * no pasa la validacion de discord.js: sin esta guarda, un icono ausente
 * tumbaria el mensaje entero en vez de mostrarse sin icono.
 */
function conEmoji(boton, emoji) {
    return emoji ? boton.setEmoji(emoji) : boton;
}

/**
 * Boton declarativo. Los customId siguen el esquema dominio:accion:dato.
 *
 * @param {object} emojis
 * @param {{ id?: string, url?: string, etiqueta?: string, estilo?: string,
 *           emoji?: string, desactivado?: boolean }} opciones
 * @returns {ButtonBuilder}
 */
function boton(emojis, { id, url, etiqueta, estilo = 'secundario', emoji, desactivado = false }) {
    const builder = new ButtonBuilder().setStyle(ESTILOS[estilo] ?? ButtonStyle.Secondary);

    if (etiqueta) builder.setLabel(truncar(etiqueta, LIMITES.etiquetaBoton));
    if (url) builder.setURL(url);
    else builder.setCustomId(id);
    if (desactivado) builder.setDisabled(true);

    return conEmoji(builder, emoji ? emojis.rol(emoji) : '');
}

/** Fila de botones. Ignora los huecos para poder componerla con condicionales. */
function fila(...botones) {
    return new ActionRowBuilder().addComponents(botones.flat().filter(Boolean));
}

/**
 * Controles de paginacion. La pagina se numera desde 0 y se muestra desde 1,
 * porque el usuario no cuenta como un array.
 *
 * @param {object} emojis
 * @param {{ dominio: string, accion: string, pagina: number, total: number, dato?: string }} opciones
 */
function paginador(emojis, { dominio, accion, pagina, total, dato: extra = '' }) {
    const sufijo = extra ? `:${extra}` : '';
    const id = p => `${dominio}:${accion}:${p}${sufijo}`;

    return fila(
        boton(emojis, {
            id: id(pagina - 1),
            etiqueta: 'Anterior',
            emoji: 'anterior',
            desactivado: pagina <= 0
        }),
        boton(emojis, {
            id: `${dominio}:nada`,
            etiqueta: `${pagina + 1} / ${Math.max(total, 1)}`,
            desactivado: true
        }),
        boton(emojis, {
            id: id(pagina + 1),
            etiqueta: 'Siguiente',
            desactivado: pagina >= total - 1
        })
    );
}

// ------------------------------------------------------------------ secciones

/**
 * Seccion con un boton a la derecha. Es la forma de dar accion a una fila sin
 * gastar una ActionRow entera.
 */
function seccionBoton(contenido, botonAccesorio) {
    return new SectionBuilder()
        .addTextDisplayComponents(texto(contenido))
        .setButtonAccessory(botonAccesorio);
}

/** Seccion con miniatura a la derecha. Para avatares e imagenes de producto. */
function seccionMiniatura(contenido, url, descripcion) {
    const thumb = new ThumbnailBuilder().setURL(url);
    if (descripcion) thumb.setDescription(truncar(descripcion, 256));

    return new SectionBuilder()
        .addTextDisplayComponents(texto(contenido))
        .setThumbnailAccessory(thumb);
}

/** Galeria de imagenes. Acepta URLs https y adjuntos attachment://nombre. */
function galeria(urls, descripcion) {
    return new MediaGalleryBuilder().addItems(
        urls.slice(0, LIMITES.imagenesPorGaleria).map(url => {
            const item = new MediaGalleryItemBuilder().setURL(url);
            if (descripcion) item.setDescription(truncar(descripcion, 256));
            return item;
        })
    );
}

// ---------------------------------------------------------------- containers

/** Container de un solo bloque de texto. */
function simple(contenido) {
    return new ContainerBuilder().addTextDisplayComponents(texto(contenido));
}

/**
 * Container de estado: un icono y una frase. Es la respuesta por defecto a
 * cualquier accion, y por eso tiene que ser identica en todo el bot.
 */
function estado(emojis, rol, contenido) {
    const icono = emojis.rol(rol);
    return simple(`${icono ? `${icono} ` : ''}${contenido}`);
}

const exito = (emojis, t) => estado(emojis, 'exito', t);
const error = (emojis, t) => estado(emojis, 'error', t);
const aviso = (emojis, t) => estado(emojis, 'aviso', t);
const info = (emojis, t) => estado(emojis, 'info', t);
const cargando = (emojis, t) => estado(emojis, 'cargando', t);

/**
 * Panel completo: cabecera, cuerpo y pie, con los separadores ya puestos.
 *
 * Concentrar aqui el orden y el espaciado es lo que hace que dos paneles
 * escritos por dos personas distintas salgan iguales.
 *
 * @param {object} emojis
 * @param {{ emoji?: string, titulo: string, subtitulo?: string,
 *           cuerpo?: Array, pie?: string, acciones?: Array }} opciones
 * @returns {ContainerBuilder}
 */
function panel(emojis, { emoji, titulo, subtitulo, cuerpo = [], pie: notaPie, acciones = [] }) {
    const c = new ContainerBuilder();

    c.addTextDisplayComponents(cabecera(emojis, { emoji, titulo, subtitulo }));

    const partes = cuerpo.filter(Boolean);
    if (partes.length) {
        c.addSeparatorComponents(linea());
        for (const parte of partes) anadir(c, parte);
    }

    const filas = acciones.filter(Boolean);
    if (filas.length) {
        c.addSeparatorComponents(linea());
        for (const f of filas) c.addActionRowComponents(f);
    }

    if (notaPie) {
        c.addSeparatorComponents(aire());
        c.addTextDisplayComponents(texto(pie(notaPie)));
    }

    return c;
}

/**
 * Anade un componente al container despachando por su tipo.
 * Permite que panel() acepte una lista heterogenea sin que quien la escribe
 * tenga que acordarse del metodo exacto de cada uno.
 */
function anadir(container, parte) {
    if (typeof parte === 'string') return container.addTextDisplayComponents(texto(parte));
    if (parte instanceof TextDisplayBuilder) return container.addTextDisplayComponents(parte);
    if (parte instanceof SeparatorBuilder) return container.addSeparatorComponents(parte);
    if (parte instanceof SectionBuilder) return container.addSectionComponents(parte);
    if (parte instanceof MediaGalleryBuilder) return container.addMediaGalleryComponents(parte);
    if (parte instanceof ActionRowBuilder) return container.addActionRowComponents(parte);
    return container;
}

/**
 * Container de confirmacion con botones Confirmar / Cancelar.
 * Sin color: lo peligroso se marca con el emoji y el estilo del boton.
 */
function confirmar(emojis, {
    titulo, descripcion, idConfirmar, idCancelar, peligroso = false,
    etiquetaConfirmar = 'Confirmar', etiquetaCancelar = 'Cancelar', pie: textoPie
}) {
    return panel(emojis, {
        emoji: peligroso ? 'aviso' : 'pregunta',
        titulo,
        cuerpo: [cita(descripcion)],
        acciones: [
            fila(
                boton(emojis, {
                    id: idConfirmar,
                    etiqueta: etiquetaConfirmar,
                    estilo: peligroso ? 'peligro' : 'exito',
                    emoji: 'confirmar'
                }),
                boton(emojis, {
                    id: idCancelar,
                    etiqueta: etiquetaCancelar,
                    estilo: 'secundario',
                    emoji: 'cancelar'
                })
            )
        ],
        pie: textoPie ?? (peligroso ? 'Esta accion no se puede deshacer.' : undefined)
    });
}

// ------------------------------------------------------------------- respuesta

/**
 * Responde sin tener que saber si la interaccion ya fue diferida o respondida.
 * Ojo: editReply no acepta MessageFlags.Ephemeral - eso se decide en deferReply.
 */
async function responder(interaction, opciones) {
    if (interaction.deferred || interaction.replied) {
        return interaction.editReply(opciones);
    }
    return interaction.reply(opciones);
}

/** Atajo para el caso mas comun: un container efimero. */
async function responderEfimero(interaction, container) {
    return responder(interaction, {
        components: [container],
        // Ephemeral solo se puede decidir en la respuesta inicial. Al editar
        // una respuesta ya diferida se conserva automaticamente y Discord
        // solo admite volver a declarar el flag de Components V2.
        flags: interaction.deferred || interaction.replied ? V2 : V2_EFIMERO,
        allowedMentions: { parse: [] }
    });
}

module.exports = {
    V2, V2_EFIMERO, LIMITES, ESTILOS,

    // texto
    truncar, plano, dato, bloque, pie, cita, lista, numero, fecha, duracion, barra,

    // componentes
    cabecera, contenidoCampos, campos, texto, aire, linea,
    conEmoji, boton, fila, paginador,
    seccionBoton, seccionMiniatura, galeria,

    // containers
    simple, estado, exito, error, aviso, info, cargando, panel, confirmar, anadir,

    // respuesta
    responder, responderEfimero
};
