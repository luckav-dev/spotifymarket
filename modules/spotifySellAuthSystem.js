'use strict';

const {
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    ModalBuilder,
    LabelBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder
} = require('discord.js');

const MinimalSellAuthAnnouncements = require('./minimalSellAuthAnnouncements');
const logger = require('../utils/logger');
const media = require('../utils/media');
const ui = require('../utils/ui');

const REVIEW_DETAILS_DELAY_MS = 1000;
const DETAILS_BUTTON_LABEL = 'View details';
const REVIEW_BUTTON_LABEL = 'Leave a review';

function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Las estrellas de reviews son deliberadamente Unicode hardcodeado.
 * Siempre mostramos cinco posiciones para que el rating se lea de un vistazo.
 */
function estrellasReview(rating) {
    const valor = Math.min(Math.max(Math.trunc(Number(rating) || 0), 0), 5);
    return `${'⭐'.repeat(valor)}${'☆'.repeat(5 - valor)}`;
}

class SpotifySellAuthSystem extends MinimalSellAuthAnnouncements {
    async iniciar() {
        const resultado = await super.iniciar();

        // Al arrancar migramos visualmente tanto vouches existentes como guia.
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
        logger.detalle('Review guide refresh: nuevo diseño aplicado.');
        return true;
    }

    construirResena(resena, avatarUrl = '') {
        const estrellas = estrellasReview(resena.rating);
        const cliente = resena.userId ? `<@${resena.userId}>` : 'Verified customer';
        const origen = resena.source === 'sellauth' ? 'SellAuth review' : 'Verified invoice';

        // Sin accent color: el container sigue el lenguaje visual general del bot.
        const container = new ContainerBuilder();
        const cabecera =
            `## ${this.emojis.rol('verificado')} Verified Customer Review\n` +
            `${estrellas}\n` +
            `-# ${cliente} · ${origen} · ${ui.fecha(resena.createdAt, 'R')}`;

        if (avatarUrl) {
            container.addSectionComponents(
                new SectionBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(cabecera))
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl))
            );
        } else {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(cabecera));
        }

        // Lo publico se limita a la experiencia. Producto e invoice solo viven
        // en View details.
        container
            .addSeparatorComponents(ui.linea(false))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `**Customer feedback**\n${ui.cita(ui.plano(resena.message))}`
            ));

        if (resena.reply) {
            container
                .addSeparatorComponents(ui.aire())
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `${this.emojis.rol('reply')} **Spotify Market reply**\n${ui.cita(ui.plano(resena.reply))}`
                ));
        }

        const banner = media.resolver(this.config.reviews.banner, `review-${resena.key}`);
        if (banner) {
            container
                .addSeparatorComponents(ui.aire())
                .addMediaGalleryComponents(ui.galeria([banner.url], 'Spotify Market verified customer review'));
        }

        container
            .addSeparatorComponents(ui.aire())
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
                    estilo: 'primario',
                    emoji: 'anadir'
                })
            ));

        return {
            components: [container],
            files: banner?.files ?? [],
            flags: ui.V2,
            allowedMentions: { parse: [], users: resena.userId ? [resena.userId] : [] }
        };
    }

    construirGuiaPlana() {
        const iconoTitulo = this.emojis.rol('valoracion') || this.emojis.rol('info');

        return [
            new TextDisplayBuilder().setContent(
                `## ${iconoTitulo ? `${iconoTitulo} ` : ''}Customer Reviews\n` +
                `Share your experience after a completed order.\n` +
                `-# Purchase and invoice information is verified privately and never displayed in the public vouch.`
            ),
            ui.linea(false),
            new TextDisplayBuilder().setContent(
                `**1. Verify your purchase**\n` +
                `Enter the invoice ID from your completed order.\n\n` +
                `**2. Rate the experience**\n` +
                `Choose from ⭐ to ⭐⭐⭐⭐⭐ and write a short review.\n\n` +
                `**3. Publish**\n` +
                `The bot validates the invoice once and publishes the verified review.`
            ),
            ui.aire(),
            new SectionBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `**Ready to share your experience?**\n` +
                    `-# Completed invoices can be reviewed once.`
                ))
                .setButtonAccessory(
                    ui.boton(this.emojis, {
                        id: 'sellauth:review-modal',
                        etiqueta: REVIEW_BUTTON_LABEL,
                        estilo: 'primario',
                        emoji: 'anadir'
                    })
                )
        ];
    }

    async enviarGuia(canal) {
        const mensaje = await canal.send({
            // La guia permanece deliberadamente fuera de un container.
            components: this.construirGuiaPlana(),
            flags: ui.V2,
            allowedMentions: { parse: [] }
        });

        this.db.data.guia = { canalId: canal.id, mensajeId: mensaje.id };
        this.db.save();
        return mensaje;
    }

    modalResena() {
        const opciones = [
            { valor: 5, label: '⭐⭐⭐⭐⭐  Excellent', descripcion: 'Everything went as expected' },
            { valor: 4, label: '⭐⭐⭐⭐☆  Very good', descripcion: 'Good experience with a minor issue' },
            { valor: 3, label: '⭐⭐⭐☆☆  Good', descripcion: 'An average overall experience' },
            { valor: 2, label: '⭐⭐☆☆☆  Poor', descripcion: 'Several things could be improved' },
            { valor: 1, label: '⭐☆☆☆☆  Bad', descripcion: 'The experience did not meet expectations' }
        ];

        const rating = new StringSelectMenuBuilder()
            .setCustomId('rating')
            .setPlaceholder('Select your rating')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(opciones.map(opcion =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(opcion.label)
                    .setDescription(opcion.descripcion)
                    .setValue(String(opcion.valor))
            ));

        return new ModalBuilder()
            .setCustomId('sellauth:review-submit')
            .setTitle('Leave a verified review')
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `${this.emojis.rol('verificado')} **Verified purchases only**\n` +
                '-# Your invoice is checked privately. Never include passwords, credentials or delivered account data.'
            ))
            .addLabelComponents(
                new LabelBuilder()
                    .setLabel('Invoice ID')
                    .setDescription('Use the invoice ID from your completed Spotify Market order')
                    .setTextInputComponent(
                        new TextInputBuilder()
                            .setCustomId('invoice')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('Example: 15064005')
                            .setMinLength(1)
                            .setMaxLength(80)
                            .setRequired(true)
                    ),
                new LabelBuilder()
                    .setLabel('Rating')
                    .setDescription('Choose the score that best matches your experience')
                    .setStringSelectMenuComponent(rating),
                new LabelBuilder()
                    .setLabel('Your review')
                    .setDescription('Keep it useful, short and based on your actual purchase')
                    .setTextInputComponent(
                        new TextInputBuilder()
                            .setCustomId('feedback')
                            .setStyle(TextInputStyle.Paragraph)
                            .setPlaceholder('How was your experience?')
                            .setMinLength(8)
                            .setMaxLength(1200)
                            .setRequired(true)
                    )
            );
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
                '-# Verifying the private order information.'
            ));

        await ui.responderEfimero(interaction, loading);
        await esperar(REVIEW_DETAILS_DELAY_MS);

        const estrellas = estrellasReview(resena.rating);
        const cliente = resena.userId ? `<@${resena.userId}>` : 'Verified customer';
        const referencia = resena.invoiceId
            ? `#${String(resena.invoiceId).slice(-8)}`
            : resena.sourceId ? `#${resena.sourceId}` : 'Verified';

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `## ${this.emojis.rol('buscar')} Purchase details\n` +
                `${estrellas}\n` +
                '-# Private view · visible only to you'
            ))
            .addSeparatorComponents(ui.linea(false))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `${this.emojis.rol('producto')} **Product:** ${ui.plano(resena.productName)}\n` +
                `${this.emojis.rol('usuario')} **Customer:** ${cliente}\n` +
                `${this.emojis.rol('verificado')} **Invoice:** ${ui.dato(referencia)}\n` +
                `${this.emojis.rol('reloj')} **Published:** ${ui.fecha(resena.createdAt, 'F')}`
            ))
            .addSeparatorComponents(ui.aire())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `**Customer feedback**\n${ui.cita(ui.plano(resena.message))}`
            ));

        if (resena.reply) {
            container
                .addSeparatorComponents(ui.aire())
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `${this.emojis.rol('reply')} **Spotify Market reply**\n${ui.cita(ui.plano(resena.reply))}`
                ));
        }

        return ui.responderEfimero(interaction, container);
    }
}

module.exports = SpotifySellAuthSystem;
