'use strict';

const crypto = require('node:crypto');
const {
    AttachmentBuilder,
    ContainerBuilder,
    TextDisplayBuilder
} = require('discord.js');

const SellAuthSystem = require('./sellAuthSystem');
const Database = require('../utils/jsonDatabase');
const logger = require('../utils/logger');
const arte = require('../utils/sellAuthArtwork');
const stockArte = require('../utils/sellAuthStockArtwork');
const ui = require('../utils/ui');

const STOCK_SCHEMA = {
    channelId: '',
    messageId: '',
    fingerprint: '',
    updatedAt: 0,
    pageCount: 0,
    lastError: ''
};

function texto(valor, fallback = '—') {
    const limpio = String(valor ?? '').replace(/\s+/g, ' ').trim();
    return limpio || fallback;
}

function markdownSeguro(valor, fallback = '—') {
    return texto(valor, fallback).replace(/([\\`*_~|>])/g, '\\$1');
}

function dinero(valor, moneda = 'EUR') {
    const numero = Number(valor);
    const codigo = texto(moneda, 'EUR').toUpperCase();
    if (!Number.isFinite(numero)) return `${texto(valor, '0')} ${codigo}`;
    return `${numero.toFixed(2)} ${codigo}`;
}

function discordIdFactura(factura) {
    const candidatos = [
        factura?.discord_id,
        factura?.discord_user_id,
        factura?.discord?.id,
        factura?.customer?.discord_id,
        factura?.customer?.discord_user_id,
        factura?.shop_customer?.discord_id,
        factura?.shop_customer?.discord_user_id
    ];
    return candidatos
        .map(valor => String(valor ?? '').trim())
        .find(valor => /^\d{17,20}$/.test(valor)) ?? '';
}

function discordNombreFactura(factura) {
    return texto(
        factura?.discord_user_username
        || factura?.discord_username
        || factura?.discord?.username
        || factura?.customer?.discord_username
        || factura?.shop_customer?.discord_username,
        ''
    );
}

function emailFactura(factura) {
    return texto(
        factura?.email
        || factura?.customer?.email
        || factura?.shop_customer?.email,
        ''
    );
}

function productosFactura(factura) {
    const items = Array.isArray(factura?.items) ? factura.items : [];
    if (!items.length) return ['• Purchase details unavailable'];

    const lineas = items.slice(0, 8).map(item => {
        const cantidad = Math.max(1, Math.trunc(Number(item?.quantity) || 1));
        const producto = texto(item?.product?.name || item?.product_name, 'Product');
        const variante = texto(item?.variant?.name || item?.variant_name, '');
        const nombre = variante && variante !== producto
            ? `${producto} — ${variante}`
            : producto;
        return `• **${cantidad}x** ${markdownSeguro(nombre)}`;
    });

    if (items.length > 8) lineas.push(`• +${items.length - 8} more item(s)`);
    return lineas;
}

class MinimalSellAuthAnnouncements extends SellAuthSystem {
    constructor(client, emojis) {
        super(client, emojis);
        this.stockDb = new Database('sellauth-stock-panel', STOCK_SCHEMA);
        this.actualizandoStock = null;
    }

    productosConStock() {
        return this.productosVisibles().filter(producto => Number(producto.stock) !== 0);
    }

    fingerprintStock(productos = this.productosConStock()) {
        const ajustes = this.config.stockPanel ?? {};
        const estable = productos
            .map(producto => ({
                id: producto.id,
                nombre: producto.nombre,
                categoria: producto.categoria,
                precio: producto.precio,
                moneda: producto.moneda,
                stock: producto.stock,
                imagen: producto.imagen,
                visible: producto.visible
            }))
            .sort((a, b) => a.id.localeCompare(b.id));
        return crypto.createHash('sha256').update(JSON.stringify({
            renderer: stockArte.RENDERER_VERSION,
            productos: estable,
            panel: {
                title: ajustes.title,
                description: ajustes.description,
                imageTitle: ajustes.imageTitle,
                imageSubtitle: ajustes.imageSubtitle,
                lowStockThreshold: ajustes.lowStockThreshold,
                productsPerPage: ajustes.productsPerPage,
                maxPages: ajustes.maxPages
            }
        })).digest('hex');
    }

    async sincronizarProductos(opciones = {}) {
        const resultado = await super.sincronizarProductos(opciones);
        await this.actualizarPanelStock().catch(error => {
            this.stockDb.data.lastError = String(error.message).slice(0, 400);
            this.stockDb.save();
            logger.error('sellauth:stock', `No se pudo actualizar el panel: ${error.message}`);
        });
        return resultado;
    }

    detener() {
        stockArte.cerrar?.().catch(() => null);
        return super.detener();
    }

    async canalStock(canalPreferido = null) {
        if (canalPreferido?.isTextBased?.()) return canalPreferido;
        const id = this.config.channels?.stock || this.stockDb.data.channelId;
        if (!id) return null;
        const canal = await this.client.channels.fetch(id).catch(() => null);
        return canal?.isTextBased?.() ? canal : null;
    }

    async canalPagos() {
        const id = String(this.config.channels?.payments ?? '').trim();
        if (!id) return null;

        const canal = await this.client.channels.fetch(id).catch(() => null);
        if (!canal?.isTextBased?.()) {
            logger.warn('sellauth:payments', `El canal ${id} no existe o no admite mensajes.`);
            return null;
        }
        return canal;
    }

    async publicarPago(factura) {
        const ajustes = this.config.announcements?.payments ?? {};
        if (ajustes.enabled === false) return null;

        const canal = await this.canalPagos();
        if (!canal) return null;

        const estado = String(factura?.status ?? '').trim().toLowerCase();
        const estadosPermitidos = Array.isArray(ajustes.statuses) && ajustes.statuses.length
            ? ajustes.statuses.map(valor => String(valor).toLowerCase())
            : ['completed', 'partially_completed'];
        if (estado && !estadosPermitidos.includes(estado)) {
            logger.detalle(`Pago SellAuth omitido: factura #${factura?.id ?? '?'} con estado ${estado}.`);
            return null;
        }

        const discordId = discordIdFactura(factura);
        const discordNombre = discordNombreFactura(factura);
        const email = emailFactura(factura);
        const mostrarEmail = ajustes.showEmail !== false;
        const moneda = texto(factura?.currency, 'EUR').toUpperCase();
        const metodo = texto(
            factura?.payment_method?.name
            || factura?.payment_method?.checkout_name
            || factura?.gateway,
            'Unknown'
        );
        const gateway = texto(factura?.gateway, '');
        const facturaId = texto(factura?.id, '?');
        const uniqueId = texto(factura?.unique_id, '');
        const precioUsd = Number(factura?.price_usd);
        const fecha = Date.parse(
            factura?.completed_at
            || factura?.updated_at
            || factura?.created_at
            || ''
        );
        const timestamp = Math.floor((Number.isFinite(fecha) ? fecha : Date.now()) / 1000);

        let cliente = 'Not linked to Discord';
        if (discordId) {
            cliente = `<@${discordId}>`;
            if (discordNombre) cliente += ` · **${markdownSeguro(discordNombre)}**`;
            cliente += ` · \`${discordId}\``;
        } else if (discordNombre) {
            cliente = `**${markdownSeguro(discordNombre)}**`;
        }

        const metodoCompleto = gateway && gateway.toLowerCase() !== metodo.toLowerCase()
            ? `${markdownSeguro(metodo)} · \`${markdownSeguro(gateway)}\``
            : markdownSeguro(metodo);

        const detallesCliente = [
            `👤 **Discord:** ${cliente}`,
            ...(mostrarEmail && email ? [`📧 **Email:** \`${email.replace(/`/g, '')}\``] : [])
        ];

        const detallesPago = [
            `💳 **Method:** ${metodoCompleto}`,
            `💰 **Amount:** \`${dinero(factura?.price, moneda)}\``,
            ...(moneda !== 'USD' && Number.isFinite(precioUsd) && precioUsd > 0
                ? [`💵 **USD value:** \`${dinero(precioUsd, 'USD')}\``]
                : []),
            `✅ **Status:** \`${markdownSeguro(estado || 'processed')}\``
        ];

        const detallesPedido = [
            ...productosFactura(factura),
            '',
            `🧾 **Invoice:** \`#${facturaId}\``,
            ...(uniqueId ? [`🔖 **Reference:** \`${uniqueId.replace(/`/g, '')}\``] : []),
            `🕒 **Completed:** <t:${timestamp}:F> · <t:${timestamp}:R>`
        ];

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `## 💸 ${ajustes.title || 'PAYMENT RECEIVED'}\n` +
                `> ${ajustes.description || 'SellAuth confirmed the payment and processed the invoice.'}`
            ))
            .addSeparatorComponents(ui.linea())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(detallesCliente.join('\n')))
            .addSeparatorComponents(ui.aire())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(detallesPago.join('\n')))
            .addSeparatorComponents(ui.aire())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(detallesPedido.join('\n')));

        const mensaje = await canal.send({
            components: [container],
            flags: ui.V2,
            allowedMentions: discordId
                ? { parse: [], users: [discordId] }
                : { parse: [] }
        });

        logger.paso('sellauth:payments', `Pago anunciado: factura #${facturaId} · ${metodo} · ${dinero(factura?.price, moneda)}`);
        return mensaje;
    }

    async mensajeStock(canal) {
        const estado = this.stockDb.data;
        if (!estado.messageId || !estado.channelId || estado.channelId !== canal.id) return null;
        return canal.messages.fetch(estado.messageId).catch(() => null);
    }

    construirStockContainer(nombresArchivos, productos) {
        const stockFinito = productos.filter(producto => producto.stock > 0)
            .reduce((total, producto) => total + Number(producto.stock), 0);
        const infinitos = productos.filter(producto => producto.stock < 0).length;
        const resumenUnidades = infinitos ? `${stockFinito}+` : String(stockFinito);
        const ajustes = this.config.stockPanel ?? {};

        return new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `## ${this.emojis.rol('stock')} ${ajustes.title || 'LIVE STOCK'}\n` +
                `> ${ajustes.description || 'Current availability, synchronized automatically with SellAuth.'}`
            ))
            .addSeparatorComponents(ui.linea())
            .addMediaGalleryComponents(ui.galeria(
                nombresArchivos.map(nombre => `attachment://${nombre}`),
                'Spotify Market live product stock'
            ))
            .addSeparatorComponents(ui.aire())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `${this.emojis.rol('producto')} **Available products:** ${ui.dato(productos.length)} · ` +
                `${this.emojis.rol('stock')} **Ready units:** ${ui.dato(resumenUnidades)}`
            ));
    }

    async actualizarPanelStock({ canal = null, forzar = false } = {}) {
        const ajustes = this.config.stockPanel ?? {};
        if (ajustes.enabled === false) return null;

        const trabajo = async () => {
            const destino = await this.canalStock(canal);
            if (!destino) return null;

            const productos = this.productosConStock();
            const fingerprint = this.fingerprintStock(productos);
            let mensaje = await this.mensajeStock(destino);
            if (!forzar && mensaje && fingerprint === this.stockDb.data.fingerprint) return mensaje;

            const actualizadoEn = Date.now();
            const paneles = await stockArte.generarPanelesStock(productos, {
                title: ajustes.imageTitle || 'Stock board',
                subtitle: ajustes.imageSubtitle || 'Current availability synchronized automatically from SellAuth.',
                lowStockThreshold: ajustes.lowStockThreshold,
                productsPerPage: ajustes.productsPerPage,
                maxPages: ajustes.maxPages,
                updatedAt: actualizadoEn
            });
            const nombres = paneles.map(panel => panel.nombre);
            const archivos = paneles.map(panel => new AttachmentBuilder(panel.buffer, { name: panel.nombre }));
            const payload = {
                components: [this.construirStockContainer(nombres, productos)],
                files: archivos,
                flags: ui.V2,
                allowedMentions: { parse: [] }
            };

            if (mensaje) {
                mensaje = await mensaje.edit({ ...payload, attachments: [] });
            } else {
                const estadoAnterior = this.stockDb.data;
                if (estadoAnterior.channelId && estadoAnterior.messageId && estadoAnterior.channelId !== destino.id) {
                    const canalAnterior = await this.client.channels.fetch(estadoAnterior.channelId).catch(() => null);
                    const mensajeAnterior = canalAnterior?.isTextBased?.()
                        ? await canalAnterior.messages.fetch(estadoAnterior.messageId).catch(() => null)
                        : null;
                    await mensajeAnterior?.delete().catch(() => null);
                }
                mensaje = await destino.send(payload);
            }

            this.stockDb.data.channelId = destino.id;
            this.stockDb.data.messageId = mensaje.id;
            this.stockDb.data.fingerprint = fingerprint;
            this.stockDb.data.updatedAt = actualizadoEn;
            this.stockDb.data.pageCount = paneles.length;
            this.stockDb.data.lastError = '';
            this.stockDb.flush();
            logger.detalle(`Panel HTML/Chromium de stock actualizado: ${productos.length} productos · ${paneles.length} imagen(es) · #${destino.id}`);
            return mensaje;
        };

        const previo = this.actualizandoStock ?? Promise.resolve();
        const actual = previo.then(trabajo, trabajo);
        const cierre = actual.finally(() => {
            if (this.actualizandoStock === cierre) this.actualizandoStock = null;
        });
        this.actualizandoStock = cierre;
        return cierre;
    }

    async procesarEventoWebhook(payload) {
        const evento = String(payload?.event ?? '');
        const eventosFactura = new Set([
            'NOTIFICATION.SHOP_INVOICE_CREATED',
            'NOTIFICATION.SHOP_INVOICE_PROCESSED',
            'NOTIFICATION.SHOP_INVOICE_CONFIRMING',
            'NOTIFICATION.SHOP_INVOICE_OUT_OF_STOCK'
        ]);

        if (eventosFactura.has(evento)) {
            await this.sincronizarProductos({ anunciar: true });

            if (evento === 'NOTIFICATION.SHOP_INVOICE_PROCESSED') {
                const invoiceId = String(payload?.data?.invoice_id ?? '').trim();
                if (!invoiceId) {
                    logger.warn('sellauth:payments', 'Webhook de factura procesada recibido sin invoice_id.');
                } else {
                    const factura = await this.api.obtenerFactura(invoiceId);
                    await this.publicarPago(factura);
                }
            }
            return;
        }

        return super.procesarEventoWebhook(payload);
    }

    async publicarAviso(tipo, producto, anterior = null) {
        if (tipo === 'new') {
            return super.publicarAviso(tipo, producto, anterior);
        }

        const canales = this.config.channels ?? {};
        const canalId = tipo === 'price' ? canales.priceUpdates : canales.restocks;
        const activado = tipo === 'price'
            ? this.config.announcements?.priceChanges?.enabled
            : this.config.announcements?.restocks?.enabled;

        if (!activado || !canalId) return null;

        const canal = await this.client.channels.fetch(canalId).catch(() => null);
        if (!canal?.isTextBased?.()) {
            logger.warn('sellauth:avisos', `El canal ${canalId} no existe o no admite mensajes.`);
            return null;
        }

        const bajada = tipo === 'price' && Number(producto.precio) < Number(anterior);
        const ajustesAviso = tipo === 'price'
            ? this.config.announcements.priceChanges
            : this.config.announcements.restocks;
        const titulo = tipo === 'price'
            ? (bajada ? ajustesAviso.titleDrop : ajustesAviso.titleIncrease)
            : ajustesAviso.title;

        const buffer = await arte.generarAviso({
            tipo: tipo === 'price' ? 'price' : 'restock',
            producto,
            anterior,
            titulo
        });
        const nombre = arte.nombreArchivo(tipo, producto);
        const archivo = new AttachmentBuilder(buffer, { name: nombre });
        const mencionarEveryone = tipo !== 'price';

        const container = new ContainerBuilder();
        if (mencionarEveryone) {
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('@everyone')
            );
        }
        container.addMediaGalleryComponents(
            ui.galeria([`attachment://${nombre}`])
        );

        return canal.send({
            components: [container],
            files: [archivo],
            flags: ui.V2,
            allowedMentions: mencionarEveryone
                ? { parse: ['everyone'] }
                : { parse: [] }
        });
    }
}

module.exports = MinimalSellAuthAnnouncements;
