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
    lastError: ''
};

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
        return crypto.createHash('sha256').update(JSON.stringify(estable)).digest('hex');
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

    async canalStock(canalPreferido = null) {
        if (canalPreferido?.isTextBased?.()) return canalPreferido;
        const id = this.config.channels?.stock || this.stockDb.data.channelId;
        if (!id) return null;
        const canal = await this.client.channels.fetch(id).catch(() => null);
        return canal?.isTextBased?.() ? canal : null;
    }

    async mensajeStock(canal) {
        const estado = this.stockDb.data;
        if (!estado.messageId || !estado.channelId || estado.channelId !== canal.id) return null;
        return canal.messages.fetch(estado.messageId).catch(() => null);
    }

    construirStockContainer(nombreArchivo, productos, actualizadoEn) {
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
                [`attachment://${nombreArchivo}`],
                'Spotify Market live product stock'
            ))
            .addSeparatorComponents(ui.aire())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `${this.emojis.rol('producto')} **Available products:** ${ui.dato(productos.length)} · ` +
                `${this.emojis.rol('stock')} **Ready units:** ${ui.dato(resumenUnidades)}\n` +
                `-# Auto-updated from SellAuth · ${ui.fecha(actualizadoEn, 'R')}`
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
            const buffer = await stockArte.generarPanelStock(productos, {
                title: ajustes.imageTitle || 'PRODUCT STOCK',
                subtitle: ajustes.imageSubtitle || 'Available products, synced automatically from SellAuth.',
                lowStockThreshold: ajustes.lowStockThreshold,
                updatedAt: actualizadoEn
            });
            const nombre = stockArte.nombreArchivoStock();
            const archivo = new AttachmentBuilder(buffer, { name: nombre });
            const payload = {
                components: [this.construirStockContainer(nombre, productos, actualizadoEn)],
                files: [archivo],
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
            this.stockDb.data.lastError = '';
            this.stockDb.flush();
            logger.detalle(`Panel de stock actualizado: ${productos.length} productos en #${destino.id}`);
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
        const ajustes = tipo === 'price'
            ? this.config.announcements.priceChanges
            : this.config.announcements.restocks;
        const titulo = tipo === 'price'
            ? (bajada ? ajustes.titleDrop : ajustes.titleIncrease)
            : ajustes.title;

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
