'use strict';

const {
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const logger = require('../utils/logger');
const config = require('../utils/config');
const ui = require('../utils/ui');
const media = require('../utils/media');
const Database = require('../utils/jsonDatabase');

const ESQUEMA = {
    panel: { canalId: '', mensajeId: '' },
    verificados: {}
};

/** Verificacion por boton: entrega un rol y deja constancia de quien y cuando. */
class VerifySystem {
    constructor(client, emojis) {
        this.client = client;
        this.emojis = emojis;
        this.db = new Database('verify', ESQUEMA);
    }

    get config() {
        return config.cargar('verify');
    }

    iniciar() {
        const cfg = this.config;
        if (!cfg.activo) return;

        const pendientes = [];
        if (!cfg.canalId) pendientes.push('canalId');
        if (!cfg.rolId) pendientes.push('rolId');

        if (pendientes.length) {
            logger.warn('verify', `Sin configurar: ${pendientes.join(', ')}`);
        }
    }

    construirPanel() {
        const { panel, activo, rolId } = this.config;
        const logo = media.resolver(panel.logo, 'spotify-market-logo');
        const banner = media.resolver(panel.banner, 'spotify-market-verificacion');
        const files = [...(logo?.files ?? []), ...(banner?.files ?? [])];

        const cabecera = new SectionBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# ${this.emojis.rol('verificado')} ${panel.titulo}\n` +
                `> **${panel.subtitulo}**\n` +
                `> ${panel.descripcion}`
            )
        );
        if (logo) {
            cabecera.setThumbnailAccessory(
                new ThumbnailBuilder().setURL(logo.url).setDescription('Spotify Market')
            );
        }

        const c = new ContainerBuilder()
            .addSectionComponents(cabecera)
            .addSeparatorComponents(ui.linea());

        if (panel.pasos?.length) {
            const numeros = ['uno', 'dos', 'tres', 'cuatro', 'cinco'];
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `## ${this.emojis.get('files')} Guía de verificación\n\n` +
                panel.pasos.slice(0, 5).map((paso, i) =>
                    `${this.emojis.rol(numeros[i])} **Paso ${i + 1}**\n> ${paso}`
                ).join('\n')
            ));
        }

        if (panel.beneficios?.length) {
            c.addSeparatorComponents(ui.linea());
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### ${this.emojis.rol('exito')} Qué desbloqueas\n` +
                panel.beneficios.slice(0, 6).map(item => `- ${item}`).join('\n')
            ));
        }

        c.addSeparatorComponents(ui.aire());
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `${this.emojis.rol('miembros')} **Miembros verificados:** ${ui.dato(ui.numero(Object.keys(this.db.data.verificados).length))}\n` +
            `${this.emojis.rol(activo && rolId ? 'exito' : 'aviso')} **Estado:** ${activo && rolId ? 'Disponible' : 'Pendiente de configuracion'}`
        ));

        if (banner) {
            c.addSeparatorComponents(ui.linea());
            c.addMediaGalleryComponents(ui.galeria([banner.url], panel.titulo));
        }

        c.addSeparatorComponents(ui.linea())
            .addSectionComponents(
                new SectionBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `${this.emojis.rol('verificado')} **¿Listo para entrar?**\n` +
                            `-# ${panel.nota}`
                        )
                    )
                    .setButtonAccessory(
                        ui.conEmoji(
                            new ButtonBuilder()
                                .setCustomId('verify:hacer')
                                .setLabel(panel.etiquetaBoton)
                                .setStyle(ButtonStyle.Success)
                                .setDisabled(!activo || !rolId),
                            this.emojis.rol('exito')
                        )
                    )
            );

        return { components: [c], files, flags: ui.V2 };
    }

    async publicarPanel(canal) {
        const carga = this.construirPanel();
        const { panel } = this.db.data;

        if (panel.canalId === canal.id && panel.mensajeId) {
            const previo = await canal.messages.fetch(panel.mensajeId).catch(() => null);
            if (previo) {
                await previo.edit({ ...carga, attachments: [] });
                return previo;
            }
        }

        const mensaje = await canal.send(carga);
        this.db.data.panel = { canalId: canal.id, mensajeId: mensaje.id };
        this.db.save();
        return mensaje;
    }

    async refrescarPanel() {
        const { canalId, mensajeId } = this.db.data.panel;
        if (!canalId || !mensajeId) return;
        const canal = await this.client.channels.fetch(canalId).catch(() => null);
        const mensaje = canal ? await canal.messages.fetch(mensajeId).catch(() => null) : null;
        if (!mensaje) return;
        await mensaje.edit({ ...this.construirPanel(), attachments: [] }).catch(error =>
            logger.warn('verify', `No se pudo refrescar el panel: ${error.message}`)
        );
    }

    async handle(interaction, accion) {
        if (accion !== 'hacer') return;

        const { rolId, activo } = this.config;

        if (!activo || !rolId) {
            return interaction.reply({
                components: [ui.error(this.emojis, 'La verificacion no esta configurada todavia.')],
                flags: ui.V2_EFIMERO
            });
        }

        if (interaction.member.roles.cache.has(rolId)) {
            return interaction.reply({
                components: [ui.info(this.emojis, 'Ya estabas verificado.')],
                flags: ui.V2_EFIMERO
            });
        }

        try {
            await interaction.member.roles.add(rolId);
        } catch (error) {
            logger.error('verify', `No se pudo dar el rol: ${error.message}`);
            return interaction.reply({
                components: [ui.error(this.emojis, 'No he podido darte el rol. Avisa a un administrador.')],
                flags: ui.V2_EFIMERO
            });
        }

        this.db.data.verificados[interaction.user.id] = Date.now();
        this.db.save();
        this.refrescarPanel().catch(() => {});

        Promise.resolve(this.client.sistemas?.log?.enviar('bot',
            `## ${this.emojis.rol('verificado')} Miembro verificado\n\n` +
            `${this.emojis.rol('usuario')} **Usuario:** <@${interaction.user.id}> · ${ui.dato(interaction.user.tag)}\n` +
            `${this.emojis.rol('rango')} **Rol:** <@&${rolId}>\n` +
            `${this.emojis.rol('reloj')} **Fecha:** ${ui.fecha(Date.now(), 'F')}`
        )).catch(error => logger.warn('verify', `No se pudo registrar la verificacion: ${error.message}`));

        await interaction.reply({
            components: [ui.exito(this.emojis, 'Verificado. Ya tienes acceso al resto del servidor.')],
            flags: ui.V2_EFIMERO
        });
    }
}

module.exports = VerifySystem;
