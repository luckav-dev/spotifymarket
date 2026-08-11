'use strict';

const {
    ContainerBuilder,
    TextDisplayBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder
} = require('discord.js');

const config = require('../utils/config');
const logger = require('../utils/logger');
const media = require('../utils/media');
const ui = require('../utils/ui');
const Database = require('../utils/jsonDatabase');

const ESQUEMA = { panel: { canalId: '', mensajeId: '' } };

/** Panel navegable de normas, completamente definido desde config/rules.json. */
class RulesSystem {
    constructor(client, emojis) {
        this.client = client;
        this.emojis = emojis;
        this.db = new Database('rules', ESQUEMA);
    }

    get config() {
        return config.cargar('rules');
    }

    iniciar() {
        const total = Object.keys(this.config.categorias ?? {}).length;
        if (!total) logger.warn('normas', 'No hay categorías definidas en config/rules.json.');
    }

    construirPanel() {
        const { panel, categorias = {} } = this.config;
        const banner = media.resolver(panel.banner, 'spotify-market-normas');
        const opciones = Object.entries(categorias).slice(0, 25).map(([clave, categoria]) => {
            const opcion = new StringSelectMenuOptionBuilder()
                .setLabel(categoria.nombre)
                .setDescription(categoria.descripcion.slice(0, 100))
                .setValue(clave);
            const emoji = this.emojis.get(categoria.emoji);
            if (emoji) opcion.setEmoji(emoji);
            return opcion;
        });

        const c = new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# ${this.emojis.rol('reglas')} ${panel.titulo}\n` +
                `> **${panel.subtitulo}**\n` +
                `> ${panel.descripcion}`
            )
        );

        if (banner) {
            c.addSeparatorComponents(ui.linea());
            c.addMediaGalleryComponents(ui.galeria([banner.url], panel.titulo));
        }

        c.addSeparatorComponents(ui.linea());
        let resumen = `## ${this.emojis.rol('info')} Categorías disponibles\n\n`;
        for (const categoria of Object.values(categorias)) {
            resumen += `${this.emojis.get(categoria.emoji)} **${categoria.nombre}**\n> ${categoria.descripcion}\n`;
        }
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(resumen.trim()));

        if (opciones.length) {
            c.addSeparatorComponents(ui.linea());
            c.addActionRowComponents(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('rules:ver')
                    .setPlaceholder(panel.placeholder)
                    .addOptions(opciones)
            ));
        }

        if (panel.nota) {
            c.addSeparatorComponents(ui.aire());
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${panel.nota}`));
        }

        return { components: [c], files: banner?.files ?? [], flags: ui.V2 };
    }

    construirCategoria(clave) {
        const categoria = this.config.categorias?.[clave];
        if (!categoria) return null;

        const cuerpo = [];
        for (const seccion of categoria.secciones ?? []) {
            const contenido = (seccion.contenido ?? []).map((regla, i) => `**${i + 1}.** ${regla}`).join('\n');
            cuerpo.push(ui.texto(`### ${this.emojis.get(categoria.emoji)} ${seccion.titulo}\n${contenido}`));
            cuerpo.push(ui.linea());
        }
        if (cuerpo.length) cuerpo.pop();

        return ui.panel(this.emojis, {
            emoji: categoria.emoji,
            titulo: categoria.nombre,
            subtitulo: categoria.descripcion,
            cuerpo,
            pie: this.config.panel.nota
        });
    }

    async publicarPanel(canal) {
        const carga = this.construirPanel();
        const panel = this.db.data.panel;

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

    async handle(interaction, accion) {
        if (accion !== 'ver') return undefined;
        const container = this.construirCategoria(interaction.values[0]);
        if (!container) {
            return interaction.reply({
                components: [ui.error(this.emojis, 'Esa categoría ya no existe.')],
                flags: ui.V2_EFIMERO
            });
        }

        return interaction.reply({
            components: [container],
            flags: ui.V2_EFIMERO,
            allowedMentions: { parse: [] }
        });
    }
}

module.exports = RulesSystem;
