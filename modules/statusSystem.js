'use strict';

const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    LabelBuilder,
    MessageFlags,
    ModalBuilder,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

const config = require('../utils/config');
const Database = require('../utils/jsonDatabase');
const permisos = require('../utils/permisos');
const ui = require('../utils/ui');
const logger = require('../utils/logger');

const ESQUEMA = {
    estado: '',
    nota: '',
    cambiadoPor: null,
    cambiadoEn: null,
    historial: [],
    paneles: {}
};

class StatusSystem {
    constructor(client, emojis) {
        this.client = client;
        this.emojis = emojis;
        this.db = new Database('status', ESQUEMA);

        if (!this.config.estados?.[this.db.data.estado]) {
            this.db.data.estado = this.config.estadoPorDefecto;
            this.db.save();
        }
    }

    get config() {
        return config.cargar('status');
    }

    actual() {
        return this.config.estados[this.db.data.estado]
            ?? this.config.estados[this.config.estadoPorDefecto];
    }

    claves() {
        return Object.entries(this.config.estados)
            .sort(([, a], [, b]) => (a.orden ?? 99) - (b.orden ?? 99))
            .map(([clave]) => clave)
            .slice(0, 4);
    }

    barraAscii(valor, ancho = 24) {
        const porcentaje = Math.max(0, Math.min(100, Number(valor) || 0));
        const llenos = Math.round((porcentaje / 100) * ancho);
        return `[${'#'.repeat(llenos)}${'-'.repeat(ancho - llenos)}] ${String(porcentaje).padStart(3, ' ')}%`;
    }

    textoAscii(texto, ancho) {
        return String(texto)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\x20-\x7E]/g, '')
            .toUpperCase()
            .slice(0, ancho)
            .padEnd(ancho, ' ');
    }

    construirPanel({ controles = true, efimero = false } = {}) {
        const cfg = this.config;
        const estado = this.actual();
        const actualizado = this.db.data.cambiadoEn ?? Date.now();
        const estadoAscii = this.textoAscii(estado.nombre, 42);
        const capacidad = this.barraAscii(estado.porcentaje ?? 100);
        const filaAscii = contenido => `| ${String(contenido).slice(0, 52).padEnd(52, ' ')} |`;
        const c = new ContainerBuilder()
            .addTextDisplayComponents(ui.cabecera(this.emojis, {
                emoji: estado.emoji,
                titulo: cfg.titulo,
                subtitulo: `> ${cfg.descripcion}`
            }))
            .addSeparatorComponents(ui.linea())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                '```text\n' +
                '+------------------------------------------------------+\n' +
                `${filaAscii(`SERVICE   ${estadoAscii}`)}\n` +
                `${filaAscii(`CAPACITY  ${capacidad}`)}\n` +
                '+------------------------------------------------------+\n' +
                '```\n' +
                `${this.emojis.rol(estado.emoji)} **${estado.nombre}** · ${estado.descripcion}`
            ));

        if (this.db.data.nota?.trim()) {
            c.addSeparatorComponents(ui.linea());
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `${this.emojis.rol('anuncio')} **Team update** · ${ui.plano(ui.truncar(this.db.data.nota, 500)).replace(/\n/g, ' / ')}`
            ));
        }

        if (cfg.mostrarHistorial && this.db.data.historial.length) {
            const ultimo = this.db.data.historial[0];
            const anterior = cfg.estados[ultimo.estado];
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `-# Recent change: ${anterior?.nombre ?? ultimo.estado} · ${ui.fecha(ultimo.fecha)}`
            ));
        }

        if (controles) {
            c.addSeparatorComponents(ui.linea());
            const fila = new ActionRowBuilder();
            for (const clave of this.claves()) {
                const opcion = cfg.estados[clave];
                fila.addComponents(ui.conEmoji(
                    new ButtonBuilder()
                        .setCustomId(`status:set:${clave}`)
                        .setLabel(opcion.nombreAdmin ?? opcion.nombre)
                        .setStyle(clave === this.db.data.estado ? ButtonStyle.Primary : ButtonStyle.Secondary)
                        .setDisabled(clave === this.db.data.estado),
                    this.emojis.rol(opcion.emoji)
                ));
            }
            fila.addComponents(ui.conEmoji(
                new ButtonBuilder()
                    .setCustomId('status:nota')
                    .setLabel('Nota del equipo')
                    .setStyle(ButtonStyle.Secondary),
                this.emojis.rol('editar')
            ));
            c.addActionRowComponents(fila);
        }

        c.addSeparatorComponents(ui.linea());
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(ui.pie(
            `Last updated ${ui.fecha(actualizado)} · live service information`
        )));

        return {
            components: [c],
            flags: efimero ? ui.V2_EFIMERO : ui.V2,
            allowedMentions: { parse: [] }
        };
    }

    async publicarPanel(canal) {
        const anteriorId = this.db.data.paneles[canal.id];
        if (anteriorId) {
            const anterior = await canal.messages.fetch(anteriorId).catch(() => null);
            if (anterior) {
                await anterior.edit({ ...this.construirPanel({ controles: false }), attachments: [] });
                return anterior;
            }
        }

        const mensaje = await canal.send(this.construirPanel({ controles: false }));
        this.db.data.paneles[canal.id] = mensaje.id;
        this.db.save();
        return mensaje;
    }

    async refrescarPaneles() {
        for (const [canalId, mensajeId] of Object.entries({ ...this.db.data.paneles })) {
            const canal = await this.client.channels.fetch(canalId).catch(() => null);
            const mensaje = canal?.isTextBased?.()
                ? await canal.messages.fetch(mensajeId).catch(() => null)
                : null;
            if (!mensaje) {
                delete this.db.data.paneles[canalId];
                this.db.save();
                continue;
            }
            await mensaje.edit({ ...this.construirPanel({ controles: false }), attachments: [] }).catch(error =>
                logger.error('estado', `No se pudo refrescar un panel: ${error.message}`));
        }
    }

    async cambiar(clave, usuarioId, nota = null) {
        if (!this.config.estados[clave]) return null;

        if (this.db.data.estado !== clave) {
            this.db.data.historial.unshift({ estado: clave, fecha: Date.now(), usuarioId });
            this.db.data.historial = this.db.data.historial.slice(0, 20);
        }
        this.db.data.estado = clave;
        this.db.data.cambiadoPor = usuarioId;
        this.db.data.cambiadoEn = Date.now();
        if (nota !== null) this.db.data.nota = nota.trim();
        this.db.save();

        await this.refrescarPaneles();
        await this.client.sistemas.log.enviar('bot',
            `## ${this.emojis.rol('actualizar')} Estado del servicio actualizado\n\n` +
            `${this.emojis.rol('info')} **Estado:** ${this.actual().nombreAdmin ?? this.actual().nombre}\n` +
            `${this.emojis.rol('usuario')} **Por:** <@${usuarioId}>` +
            (nota?.trim() ? `\n${this.emojis.rol('anuncio')} **Nota:** ${ui.plano(ui.truncar(nota, 700))}` : '')
        );
        return this.actual();
    }

    puedeGestionar(interaction) {
        return permisos.puede(interaction.member, 'estadoServicio');
    }

    async handle(interaction, accion, datos) {
        if (!this.config.activo) {
            return ui.responderEfimero(interaction, ui.aviso(this.emojis, 'El panel de estado está desactivado.'));
        }
        if (!this.puedeGestionar(interaction)) {
            return ui.responderEfimero(interaction, ui.error(this.emojis, 'This control is restricted to the administration team.'));
        }

        if (accion === 'set') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const estado = await this.cambiar(datos[0], interaction.user.id);
            return interaction.editReply({
                components: [estado
                    ? ui.exito(this.emojis, `Estado cambiado a **${estado.nombreAdmin ?? estado.nombre}**.`)
                    : ui.error(this.emojis, 'Ese estado ya no existe.')],
                flags: ui.V2
            });
        }

        if (accion === 'nota') {
            const entrada = new TextInputBuilder()
                .setCustomId('texto')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setMaxLength(700);
            if (this.db.data.nota) entrada.setValue(this.db.data.nota.slice(0, 700));
            return interaction.showModal(
                new ModalBuilder()
                    .setCustomId('status:guardarNota')
                    .setTitle('Nota del estado')
                    .addLabelComponents(
                        new LabelBuilder()
                            .setLabel('Nota pública')
                            .setDescription('Déjala vacía para quitarla')
                            .setTextInputComponent(entrada)
                    )
            );
        }

        if (accion === 'guardarNota') {
            const nota = interaction.fields.getTextInputValue('texto');
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            await this.cambiar(this.db.data.estado, interaction.user.id, nota);
            return interaction.editReply({
                components: [ui.exito(this.emojis, nota.trim() ? 'Nota del estado actualizada.' : 'Nota del estado eliminada.')],
                flags: ui.V2
            });
        }
        return undefined;
    }
}

module.exports = StatusSystem;
