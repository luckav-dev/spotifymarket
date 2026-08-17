'use strict';

const {
    AttachmentBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder
} = require('discord.js');

const SpotifySellAuthSystem = require('./spotifySellAuthSystem');
const arte = require('../utils/sellAuthArtwork');
const ui = require('../utils/ui');
const logger = require('../utils/logger');

const DEFAULT_WEB_URL = 'https://spotifymarket.xyz';

class SpotifyMarketCommerceSystem extends SpotifySellAuthSystem {
    storefrontBase() {
        return String(process.env.SPOTIFY_MARKET_WEB_URL || DEFAULT_WEB_URL).trim().replace(/\/+$/, '');
    }

    productUrl(producto) {
        const slug = String(producto?.path ?? '').trim().replace(/^\/+|\/+$/g, '');
        if (!slug) return `${this.storefrontBase()}/products`;
        return `${this.storefrontBase()}/products/${encodeURIComponent(slug)}`;
    }

    productos() {
        return super.productos().map(producto => ({
            ...producto,
            checkoutUrl: this.productUrl(producto)
        }));
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
        const ajustes = tipo === 'price'
            ? this.config.announcements.priceChanges
            : tipo === 'new'
                ? this.config.announcements.newProducts
                : this.config.announcements.restocks;
        const titulo = tipo === 'price'
            ? (bajada ? ajustes.titleDrop : ajustes.titleIncrease)
            : ajustes.title;
        const descripcion = ajustes.description || (tipo === 'new'
            ? 'A new product is now available in our catalog.'
            : 'This product is available again.');

        const productoWeb = { ...producto, checkoutUrl: this.productUrl(producto) };
        const buffer = await arte.generarAviso({
            tipo: tipo === 'price' ? 'price' : 'restock',
            producto: productoWeb,
            anterior,
            titulo
        });
        const nombre = arte.nombreArchivo(tipo, productoWeb);
        const archivo = new AttachmentBuilder(buffer, { name: nombre });
        const precioAnterior = tipo === 'price'
            ? `\n${this.emojis.rol('precio')} **Previous price:** ${arte.precio(anterior, productoWeb.moneda)}`
            : '';

        const cta = tipo === 'price'
            ? (bajada ? 'Get the new price' : 'View updated price')
            : tipo === 'restock'
                ? 'Buy now'
                : 'View product';

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `${this.config.announcements.mentionEveryone ? '@everyone\n' : ''}` +
                `## ${this.emojis.rol(tipo === 'price' ? 'actualizar' : 'stock')} ${titulo}\n` +
                `> ${descripcion}`
            ))
            .addSeparatorComponents(ui.linea())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `${this.emojis.rol('producto')} **Product:** ${ui.plano(productoWeb.nombre)}\n` +
                `${this.emojis.rol('precio')} **Price:** ${arte.precio(productoWeb.precio, productoWeb.moneda)}${precioAnterior}\n` +
                `${this.emojis.rol('stock')} **Available stock:** ${productoWeb.stock < 0 ? 'Available' : ui.dato(productoWeb.stock)}`
            ))
            .addSeparatorComponents(ui.linea())
            .addMediaGalleryComponents(ui.galeria([`attachment://${nombre}`], `${productoWeb.nombre} ${titulo}`))
            .addSeparatorComponents(ui.linea())
            .addSectionComponents(
                new SectionBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `${this.emojis.rol('comprar')} **Continue on Spotify Market**\n` +
                        `-# Open the product directly on spotifymarket.xyz. SellAuth remains the payment backend only.`
                    ))
                    .setButtonAccessory(
                        ui.boton(this.emojis, {
                            url: productoWeb.checkoutUrl,
                            etiqueta: cta,
                            estilo: 'enlace',
                            emoji: 'website'
                        })
                    )
            );

        return canal.send({
            components: [container],
            files: [archivo],
            flags: ui.V2,
            allowedMentions: this.config.announcements.mentionEveryone
                ? { parse: ['everyone'] }
                : { parse: [] }
        });
    }
}

module.exports = SpotifyMarketCommerceSystem;
