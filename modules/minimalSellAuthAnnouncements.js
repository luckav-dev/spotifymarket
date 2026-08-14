'use strict';

const {
    AttachmentBuilder,
    ContainerBuilder,
    TextDisplayBuilder
} = require('discord.js');

const SellAuthSystem = require('./sellAuthSystem');
const logger = require('../utils/logger');
const arte = require('../utils/sellAuthArtwork');
const ui = require('../utils/ui');

/**
 * Mantiene toda la integracion SellAuth original, pero simplifica los avisos
 * de restock y actualizacion de precio: solo @everyone + la imagen generada,
 * dentro de un Container de Discord Components V2.
 * Los anuncios de productos nuevos siguen usando el formato original.
 */
class MinimalSellAuthAnnouncements extends SellAuthSystem {
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

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent('@everyone')
            )
            .addMediaGalleryComponents(
                ui.galeria([`attachment://${nombre}`])
            );

        return canal.send({
            components: [container],
            files: [archivo],
            flags: ui.V2,
            allowedMentions: { parse: ['everyone'] }
        });
    }
}

module.exports = MinimalSellAuthAnnouncements;
