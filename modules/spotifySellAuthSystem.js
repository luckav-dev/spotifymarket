'use strict';

const {
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    ThumbnailBuilder
} = require('discord.js');

const MinimalSellAuthAnnouncements = require('./minimalSellAuthAnnouncements');
const logger = require('../utils/logger');
const media = require('../utils/media');
const ui = require('../utils/ui');

const REVIEW_DETAILS_DELAY_MS = 1000;

function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

class SpotifySellAuthSystem extends MinimalSellAuthAnnouncements {
    async iniciar() {
        const resultado = await super.iniciar();

        // Las reseñas que ya estaban publicadas también deben adoptar la nueva
        // política de privacidad: el producto solo aparece en los detalles
        // efímeros y nunca en el container público.
        const timer = setTimeout(() => {
            this.refrescarResenasPublicadas().catch(error =>
                logger.error('sellauth:reviews', `No se pudieron refrescar las reseñas publicadas: ${error.message}`)
            );
        }, 1500);
        timer.unref?.();

        return resultado;
    }

    async refrescarResenasPublicadas() {
        const resenas = Object.values(this.db.data.resenas ?? {})
            .filter(resena => resena?.messageId && resena?.channelId);
        if (!resenas.length) return 0;

        let actualizadas = 0;
        for (const resena of resenas) {
            try {
                await this.publicarResena(resena, { actualizar: true });
                actualizadas += 1;
            } catch (error) {
                logger.warn('sellauth:reviews', `No se pudo actualizar ${resena.key}: ${error.message}`);
            }
        }

        if (actualizadas) {
            logger.detalle(`Reviews privacy refresh: ${actualizadas} reseña(s) actualizadas.`);
        }
        return actualizadas;
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

        // Importante: el producto comprado NO se muestra públicamente. Se
        // conserva en la base de datos y solo se revela tras View full details.
        container
            .addSeparatorComponents(ui.linea())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
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

    async detallesResena(interaction, key) {
        const resena = this.db.data.resenas[key];
        if (!resena) {
            return ui.responderEfimero(
                interaction,
                ui.error(this.emojis, 'This review is no longer available.')
            );
        }

        const loadingIcon = this.emojis.get('loading');
        const loading = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `${loadingIcon ? `${loadingIcon} ` : ''}**Loading purchase details...**\n` +
                '-# Verifying the private review information.'
            ));

        // Respuesta inmediata para que Discord no muestre solo "thinking...".
        // Tras un segundo sustituimos este estado por los detalles reales.
        await ui.responderEfimero(interaction, loading);
        await esperar(REVIEW_DETAILS_DELAY_MS);

        const estrellas = Array.from({ length: resena.rating }, () => this.emojis.get('estrellita')).join(' ')
            || `${resena.rating}/5`;
        const cliente = resena.userId ? `<@${resena.userId}>` : 'Verified customer';
        const referencia = resena.invoiceId
            ? `#${String(resena.invoiceId).slice(-8)}`
            : resena.sourceId ? `#${resena.sourceId}` : 'Verified';

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `## ${this.emojis.rol('valoracion')} Review details\n${estrellas}\n` +
                '-# These purchase details are only visible to you.'
            ))
            .addSeparatorComponents(ui.linea())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### ${this.emojis.rol('producto')} Purchase details\n` +
                `${this.emojis.rol('producto')} **Product:** ${ui.plano(resena.productName)}\n` +
                `${this.emojis.rol('usuario')} **Customer:** ${cliente}\n` +
                `${this.emojis.rol('verificado')} **Purchase:** ${ui.dato(referencia)}\n` +
                `${this.emojis.rol('verificado')} **Verification:** ${resena.source === 'sellauth' ? 'SellAuth feedback' : 'Verified SellAuth invoice'}\n` +
                `${this.emojis.rol('reloj')} **Published:** ${ui.fecha(resena.createdAt, 'F')}`
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

        return ui.responderEfimero(interaction, container);
    }
}

module.exports = SpotifySellAuthSystem;
