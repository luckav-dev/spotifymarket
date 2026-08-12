'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const {
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    LabelBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    AttachmentBuilder,
    MessageFlags
} = require('discord.js');

const config = require('../utils/config');
const logger = require('../utils/logger');
const ui = require('../utils/ui');
const media = require('../utils/media');
const Database = require('../utils/jsonDatabase');
const { SellAuthClient } = require('../utils/sellAuthClient');
const arte = require('../utils/sellAuthArtwork');

const ESQUEMA = {
    productos: {},
    productosInicializados: false,
    resenasInicializadas: false,
    resenasVistas: {},
    resenas: {},
    facturasUsadas: {},
    contadorResenas: 0,
    guia: { canalId: '', mensajeId: '' },
    ultimaSincronizacion: 0,
    webhook: { pendientes: {}, procesados: [] },
    estadisticas: {
        sincronizaciones: 0,
        restocks: 0,
        cambiosPrecio: 0,
        resenasSellAuth: 0,
        resenasDiscord: 0,
        errores: 0
    }
};

const MAX_WEBHOOK_BODY = 128 * 1024;
const MAX_WEBHOOK_PROCESADOS = 1000;
const MAX_RESENAS_VISTAS = 2500;

function numero(valor, fallback = 0) {
    const n = Number(valor);
    return Number.isFinite(n) ? n : fallback;
}

function idDe(valor) {
    return String(valor?.id ?? valor?.$id ?? '').trim();
}

function fechaMs(valor) {
    const ms = Date.parse(valor ?? '');
    return Number.isFinite(ms) ? ms : Date.now();
}

function limpiarHtml(texto) {
    return String(texto ?? '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&#039;|&apos;/gi, "'")
        .replace(/&quot;/gi, '"')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function arrayDatos(respuesta) {
    if (Array.isArray(respuesta)) return respuesta;
    return Array.isArray(respuesta?.data) ? respuesta.data : [];
}

function precioVariante(producto, variante) {
    return numero(variante?.price ?? producto?.price, 0);
}

function stockVariante(producto, variante) {
    const valor = variante?.stock ?? producto?.stock ?? producto?.stock_count;
    if (valor === null || valor === undefined || valor === '') return -1;
    return Math.trunc(numero(valor, 0));
}

function urlProducto(ajustes, producto) {
    const base = String(ajustes.storefrontUrl ?? '').replace(/\/+$/, '');
    const slug = String(producto.path ?? '').replace(/^\/+/, '');
    if (!base || !slug) return '';

    return String(ajustes.productPathTemplate || '{storefrontUrl}/product/{path}')
        .replaceAll('{storefrontUrl}', base)
        .replaceAll('{path}', encodeURIComponent(slug));
}

function normalizarProductos(datos, ajustes) {
    const salida = [];
    for (const producto of datos) {
        const variantes = Array.isArray(producto.variants) && producto.variants.length
            ? producto.variants
            : [null];

        for (const variante of variantes) {
            const productId = idDe(producto);
            const variantId = idDe(variante);
            if (!productId) continue;

            const varias = variantes.length > 1;
            const nombreVariante = String(variante?.name ?? '').trim();
            const nombre = varias && nombreVariante
                ? `${producto.name} - ${nombreVariante}`
                : String(producto.name || nombreVariante || `Product ${productId}`);
            const descripcion = limpiarHtml(variante?.description || producto.description)
                || 'Digital product available through Spotify Market.';
            const imagen = producto.images?.find(item => item?.url)?.url ?? '';
            const categoria = producto.category?.name || producto.group?.name || 'Catalog';

            salida.push({
                id: `sa-${productId}-${variantId || 'base'}`,
                sellauthProductId: productId,
                sellauthVariantId: variantId,
                path: String(producto.path ?? ''),
                nombre: limpiarHtml(nombre).slice(0, 100),
                descripcion: descripcion.slice(0, 1200),
                precio: precioVariante(producto, variante),
                moneda: String(producto.currency || 'EUR').toUpperCase(),
                stock: stockVariante(producto, variante),
                categoria: limpiarHtml(categoria).slice(0, 100),
                imagen: /^https:\/\//i.test(imagen) ? imagen : '',
                visible: producto.visibility === 'public',
                checkoutUrl: urlProducto(ajustes, producto),
                productosVendidos: numero(producto.products_sold, 0),
                actualizadoEn: Date.now()
            });
        }
    }
    return salida;
}

function extraerDiscordId(factura) {
    const candidatos = [
        factura?.discord_id,
        factura?.discord_user_id,
        factura?.discord?.id,
        factura?.customer?.discord_id,
        factura?.customer?.discord_user_id,
        factura?.shop_customer?.discord_id,
        factura?.shop_customer?.discord_user_id
    ];
    return candidatos.map(String).find(valor => /^\d{17,20}$/.test(valor)) ?? '';
}

function nombreProductoFactura(factura) {
    const items = Array.isArray(factura?.items) ? factura.items : [];
    const nombres = items.map(item => {
        const producto = item.product?.name || item.product_name || 'Product';
        const variante = item.variant?.name || item.variant_name || '';
        return variante && variante !== producto ? `${producto} - ${variante}` : producto;
    }).filter(Boolean);
    return [...new Set(nombres)].join(', ') || factura?.product?.name || 'SellAuth purchase';
}

class SellAuthSystem {
    constructor(client, emojis) {
        this.client = client;
        this.emojis = emojis;
        this.db = new Database('sellauth', ESQUEMA);
        this.temporizador = null;
        this.servidorWebhook = null;
        this.sincronizando = null;
        this.procesandoWebhooks = null;
        this.colaPublicacion = Promise.resolve();
    }

    get config() {
        return config.cargar('sellauth');
    }

    get api() {
        return new SellAuthClient({
            apiKey: process.env.SELLAUTH_API_KEY,
            shopId: process.env.SELLAUTH_SHOP_ID || this.config.shopId,
            baseUrl: this.config.apiBaseUrl
        });
    }

    estaConfigurado() {
        return Boolean(this.config.enabled && this.api.configurado());
    }

    productos() {
        return Object.values(this.db.data.productos)
            .sort((a, b) => a.categoria.localeCompare(b.categoria) || a.nombre.localeCompare(b.nombre));
    }

    productosVisibles() {
        return this.productos().filter(producto => producto.visible);
    }

    async iniciar() {
        if (!this.config.enabled) {
            logger.detalle('SellAuth desactivado en config/sellauth.json');
            return false;
        }

        if (!this.estaConfigurado()) {
            logger.warn('sellauth', 'Faltan SELLAUTH_API_KEY o SELLAUTH_SHOP_ID: se mantiene el catalogo local.');
            logger.detalle('anade ambos valores al .env para activar la sincronizacion');
        } else {
            try {
                await this.sincronizar({ anunciar: false, importarResenas: this.config.sync.importExistingFeedbacks });
                logger.paso('sellauth', `${this.productos().length} referencias sincronizadas`);
            } catch (error) {
                this.db.data.estadisticas.errores += 1;
                this.db.save();
                logger.error('sellauth', `Sincronizacion inicial fallida: ${error.message}`);
            }

            const intervalo = Math.max(30000, numero(this.config.sync.intervalMs, 90000));
            this.temporizador = setInterval(() => {
                this.sincronizar({ anunciar: true }).catch(error =>
                    logger.error('sellauth', `Sincronizacion periodica fallida: ${error.message}`)
                );
            }, intervalo);
            this.temporizador.unref?.();
        }

        this.iniciarWebhook();
        return true;
    }

    detener() {
        if (this.temporizador) clearInterval(this.temporizador);
        this.temporizador = null;
        this.servidorWebhook?.close();
        this.servidorWebhook = null;
    }

    async sincronizar(opciones = {}) {
        if (!this.estaConfigurado()) throw new Error('La integracion SellAuth no esta configurada.');
        if (this.sincronizando) return this.sincronizando;

        this.sincronizando = (async () => {
            const resultado = { productos: 0, resenas: 0, restocks: 0, cambiosPrecio: 0 };
            if (this.config.sync.products !== false) {
                Object.assign(resultado, await this.sincronizarProductos(opciones));
            }
            if (this.config.sync.feedbacks !== false) {
                resultado.resenas = await this.sincronizarResenas(opciones);
            }
            await this.procesarWebhooksPendientes();

            this.db.data.ultimaSincronizacion = Date.now();
            this.db.data.estadisticas.sincronizaciones += 1;
            this.db.save();
            return resultado;
        })();

        try {
            return await this.sincronizando;
        } finally {
            this.sincronizando = null;
        }
    }

    async sincronizarProductos({ anunciar = true } = {}) {
        const datos = await this.api.todosLosProductos();
        const normalizados = normalizarProductos(datos, this.config);
        const anteriores = this.db.data.productos;
        const nuevoMapa = Object.fromEntries(normalizados.map(producto => [producto.id, producto]));
        const puedeAnunciar = anunciar && this.db.data.productosInicializados;
        let restocks = 0;
        let cambiosPrecio = 0;

        this.db.data.productos = nuevoMapa;
        this.db.data.productosInicializados = true;
        this.db.save();

        if (puedeAnunciar) {
            for (const producto of normalizados) {
                const anterior = anteriores[producto.id];
                if (!anterior) {
                    if (this.config.announcements?.newProducts?.enabled && producto.visible) {
                        await this.publicarAviso('new', producto);
                    }
                    continue;
                }

                if (anterior.stock === 0 && producto.stock !== 0 && producto.visible) {
                    restocks += 1;
                    await this.publicarAviso('restock', producto);
                }
                if (Number(anterior.precio) !== Number(producto.precio) && producto.visible) {
                    cambiosPrecio += 1;
                    await this.publicarAviso('price', producto, anterior.precio);
                }
            }
        }

        this.db.data.estadisticas.restocks += restocks;
        this.db.data.estadisticas.cambiosPrecio += cambiosPrecio;
        this.db.save();
        await this.client.sistemas?.shop?.refrescarPanel?.();

        return { productos: normalizados.length, restocks, cambiosPrecio };
    }

    async sincronizarResenas({ importarResenas = false } = {}) {
        const limite = Math.min(Math.max(numero(this.config.sync.feedbackHistoryLimit, 25), 1), 100);
        const respuesta = await this.api.listarResenas({
            page: 1,
            perPage: limite,
            orderColumn: 'created_at',
            orderDirection: 'desc'
        });
        const resenas = arrayDatos(respuesta);

        if (!this.db.data.resenasInicializadas && !importarResenas) {
            for (const resena of resenas) {
                const id = idDe(resena);
                if (id) this.db.data.resenasVistas[id] = Date.now();
            }
            this.db.data.resenasInicializadas = true;
            this.limitarResenasVistas();
            this.db.save();
            return 0;
        }

        let publicadas = 0;
        for (const resena of [...resenas].reverse()) {
            const id = idDe(resena);
            if (!id || this.db.data.resenasVistas[id]) continue;
            if (await this.publicarResenaSellAuth(resena)) publicadas += 1;
        }

        this.db.data.resenasInicializadas = true;
        this.limitarResenasVistas();
        this.db.save();
        return publicadas;
    }

    limitarResenasVistas() {
        const entradas = Object.entries(this.db.data.resenasVistas)
            .sort((a, b) => Number(b[1]) - Number(a[1]));
        this.db.data.resenasVistas = Object.fromEntries(entradas.slice(0, MAX_RESENAS_VISTAS));
    }

    async enriquecerResena(datos) {
        const invoiceId = String(datos.invoice_id ?? datos.invoice?.id ?? '').trim();
        let factura = datos.invoice ?? null;
        if (invoiceId && (!factura?.items || !factura?.status)) {
            factura = await this.api.obtenerFactura(invoiceId).catch(() => factura);
        }

        return {
            key: `sa-${idDe(datos)}`,
            source: 'sellauth',
            sourceId: idDe(datos),
            invoiceId,
            rating: Math.min(Math.max(Math.trunc(numero(datos.rating, 5)), 1), 5),
            message: limpiarHtml(datos.message || datos.comment || datos.feedback).slice(0, 1600),
            productName: limpiarHtml(datos.product_name || datos.product?.name || nombreProductoFactura(factura)).slice(0, 180),
            variantName: limpiarHtml(datos.variant_name || datos.variant?.name).slice(0, 100),
            userId: extraerDiscordId(factura),
            reply: limpiarHtml(datos.reply).slice(0, 1000),
            status: String(datos.status || 'published'),
            createdAt: fechaMs(datos.created_at),
            updatedAt: fechaMs(datos.updated_at || datos.created_at),
            messageId: '',
            channelId: ''
        };
    }

    async publicarResenaSellAuth(datos) {
        const permitidos = this.config.reviews.publishedFeedbackStatuses ?? ['published'];
        if (datos.status && !permitidos.includes(datos.status)) return false;

        const resena = await this.enriquecerResena(datos);
        if (!resena.sourceId || !resena.message) return false;

        // Si primero se dejo una reseña verificada en Discord y SellAuth la
        // publica despues, la version oficial sustituye a la local.
        const local = Object.values(this.db.data.resenas).find(item =>
            item.source === 'discord_verified' && item.invoiceId && item.invoiceId === resena.invoiceId
        );
        if (local) await this.eliminarMensajeResena(local);

        const existente = this.db.data.resenas[resena.key];
        this.db.data.resenas[resena.key] = {
            ...existente,
            ...resena,
            messageId: existente?.messageId ?? '',
            channelId: existente?.channelId ?? ''
        };
        this.db.save();

        await this.publicarResena(this.db.data.resenas[resena.key], { actualizar: Boolean(existente?.messageId) });
        this.db.data.resenasVistas[resena.sourceId] = Date.now();
        if (!existente) this.db.data.estadisticas.resenasSellAuth += 1;
        this.db.save();
        return true;
    }

    async eliminarMensajeResena(resena) {
        if (resena.channelId && resena.messageId) {
            const canal = await this.client.channels.fetch(resena.channelId).catch(() => null);
            const mensaje = canal ? await canal.messages.fetch(resena.messageId).catch(() => null) : null;
            await mensaje?.delete().catch(() => null);
        }
        delete this.db.data.resenas[resena.key];
        this.db.save();
    }

    async canalResenas() {
        const id = this.config.channels?.reviews;
        if (!id) return null;
        const canal = await this.client.channels.fetch(id).catch(() => null);
        return canal?.isTextBased?.() ? canal : null;
    }

    construirResena(resena, avatarUrl = '') {
        const estrellas = Array.from({ length: resena.rating }, () => this.emojis.get('estrellita')).join(' ')
            || `${resena.rating}/5`;
        const cliente = resena.userId ? `<@${resena.userId}>` : 'Verified customer';
        const referencia = resena.invoiceId
            ? `#${String(resena.invoiceId).slice(-8)}`
            : resena.sourceId ? `#${resena.sourceId}` : 'Verified';

        const container = new ContainerBuilder();
        const cabecera =
            `## ${this.emojis.rol('valoracion')} ${this.config.reviews.title}\n` +
            `${estrellas}\n` +
            `-# ${resena.source === 'sellauth' ? 'Published through SellAuth' : 'Verified with a SellAuth invoice'}`;

        if (avatarUrl) {
            container.addSectionComponents(
                new SectionBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(cabecera))
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl))
            );
        } else {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(cabecera));
        }

        container
            .addSeparatorComponents(ui.linea())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `${this.emojis.rol('producto')} **Product:** ${ui.plano(resena.productName)}\n` +
                `${this.emojis.rol('usuario')} **Customer:** ${cliente}\n` +
                `${this.emojis.rol('verificado')} **Purchase:** ${ui.dato(referencia)}\n` +
                `${this.emojis.rol('reloj')} **Date:** ${ui.fecha(resena.createdAt, 'f')}`
            ))
            .addSeparatorComponents(ui.aire())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### ${this.emojis.rol('info')} Customer feedback\n${ui.cita(ui.plano(resena.message))}`
            ));

        if (resena.reply) {
            container
                .addSeparatorComponents(ui.aire())
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `### ${this.emojis.rol('reply')} Store response\n${ui.cita(ui.plano(resena.reply))}`
                ));
        }

        const banner = media.resolver(this.config.reviews.banner, `review-${resena.key}`);
        if (banner) {
            container
                .addSeparatorComponents(ui.linea())
                .addMediaGalleryComponents(ui.galeria([banner.url], 'Spotify Market verified review'));
        }

        container
            .addSeparatorComponents(ui.linea())
            .addActionRowComponents(ui.fila(
                ui.boton(this.emojis, {
                    id: `sellauth:review-details:${resena.key}`,
                    etiqueta: this.config.reviews.detailsButtonLabel,
                    estilo: 'secundario',
                    emoji: 'buscar'
                }),
                ui.boton(this.emojis, {
                    id: 'sellauth:review-modal',
                    etiqueta: this.config.reviews.buttonLabel,
                    estilo: 'secundario',
                    emoji: 'anadir'
                })
            ))
            .addSeparatorComponents(ui.aire())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `-# Spotify Market · Verified purchase · ${ui.fecha(resena.updatedAt || resena.createdAt, 'R')}`
            ));

        return {
            components: [container],
            files: banner?.files ?? [],
            flags: ui.V2,
            allowedMentions: { parse: [], users: resena.userId ? [resena.userId] : [] }
        };
    }

    async publicarResena(resena, { actualizar = false } = {}) {
        const trabajo = async () => {
            const canal = await this.canalResenas();
            if (!canal) throw new Error('El canal de reseñas no esta configurado o no existe.');

            let avatarUrl = '';
            if (resena.userId) {
                const usuario = await this.client.users.fetch(resena.userId).catch(() => null);
                avatarUrl = usuario?.displayAvatarURL({ extension: 'png', size: 256 }) ?? '';
            }

            const carga = this.construirResena(resena, avatarUrl);
            if (actualizar && resena.messageId) {
                const previo = await canal.messages.fetch(resena.messageId).catch(() => null);
                if (previo) {
                    await previo.edit({ ...carga, attachments: [] });
                    return previo;
                }
            }

            await this.borrarGuiaAnterior(canal);
            const mensaje = await canal.send(carga);
            resena.channelId = canal.id;
            resena.messageId = mensaje.id;
            this.db.data.resenas[resena.key] = resena;
            this.db.save();
            await this.enviarGuia(canal).catch(error =>
                logger.error('sellauth:guia', `La reseña se publico, pero la guia no: ${error.message}`)
            );
            return mensaje;
        };

        const resultado = this.colaPublicacion.then(trabajo, trabajo);
        this.colaPublicacion = resultado.catch(() => null);
        return resultado;
    }

    construirGuia() {
        const lineas = this.config.reviews.guideLines
            .map((linea, indice) => `${this.emojis.get(['buscar', 'wallet', 'estrellita', 'error', 'success'][indice] || 'notificacion')} ${linea}`)
            .join('\n');

        return new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `## ${this.emojis.rol('destacado')} ${this.config.reviews.guideTitle}\n` +
                `> Submit feedback only for a purchase you actually completed.`
            ))
            .addSeparatorComponents(ui.linea())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(lineas))
            .addSeparatorComponents(ui.linea())
            .addSectionComponents(
                new SectionBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `${this.emojis.rol('verificado')} **Ready to share your experience?**\n` +
                        '-# Your invoice is checked privately before anything is published.'
                    ))
                    .setButtonAccessory(
                        ui.boton(this.emojis, {
                            id: 'sellauth:review-modal',
                            etiqueta: this.config.reviews.buttonLabel,
                            estilo: 'secundario',
                            emoji: 'anadir'
                        })
                    )
            );
    }

    async borrarGuiaAnterior(canal) {
        const guia = this.db.data.guia;
        if (!guia.mensajeId) return;
        const destino = guia.canalId === canal.id
            ? canal
            : await this.client.channels.fetch(guia.canalId).catch(() => null);
        const mensaje = destino?.isTextBased?.()
            ? await destino.messages.fetch(guia.mensajeId).catch(() => null)
            : null;
        await mensaje?.delete().catch(() => null);
        this.db.data.guia = { canalId: '', mensajeId: '' };
        this.db.save();
    }

    async enviarGuia(canal) {
        const mensaje = await canal.send({
            components: [this.construirGuia()],
            flags: ui.V2,
            allowedMentions: { parse: [] }
        });
        this.db.data.guia = { canalId: canal.id, mensajeId: mensaje.id };
        this.db.save();
        return mensaje;
    }

    async publicarPanel(canal) {
        const ajustes = structuredClone(this.config);
        ajustes.channels.reviews = canal.id;
        config.guardar('sellauth', ajustes);

        await this.borrarGuiaAnterior(canal);
        return this.enviarGuia(canal);
    }

    modalResena() {
        const rating = new StringSelectMenuBuilder()
            .setCustomId('rating')
            .setPlaceholder('Choose a rating')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions([5, 4, 3, 2, 1].map(valor =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(`${valor} star${valor === 1 ? '' : 's'}`)
                    .setDescription(valor >= 4 ? 'Positive experience' : valor === 3 ? 'Average experience' : 'Needs improvement')
                    .setValue(String(valor))
            ));

        return new ModalBuilder()
            .setCustomId('sellauth:review-submit')
            .setTitle('Spotify Market Review')
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `${this.emojis.rol('aviso')} Your invoice is verified privately. Never include passwords or delivered credentials.`
            ))
            .addLabelComponents(
                new LabelBuilder()
                    .setLabel('Invoice ID')
                    .setDescription('Enter your SellAuth invoice ID or unique invoice ID')
                    .setTextInputComponent(
                        new TextInputBuilder()
                            .setCustomId('invoice')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('Example: 6718')
                            .setMinLength(1)
                            .setMaxLength(80)
                            .setRequired(true)
                    ),
                new LabelBuilder()
                    .setLabel('Rating')
                    .setDescription('Choose the score that matches your experience')
                    .setStringSelectMenuComponent(rating),
                new LabelBuilder()
                    .setLabel('Your feedback')
                    .setDescription('Explain what went well and what could be improved')
                    .setTextInputComponent(
                        new TextInputBuilder()
                            .setCustomId('feedback')
                            .setStyle(TextInputStyle.Paragraph)
                            .setPlaceholder('Tell us about your experience...')
                            .setMinLength(8)
                            .setMaxLength(1200)
                            .setRequired(true)
                    )
            );
    }

    async enviarResenaManual(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!this.estaConfigurado()) {
            return ui.responderEfimero(interaction, ui.error(this.emojis, 'Reviews are temporarily unavailable. Please contact support.'));
        }

        const invoiceId = interaction.fields.getTextInputValue('invoice').trim();
        const rating = Number(interaction.fields.getStringSelectValues('rating')?.[0]);
        const message = interaction.fields.getTextInputValue('feedback').trim();
        if (!/^[a-zA-Z0-9-]{1,80}$/.test(invoiceId) || !Number.isInteger(rating) || rating < 1 || rating > 5) {
            return ui.responderEfimero(interaction, ui.error(this.emojis, 'Check the invoice ID and rating, then try again.'));
        }

        let factura;
        try {
            factura = await this.api.obtenerFactura(invoiceId);
        } catch (error) {
            logger.warn('sellauth:resena', `Factura ${invoiceId} rechazada: ${error.message}`);
            return ui.responderEfimero(interaction, ui.error(this.emojis, 'That invoice could not be verified. Check the ID or contact support.'));
        }

        const facturaRealId = String(factura.unique_id || factura.id || invoiceId);
        const estadoFactura = factura.status || ((factura.items ?? []).length
            && factura.items.every(item => item.status === 'completed') ? 'completed' : 'unknown');
        if (!(this.config.reviews.validInvoiceStatuses ?? []).includes(estadoFactura)) {
            return ui.responderEfimero(interaction, ui.aviso(this.emojis, 'Only completed purchases can receive a review.'));
        }
        if (factura.feedback) {
            return ui.responderEfimero(interaction, ui.aviso(this.emojis, 'This invoice already has a SellAuth review.'));
        }
        if (this.db.data.facturasUsadas[facturaRealId] || this.db.data.facturasUsadas[String(factura.id)]) {
            return ui.responderEfimero(interaction, ui.aviso(this.emojis, 'This invoice has already been used for a review.'));
        }

        const discordId = extraerDiscordId(factura);
        if (this.config.reviews.requireDiscordMatchWhenAvailable && discordId && discordId !== interaction.user.id) {
            return ui.responderEfimero(interaction, ui.error(this.emojis, 'This invoice belongs to a different Discord account.'));
        }
        if (!discordId && !this.config.reviews.allowUnlinkedInvoices) {
            return ui.responderEfimero(interaction, ui.aviso(this.emojis, 'This invoice is not linked to Discord. Please contact support to verify it.'));
        }

        const key = `dc-${++this.db.data.contadorResenas}`;
        const resena = {
            key,
            source: 'discord_verified',
            sourceId: key,
            invoiceId: String(factura.id || invoiceId),
            rating,
            message: limpiarHtml(message),
            productName: nombreProductoFactura(factura),
            variantName: '',
            userId: interaction.user.id,
            reply: '',
            status: 'published',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messageId: '',
            channelId: ''
        };

        this.db.data.resenas[key] = resena;
        this.db.data.facturasUsadas[facturaRealId] = { reviewKey: key, userId: interaction.user.id, usedAt: Date.now() };
        if (factura.id) this.db.data.facturasUsadas[String(factura.id)] = this.db.data.facturasUsadas[facturaRealId];
        this.db.flush();

        try {
            const publicado = await this.publicarResena(resena);
            this.db.data.estadisticas.resenasDiscord += 1;
            this.db.save();
            return ui.responderEfimero(interaction, ui.exito(
                this.emojis,
                `Your verified review is now live.\n-# [Open review](${publicado.url})`
            ));
        } catch (error) {
            delete this.db.data.resenas[key];
            delete this.db.data.facturasUsadas[facturaRealId];
            if (factura.id) delete this.db.data.facturasUsadas[String(factura.id)];
            this.db.flush();
            logger.error('sellauth:resena', error.message);
            return ui.responderEfimero(interaction, ui.error(this.emojis, 'The review was verified but could not be published. Please try again.'));
        }
    }

    async detallesResena(interaction, key) {
        const resena = this.db.data.resenas[key];
        if (!resena) return ui.responderEfimero(interaction, ui.error(this.emojis, 'This review is no longer available.'));

        const estrellas = Array.from({ length: resena.rating }, () => this.emojis.get('estrellita')).join(' ') || `${resena.rating}/5`;
        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `## ${this.emojis.rol('valoracion')} Review details\n${estrellas}`
            ))
            .addSeparatorComponents(ui.linea())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `${this.emojis.rol('producto')} **Product:** ${ui.plano(resena.productName)}\n` +
                `${this.emojis.rol('verificado')} **Verification:** ${resena.source === 'sellauth' ? 'SellAuth feedback' : 'Verified SellAuth invoice'}\n` +
                `${this.emojis.rol('reloj')} **Published:** ${ui.fecha(resena.createdAt, 'F')}\n` +
                `${this.emojis.rol('info')} **Reference:** ${ui.dato(resena.invoiceId ? `#${String(resena.invoiceId).slice(-8)}` : resena.sourceId)}`
            ))
            .addSeparatorComponents(ui.aire())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(ui.cita(ui.plano(resena.message))));

        return ui.responderEfimero(interaction, container);
    }

    async publicarAviso(tipo, producto, anterior = null) {
        const canales = this.config.channels ?? {};
        const canalId = tipo === 'price' ? canales.priceUpdates : canales.restocks;
        const activado = tipo === 'price'
            ? this.config.announcements?.priceChanges?.enabled
            : tipo === 'new'
                ? this.config.announcements?.newProducts?.enabled
                : this.config.announcements?.restocks?.enabled;
        if (!activado || !canalId) return null;

        const canal = await this.client.channels.fetch(canalId).catch(() => null);
        if (!canal?.isTextBased?.()) {
            logger.warn('sellauth:avisos', `El canal ${canalId} no existe o no admite mensajes.`);
            return null;
        }

        const bajada = tipo === 'price' && Number(producto.precio) < Number(anterior);
        const ajustes = tipo === 'price' ? this.config.announcements.priceChanges :
            tipo === 'new' ? this.config.announcements.newProducts : this.config.announcements.restocks;
        const titulo = tipo === 'price'
            ? (bajada ? ajustes.titleDrop : ajustes.titleIncrease)
            : ajustes.title;
        const descripcion = ajustes.description || (tipo === 'new'
            ? 'A new product is now available in our catalog.'
            : 'This product is available again.');

        const buffer = await arte.generarAviso({
            tipo: tipo === 'price' ? 'price' : 'restock', producto, anterior, titulo
        });
        const nombre = arte.nombreArchivo(tipo, producto);
        const archivo = new AttachmentBuilder(buffer, { name: nombre });
        const precioAnterior = tipo === 'price'
            ? `\n${this.emojis.rol('precio')} **Previous price:** ${arte.precio(anterior, producto.moneda)}`
            : '';

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `${this.config.announcements.mentionEveryone ? '@everyone\n' : ''}` +
                `## ${this.emojis.rol(tipo === 'price' ? 'actualizar' : 'stock')} ${titulo}\n` +
                `> ${descripcion}`
            ))
            .addSeparatorComponents(ui.linea())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `${this.emojis.rol('producto')} **Product:** ${ui.plano(producto.nombre)}\n` +
                `${this.emojis.rol('precio')} **Price:** ${arte.precio(producto.precio, producto.moneda)}${precioAnterior}\n` +
                `${this.emojis.rol('stock')} **Available stock:** ${producto.stock < 0 ? 'Available' : ui.dato(producto.stock)}`
            ))
            .addSeparatorComponents(ui.linea())
            .addMediaGalleryComponents(ui.galeria([`attachment://${nombre}`], `${producto.nombre} ${titulo}`));

        if (producto.checkoutUrl) {
            container
                .addSeparatorComponents(ui.linea())
                .addSectionComponents(
                    new SectionBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            `${this.emojis.rol('comprar')} **Available on SellAuth**\n-# Open the product page to review every option before checkout.`
                        ))
                        .setButtonAccessory(
                            new ButtonBuilder()
                                .setURL(producto.checkoutUrl)
                                .setLabel('View product')
                                .setStyle(ButtonStyle.Link)
                        )
                );
        }

        return canal.send({
            components: [container],
            files: [archivo],
            flags: ui.V2,
            allowedMentions: this.config.announcements.mentionEveryone
                ? { parse: ['everyone'] }
                : { parse: [] }
        });
    }

    async handle(interaction, accion, datos) {
        switch (accion) {
            case 'review-modal':
                return interaction.showModal(this.modalResena());
            case 'review-submit':
                return this.enviarResenaManual(interaction);
            case 'review-details':
                return this.detallesResena(interaction, datos[0]);
            default:
                return undefined;
        }
    }

    // -------------------------------------------------------------- webhook

    iniciarWebhook() {
        const ajustes = this.config.webhook ?? {};
        if (!ajustes.enabled) return false;

        const secreto = process.env.SELLAUTH_WEBHOOK_SECRET?.trim();
        if (!secreto) {
            logger.warn('sellauth:webhook', 'Sin SELLAUTH_WEBHOOK_SECRET: los webhooks no arrancan.');
            return false;
        }

        const host = process.env.SELLAUTH_WEBHOOK_HOST?.trim() || ajustes.host || '0.0.0.0';
        const puerto = Number(process.env.SELLAUTH_WEBHOOK_PORT) || numero(ajustes.port, 8790);
        const ruta = ajustes.path || '/webhooks/sellauth';

        this.servidorWebhook = http.createServer((peticion, respuesta) => {
            this.atenderWebhook(peticion, respuesta, { secreto, ruta }).catch(error => {
                logger.traza('sellauth:webhook', error);
                if (!respuesta.headersSent) this.responderWebhook(respuesta, 500, { error: 'Internal error' });
                else respuesta.end();
            });
        });
        this.servidorWebhook.requestTimeout = 10000;
        this.servidorWebhook.headersTimeout = 8000;
        this.servidorWebhook.listen(puerto, host, () => {
            logger.paso('sellauth:webhook', `${host}:${puerto}${ruta}`);
        });
        this.servidorWebhook.on('error', error => logger.error('sellauth:webhook', error.message));
        return true;
    }

    responderWebhook(respuesta, codigo, cuerpo) {
        const datos = JSON.stringify(cuerpo);
        respuesta.writeHead(codigo, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(datos),
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
        });
        respuesta.end(datos);
    }

    leerCuerpoWebhook(peticion) {
        return new Promise((resolve, reject) => {
            const partes = [];
            let total = 0;
            peticion.on('data', parte => {
                total += parte.length;
                if (total > MAX_WEBHOOK_BODY) {
                    reject(new Error('Webhook body too large'));
                    peticion.destroy();
                    return;
                }
                partes.push(parte);
            });
            peticion.on('end', () => resolve(Buffer.concat(partes)));
            peticion.on('error', reject);
        });
    }

    firmaValida(raw, recibida, secreto) {
        if (!/^[a-f0-9]{64}$/i.test(recibida ?? '')) return false;
        const esperada = crypto.createHmac('sha256', secreto).update(raw).digest('hex');
        const a = Buffer.from(esperada, 'hex');
        const b = Buffer.from(recibida, 'hex');
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    }

    async atenderWebhook(peticion, respuesta, { secreto, ruta }) {
        const url = new URL(peticion.url, 'http://localhost');
        if (url.pathname !== ruta) return this.responderWebhook(respuesta, 404, { error: 'Not found' });
        if (peticion.method !== 'POST') return this.responderWebhook(respuesta, 405, { error: 'Method not allowed' });

        const raw = await this.leerCuerpoWebhook(peticion);
        if (!this.firmaValida(raw, peticion.headers['x-signature'], secreto)) {
            return this.responderWebhook(respuesta, 401, { error: 'Invalid signature' });
        }

        const timestamp = Number(peticion.headers['x-timestamp']);
        const tolerancia = Math.max(60, numero(this.config.webhook.timestampToleranceSeconds, 300));
        if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > tolerancia) {
            return this.responderWebhook(respuesta, 401, { error: 'Expired timestamp' });
        }

        let payload;
        try {
            payload = JSON.parse(raw.toString('utf8'));
        } catch {
            return this.responderWebhook(respuesta, 400, { error: 'Invalid JSON' });
        }

        const shopId = process.env.SELLAUTH_SHOP_ID || this.config.shopId;
        if (String(payload.shop_id) !== String(shopId)) {
            return this.responderWebhook(respuesta, 403, { error: 'Wrong shop' });
        }

        const clave = String(peticion.headers['idempotency-key'] || crypto.createHash('sha256').update(raw).digest('hex'));
        if (this.db.data.webhook.procesados.includes(clave) || this.db.data.webhook.pendientes[clave]) {
            return this.responderWebhook(respuesta, 200, { received: true, duplicate: true });
        }

        this.db.data.webhook.pendientes[clave] = {
            payload,
            receivedAt: Date.now(),
            attempts: 0,
            nextAttemptAt: Date.now()
        };
        this.db.flush();
        this.responderWebhook(respuesta, 200, { received: true });
        queueMicrotask(() => this.procesarWebhooksPendientes().catch(error =>
            logger.error('sellauth:webhook', error.message)
        ));
    }

    async procesarWebhooksPendientes() {
        if (this.procesandoWebhooks) return this.procesandoWebhooks;
        this.procesandoWebhooks = (async () => {
            const ahora = Date.now();
            for (const [clave, pendiente] of Object.entries(this.db.data.webhook.pendientes)) {
                if (pendiente.nextAttemptAt > ahora) continue;
                try {
                    await this.procesarEventoWebhook(pendiente.payload);
                    delete this.db.data.webhook.pendientes[clave];
                    this.db.data.webhook.procesados.push(clave);
                    this.db.data.webhook.procesados = this.db.data.webhook.procesados.slice(-MAX_WEBHOOK_PROCESADOS);
                } catch (error) {
                    pendiente.attempts += 1;
                    pendiente.lastError = String(error.message).slice(0, 300);
                    pendiente.nextAttemptAt = Date.now() + Math.min(30000 * (2 ** Math.min(pendiente.attempts, 5)), 30 * 60 * 1000);
                    this.db.data.estadisticas.errores += 1;
                    logger.error('sellauth:webhook', `${pendiente.payload?.event}: ${error.message}`);
                }
                this.db.flush();
            }
        })();

        try {
            return await this.procesandoWebhooks;
        } finally {
            this.procesandoWebhooks = null;
        }
    }

    async procesarEventoWebhook(payload) {
        const evento = String(payload?.event ?? '');
        const datos = payload?.data ?? {};

        if (['NOTIFICATION.SHOP_FEEDBACK_RECEIVED', 'NOTIFICATION.SHOP_FEEDBACK_UPDATED'].includes(evento)) {
            const feedback = await this.api.obtenerResena(datos.feedback_id);
            await this.publicarResenaSellAuth(feedback);
            return;
        }

        if (evento === 'NOTIFICATION.SHOP_PRODUCT_OUT_OF_STOCK') {
            await this.sincronizarProductos({ anunciar: true });
            return;
        }

        if (evento === 'NOTIFICATION.SHOP_ERROR') {
            logger.error('sellauth', `${datos.title ?? 'SellAuth error'}: ${datos.description ?? 'sin detalle'}`);
            return;
        }

        logger.detalle(`SellAuth webhook recibido: ${evento}`);
    }
}

module.exports = SellAuthSystem;
module.exports.normalizarProductos = normalizarProductos;
module.exports.extraerDiscordId = extraerDiscordId;
module.exports.nombreProductoFactura = nombreProductoFactura;
