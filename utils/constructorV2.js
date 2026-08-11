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
    ButtonStyle
} = require('discord.js');

const ui = require('./ui');

/**
 * Convierte una descripcion declarativa de bloques en un Container V2.
 *
 * Es la pieza que usan el compositor de anuncios del dashboard y las
 * borradores: el mensaje se guarda como datos, no como codigo, asi se puede
 * editar, previsualizar y volver a enviar sin tocar el bot.
 */

/** Limites de Discord. Superarlos devuelve Invalid Form Body sin detalle util. */
const LIMITES = {
    caracteres: 4000,
    componentes: 40,
    filas: 5,
    botonesPorFila: 5,
    imagenesPorGaleria: 10,
    etiquetaBoton: 80
};

const ESTILOS = {
    primario: ButtonStyle.Primary,
    secundario: ButtonStyle.Secondary,
    exito: ButtonStyle.Success,
    peligro: ButtonStyle.Danger,
    enlace: ButtonStyle.Link
};

const ESPACIADOS = {
    pequeno: SeparatorSpacingSize.Small,
    grande: SeparatorSpacingSize.Large
};

const TIPOS = new Set(['titulo', 'texto', 'separador', 'imagenes', 'seccion', 'botones']);

function esUrlValida(valor) {
    return typeof valor === 'string' && /^https:\/\/\S+$/i.test(valor.trim());
}

function textoDeTitulo({ texto, nivel = 1 }) {
    const almohadillas = '#'.repeat(Math.min(Math.max(Number(nivel) || 1, 1), 3));
    return `${almohadillas} ${texto}`;
}

/**
 * Revisa la descripcion antes de construir nada.
 *
 * Devolver los errores juntos en vez de lanzar en el primero permite que el
 * dashboard los pinte todos a la vez, en lugar de que el usuario los descubra
 * de uno en uno.
 *
 * @param {Array<object>} bloques
 * @returns {string[]} Lista de problemas. Vacia si la descripcion es valida.
 */
function validar(bloques) {
    const problemas = [];

    if (!Array.isArray(bloques) || !bloques.length) {
        return ['El anuncio no tiene ningun bloque.'];
    }

    let caracteres = 0;
    let componentes = 1; // el propio container
    let filas = 0;

    bloques.forEach((bloque, i) => {
        const donde = `Bloque ${i + 1}`;

        if (!TIPOS.has(bloque?.tipo)) {
            problemas.push(`${donde}: tipo '${bloque?.tipo}' desconocido.`);
            return;
        }

        componentes++;

        switch (bloque.tipo) {
            case 'titulo': {
                if (!bloque.texto?.trim()) problemas.push(`${donde}: el titulo esta vacio.`);
                caracteres += textoDeTitulo(bloque).length;
                break;
            }

            case 'texto': {
                if (!bloque.contenido?.trim()) problemas.push(`${donde}: el texto esta vacio.`);
                caracteres += (bloque.contenido ?? '').length;
                break;
            }

            case 'separador':
                break;

            case 'imagenes': {
                const urls = bloque.urls ?? [];
                if (!urls.length) problemas.push(`${donde}: no hay ninguna imagen.`);
                if (urls.length > LIMITES.imagenesPorGaleria) {
                    problemas.push(`${donde}: ${urls.length} imagenes y el maximo son ${LIMITES.imagenesPorGaleria}.`);
                }
                for (const url of urls) {
                    if (!esUrlValida(url)) problemas.push(`${donde}: '${url}' no es una URL https valida.`);
                }
                break;
            }

            case 'seccion': {
                if (!bloque.texto?.trim()) problemas.push(`${donde}: la seccion no tiene texto.`);
                caracteres += (bloque.texto ?? '').length;
                componentes++; // el TextDisplay de dentro

                const tieneBoton = Boolean(bloque.boton);
                const tieneMiniatura = Boolean(bloque.miniatura);

                // Una Section sin accesorio es invalida, y con los dos tambien.
                if (!tieneBoton && !tieneMiniatura) {
                    problemas.push(`${donde}: una seccion necesita un boton o una miniatura.`);
                }
                if (tieneBoton && tieneMiniatura) {
                    problemas.push(`${donde}: una seccion admite un boton o una miniatura, no las dos.`);
                }
                if (tieneMiniatura && !esUrlValida(bloque.miniatura)) {
                    problemas.push(`${donde}: la miniatura no es una URL https valida.`);
                }
                if (tieneBoton) problemas.push(...validarBoton(bloque.boton, donde));

                componentes++; // el accesorio
                break;
            }

            case 'botones': {
                const botones = bloque.botones ?? [];
                filas++;

                if (!botones.length) problemas.push(`${donde}: la fila no tiene botones.`);
                if (botones.length > LIMITES.botonesPorFila) {
                    problemas.push(`${donde}: ${botones.length} botones en una fila y el maximo son ${LIMITES.botonesPorFila}.`);
                }
                botones.forEach((boton, j) => problemas.push(...validarBoton(boton, `${donde}, boton ${j + 1}`)));

                componentes += botones.length;
                break;
            }

            default:
                break;
        }
    });

    if (caracteres > LIMITES.caracteres) {
        problemas.push(`El anuncio suma ${caracteres} caracteres y el maximo son ${LIMITES.caracteres}.`);
    }
    if (componentes > LIMITES.componentes) {
        problemas.push(`El anuncio usa ${componentes} componentes y el maximo son ${LIMITES.componentes}.`);
    }
    if (filas > LIMITES.filas) {
        problemas.push(`El anuncio tiene ${filas} filas de botones y el maximo son ${LIMITES.filas}.`);
    }

    return problemas;
}

function validarBoton(boton, donde) {
    const problemas = [];

    if (!boton?.etiqueta?.trim()) {
        problemas.push(`${donde}: el boton no tiene etiqueta.`);
    } else if (boton.etiqueta.length > LIMITES.etiquetaBoton) {
        problemas.push(`${donde}: la etiqueta pasa de ${LIMITES.etiquetaBoton} caracteres.`);
    }

    const estilo = boton?.estilo ?? 'secundario';
    if (!ESTILOS[estilo]) {
        problemas.push(`${donde}: estilo '${estilo}' desconocido.`);
        return problemas;
    }

    // Un boton de enlace lleva URL y no puede llevar customId; el resto al reves.
    if (estilo === 'enlace') {
        if (!esUrlValida(boton.url)) problemas.push(`${donde}: un boton de enlace necesita una URL https.`);
    } else if (!boton.customId?.trim()) {
        problemas.push(`${donde}: un boton que no es de enlace necesita un customId.`);
    } else if (boton.customId.length > 100) {
        problemas.push(`${donde}: el customId pasa de 100 caracteres.`);
    }

    return problemas;
}

function construirBoton(boton, emojis) {
    const estilo = ESTILOS[boton.estilo ?? 'secundario'];
    const builder = new ButtonBuilder()
        .setLabel(boton.etiqueta)
        .setStyle(estilo);

    if (estilo === ButtonStyle.Link) builder.setURL(boton.url);
    else builder.setCustomId(boton.customId);

    return boton.emoji ? ui.conEmoji(builder, emojis.rol(boton.emoji)) : builder;
}

/**
 * Construye el Container. Asume que validar() ya paso: no vuelve a comprobar
 * los limites, solo traduce.
 *
 * @param {Array<object>} bloques
 * @param {object} emojis  EmojiManager, para resolver los iconos por rol
 * @returns {ContainerBuilder}
 */
function construir(bloques, emojis) {
    const c = new ContainerBuilder();

    for (const bloque of bloques) {
        switch (bloque.tipo) {
            case 'titulo':
                c.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(textoDeTitulo(bloque))
                );
                break;

            case 'texto':
                c.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(bloque.contenido)
                );
                break;

            case 'separador':
                c.addSeparatorComponents(
                    new SeparatorBuilder()
                        .setDivider(bloque.linea ?? true)
                        .setSpacing(ESPACIADOS[bloque.espaciado] ?? SeparatorSpacingSize.Large)
                );
                break;

            case 'imagenes':
                c.addMediaGalleryComponents(
                    new MediaGalleryBuilder().addItems(
                        bloque.urls.map(url => new MediaGalleryItemBuilder().setURL(url))
                    )
                );
                break;

            case 'seccion': {
                const seccion = new SectionBuilder().addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(bloque.texto)
                );

                if (bloque.miniatura) {
                    seccion.setThumbnailAccessory(new ThumbnailBuilder().setURL(bloque.miniatura));
                } else {
                    seccion.setButtonAccessory(construirBoton(bloque.boton, emojis));
                }

                c.addSectionComponents(seccion);
                break;
            }

            case 'botones':
                c.addActionRowComponents(
                    new ActionRowBuilder().addComponents(
                        bloque.botones.map(b => construirBoton(b, emojis))
                    )
                );
                break;

            default:
                break;
        }
    }

    return c;
}

/**
 * Valida y construye de una vez.
 * @returns {{ ok: boolean, problemas: string[], carga?: object }}
 */
function preparar(bloques, emojis) {
    const problemas = validar(bloques);
    if (problemas.length) return { ok: false, problemas };

    return {
        ok: true,
        problemas: [],
        carga: { components: [construir(bloques, emojis)], flags: ui.V2 }
    };
}

module.exports = { validar, construir, preparar, LIMITES, ESTILOS, TIPOS };
