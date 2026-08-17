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
const SPOTIFY_GREEN = 0x1ED760;
const DETAILS_BUTTON_LABEL = 'Purchase details';
const REVIEW_BUTTON_LABEL = 'Leave a review';

function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

class SpotifySellAuthSystem extends MinimalSellAuthAnnouncements {
    async iniciar() {
        const resultado = await super.iniciar();

        // Al arrancar aplicamos el nuevo estilo a las reviews existentes y,
        // cuando terminan, reemplazamos una sola vez la guia del canal.
        const timer = setTimeout(() => {
            (async () => {
                await this.refrescarResenasPublicadas();
                await this.refrescarGuiaPublicada();
            })().catch(error =>
                logger.error('sellauth:reviews', `Review visual refresh failed: ${error.message}`)
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

        if (actualizadas) logger.detalle(`Reviews visual refresh: ${actualizadas} reseña(s) actualizadas.`);
        return actualizadas;
    }

    async refrescarGuiaPublicada() {
        const canal = await this.canalResenas();
        if (!canal) return false;

        await this.borrarGuiaAnterior(canal);
        await this.enviarGuia(canal);
        logger.detalle('Review guide refresh: guia plana actualizada.');
        return true;
    }

    construirResena(resena, avatarUrl = '') {
        const estrellas = Array.from({ length: resena.rating }, () => this.emojis.get('estrellita')).join(' ')
            || `${resena.rating}/5`;
        const cliente = resena.userId ? `<@${resena.userId}>` : 'Verified customer';

        // Excepcion visual solicitada: las reviews/vouches son los unicos
        // containers del bot que usan accent color.
        const container = new ContainerBuilder().setAccentColor(SPOTIFY_GREEN);
        const cabecera =
            `## ${this.emojis.rol('valoracion')} ${this.config.reviews.title}\n` +
            `${estrellas}\n` +
            `-# Verified purchase · ${resena.source === 'sellauth' ? 'Published through SellAuth' : 'Invoice verified by SellAuth'}`;

        if (avatarUrl) {
            container.addSectionComponents(
                new SectionBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(cabecera))
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl))
            );
        } else {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(cabecera));
        }

        // Nada sensible de la compra se enseña en publico: ni producto ni
        // referencia de factura. Ambos quedan para Purchase details.
        container
            .addSeparatorComponents(ui.linea())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `${this.emojis.rol('verificado')} **Purchase:** Verified\n` +
                `${this.emojis.rol('usuario')} **Customer:** ${cliente}\n` +
                `${this.emojis.rol('reloj')} **Published:** ${ui.fecha(resena.createdAt, 'f')}`
            ))
            .addSeparatorComponents(ui.aire())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### ${this.emojis.rol('info')} Customer feedback\n${ui.cita(ui.plano(resena.message))}`
            ));

        if (resena.reply) {
            container
                .addSeparatorComponents(ui.aire())
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `### ${this.emojis.rol('reply')} Spotify Market response\n${ui.cita(ui.plano(resena.reply))}`
                ));
        }

        const banner = media.resolver(this.config.reviews.banner, `review-${resena.key}`);
        if (banner) {
            container
                .addSeparatorComponents(ui.linea())
                .addMediaGalleryComponents(ui.galeria([banner.url], 'Spotify Market verified customer review'));
        }

        container
            .addSeparatorComponents(ui.linea())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `**Verified review**\n-# Purchase information is private. Open the details only when you need to verify it.`
            ))
            .addActionRowComponents(ui.fila(
                ui.boton(this.emojis, {
                    id: `sellauth:review-details:${resena.key}`,
                    etiqueta: DETAILS_BUTTON_LABEL,
                    estilo: 'secundario',
                    emoji: 'buscar'
                }),
                ui.boton(this.emojis, {
                    id: 'sellauth:review-modal',
                    etiqueta: REVIEW_BUTTON_LABEL,
                    estilo: 'exito',
                    emoji: 'anadir'
                })
            ))
            .addSeparatorComponents(ui.aire())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `-# Spotify Market · Verified by SellAuth · ${ui.fecha(resena.updatedAt || resena.createdAt, 'R')}`
            ));

        return {
            components: [container],
            files: banner?.files ?? [],
            flags: ui.V2,
            allowedMentions: { parse: [], users: resena.userId ? [resena.userId] : [] }
        };
    }

    construirGuiaPlana() {
        const iconoTitulo = this.emojis.rol('info') || this.emojis.get('notificacion');
        const abrir = this.emojis.get('buscar');
        const factura = this.emojis.get('wallet');
        const estrella = this.emojis.get('estrellita');
        const verificado = this.emojis.get('success');

        return [
            new TextDisplayBuilder().setContent(
                `## ${iconoTitulo ? `${iconoTitulo} ` : ''}SHARE YOUR EXPERIENCE\n` +
                `Tell us how your order went. We verify the purchase privately before publishing the review.\n` +
                `-# Your product and invoice details are never shown in the public vouch.`
            ),
            ui.linea(),
            new TextDisplayBuilder().setContent([
                `${abrir ? `${abrir} ` : ''}**1 · Open the review form**\nPress **${REVIEW_BUTTON_LABEL}** below to start.`,
                `${factura ? `${factura} ` : ''}**2 · Verify your order**\nEnter the SellAuth invoice ID from a completed purchase.`,
                `${estrella ? `${estrella} ` : ''}**3 · Rate your experience**\nChoose 1–5 stars and write a short, honest review.`,
                `${verificado ? `${verificado} ` : ''}**4 · Publish as verified**\nValid invoices are accepted once; invalid or reused invoices are rejected automatically.`
            ].join('\n\n')),
            ui.linea(),
            new SectionBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `**Ready to leave a verified review?**\n` +
                    `-# It only takes a moment, and your purchase information stays private.`
                ))
                .setButtonAccessory(
                    ui.boton(this.emojis, {
                        id: 'sellauth:review-modal',
                        etiqueta: REVIEW_BUTTON_LABEL,
                        estilo: 'exito',
                        emoji: 'anadir'
                    })
                )
        ];
    }

    async enviarGuia(canal) {
        const mensaje = await canal.send({
            // Components V2 permite TextDisplay/Separator/Section directamente
            // en el mensaje. No hay ContainerBuilder y por tanto no aparece caja.
            components: this.construirGuiaPlana(),
            flags: ui.V2,
            allowedMentions: { parse: [] }
        });

        this.db.data.guia = { canalId: canal.id, mensajeId: mensaje.id };
        this.db.save();
        return mensaje;
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
            .setAccentColor(SPOTIFY_GREEN)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `${loadingIcon ? `${loadingIcon} ` : ''}**Loading purchase details...**\n` +
                '-# Verifying the private review information.'
            ));

        await ui.responderEfimero(interaction, loading);
        await esperar(REVIEW_DETAILS_DELAY_MS);

        const estrellas = Array.from({ length: resena.rating }, () => this.emojis.get('estrellita')).join(' ')
            || `${resena.rating}/5`;
        const cliente = resena.userId ? `<@${resena.userId}>` : 'Verified customer';
        const referencia = resena.invoiceId
            ? `#${String(resena.invoiceId).slice(-8)}`
            : resena.sourceId ? `#${resena.sourceId}` : 'Verified';

        const container = new ContainerBuilder()
            .setAccentColor(SPOTIFY_GREEN)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `## ${this.emojis.rol('valoracion')} Purchase details\n${estrellas}\n` +
                '-# Private view · only visible to you'
            ))
            .addSeparatorComponents(ui.linea())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `${this.emojis.rol('producto')} **Product:** ${ui.plano(resena.productName)}\n` +
                `${this.emojis.rol('usuario')} **Customer:** ${cliente}\n` +
                `${this.emojis.rol('verificado')} **Invoice:** ${ui.dato(referencia)}\n` +
                `${this.emojis.rol('verificado')} **Verification:** ${resena.source === 'sellauth' ? 'SellAuth feedback' : 'Verified SellAuth invoice'}\n` +
                `${this.emojis.rol('reloj')} **Published:** ${ui.fecha(resena.createdAt, 'F')}`
            ))
            .addSeparatorComponents(ui.aire())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### ${this.emojis.rol('info')} Review\n${ui.cita(ui.plano(resena.message))}`
            ));

        if (resena.reply) {
            container
                .addSeparatorComponents(ui.aire())
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `### ${this.emojis.rol('reply')} Spotify Market response\n${ui.cita(ui.plano(resena.reply))}`
                ));
        }

        return ui.responderEfimero(interaction, container);
    }
}

module.exports = SpotifySellAuthSystem;
