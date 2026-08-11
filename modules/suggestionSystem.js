'use strict';

const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ContainerBuilder,
    LabelBuilder,
    MessageFlags,
    ModalBuilder,
    StringSelectMenuBuilder,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

const config = require('../utils/config');
const Database = require('../utils/jsonDatabase');
const media = require('../utils/media');
const permisos = require('../utils/permisos');
const ui = require('../utils/ui');

const ESQUEMA = {
    contador: 0,
    sugerencias: {},
    paneles: {}
};

class SuggestionSystem {
    constructor(client, emojis) {
        this.client = client;
        this.emojis = emojis;
        this.db = new Database('suggestions', ESQUEMA);
        this.colas = new Map();
    }

    get config() {
        return config.cargar('suggestions');
    }

    estado(clave) {
        return this.config.estados[clave] ?? this.config.estados.abierta;
    }

    async encolar(id, tarea) {
        const anterior = this.colas.get(id) ?? Promise.resolve();
        const actual = anterior.catch(() => {}).then(tarea);
        this.colas.set(id, actual);
        try {
            return await actual;
        } finally {
            if (this.colas.get(id) === actual) this.colas.delete(id);
        }
    }

    construirPanel() {
        const cfg = this.config;
        const banner = media.resolver(cfg.panel.banner, 'spotify-market-sugerencias');
        const c = new ContainerBuilder()
            .addTextDisplayComponents(ui.cabecera(this.emojis, {
                emoji: 'pregunta',
                titulo: cfg.panel.titulo,
                subtitulo: `> ${cfg.panel.descripcion}`
            }));

        if (cfg.panel.mostrarGuia) {
            c.addSeparatorComponents(ui.linea());
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### ${this.emojis.rol('reglas')} Antes de enviarla\n` +
                `> ${this.emojis.rol('buscar')} Comprueba que la idea no esté repetida.\n` +
                `> ${this.emojis.rol('editar')} Explica qué problema resuelve y cómo debería funcionar.\n` +
                `> ${this.emojis.rol('miembros')} La comunidad podrá votar y el equipo responderá.`
            ));
        }

        if (banner) {
            c.addSeparatorComponents(ui.linea());
            c.addMediaGalleryComponents(ui.galeria([banner.url], cfg.panel.titulo));
        }

        c.addSeparatorComponents(ui.linea());
        c.addSectionComponents(ui.seccionBoton(
            `${this.emojis.rol('anadir')} **¿Tienes una propuesta?**\n` +
            `-# Se publicará con tu autoría y un identificador de seguimiento.`,
            ui.boton(this.emojis, {
                id: 'suggest:nueva',
                etiqueta: cfg.panel.etiquetaBoton,
                emoji: 'pregunta'
            })
        ));
        c.addSeparatorComponents(ui.aire());
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            ui.pie(`Una sugerencia cada ${ui.duracion(cfg.cooldownMs)} · Los votos son únicos por usuario`)
        ));

        return {
            components: [c],
            files: banner?.files ?? [],
            flags: ui.V2,
            allowedMentions: { parse: [] }
        };
    }

    async publicarPanel(canal) {
        const anteriorId = this.db.data.paneles[canal.id];
        if (anteriorId) {
            const anterior = await canal.messages.fetch(anteriorId).catch(() => null);
            if (anterior) {
                await anterior.edit({ ...this.construirPanel(), attachments: [] });
                return anterior;
            }
        }

        const mensaje = await canal.send(this.construirPanel());
        this.db.data.paneles[canal.id] = mensaje.id;
        this.db.save();
        return mensaje;
    }

    modalNueva() {
        return new ModalBuilder()
            .setCustomId('suggest:enviar')
            .setTitle('Nueva sugerencia')
            .addLabelComponents(
                new LabelBuilder()
                    .setLabel('Título')
                    .setDescription('Resume la propuesta en una línea')
                    .setTextInputComponent(
                        new TextInputBuilder()
                            .setCustomId('titulo')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                            .setMinLength(5)
                            .setMaxLength(120)
                    )
            )
            .addLabelComponents(
                new LabelBuilder()
                    .setLabel('Detalle')
                    .setDescription('Explica el problema y la solución que propones')
                    .setTextInputComponent(
                        new TextInputBuilder()
                            .setCustomId('detalle')
                            .setStyle(TextInputStyle.Paragraph)
                            .setRequired(true)
                            .setMinLength(20)
                            .setMaxLength(1200)
                    )
            );
    }

    ultimoEnvio(userId) {
        return Object.values(this.db.data.sugerencias)
            .filter(s => s.userId === userId)
            .reduce((ultimo, s) => Math.max(ultimo, s.fecha ?? 0), 0);
    }

    async abrirModal(interaction) {
        if (!this.config.activo) {
            return ui.responderEfimero(interaction, ui.aviso(this.emojis, 'Las sugerencias están desactivadas ahora mismo.'));
        }
        const restante = this.config.cooldownMs - (Date.now() - this.ultimoEnvio(interaction.user.id));
        if (restante > 0) {
            return ui.responderEfimero(interaction, ui.aviso(this.emojis,
                `Espera ${ui.duracion(restante)} antes de enviar otra sugerencia.`));
        }
        return interaction.showModal(this.modalNueva());
    }

    async construirSugerencia(sugerencia) {
        const estado = this.estado(sugerencia.estado);
        const autor = await this.client.users.fetch(sugerencia.userId).catch(() => null);
        const positivos = sugerencia.votos.aFavor.length;
        const negativos = sugerencia.votos.enContra.length;
        const total = positivos + negativos;
        const porcentaje = total ? Math.round((positivos / total) * 100) : 0;

        const cabecera =
            `## ${this.emojis.rol(estado.emoji)} Sugerencia #${String(sugerencia.numero).padStart(4, '0')} · ${estado.nombre}\n` +
            `${this.emojis.rol('usuario')} **Autor:** <@${sugerencia.userId}>\n` +
            `${this.emojis.rol('reloj')} **Publicada:** ${ui.fecha(sugerencia.fecha)}`;

        const c = new ContainerBuilder();
        if (autor) c.addSectionComponents(ui.seccionMiniatura(cabecera, autor.displayAvatarURL({ size: 128 }), 'Avatar del autor'));
        else c.addTextDisplayComponents(new TextDisplayBuilder().setContent(cabecera));

        c.addSeparatorComponents(ui.linea());
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### ${ui.plano(sugerencia.titulo)}\n${ui.cita(ui.plano(sugerencia.detalle))}`
        ));

        if (this.config.votos.activo && !this.config.votos.ocultarRecuento) {
            c.addSeparatorComponents(ui.aire());
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `${this.emojis.get('like')} **${positivos} a favor** · ${this.emojis.get('dislike')} **${negativos} en contra**\n` +
                `\`${ui.barra(positivos, total, 14)}\` ${total ? `${porcentaje}% favorable` : 'Sin votos todavía'}`
            ));
        }

        if (sugerencia.respuesta) {
            c.addSeparatorComponents(ui.linea());
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### ${this.emojis.rol('administrador')} Respuesta del equipo\n` +
                `${ui.cita(ui.plano(sugerencia.respuesta.texto))}\n` +
                `-# Respondida por <@${sugerencia.respuesta.staffId}> · ${ui.fecha(sugerencia.respuesta.fecha)}`
            ));
        }

        const cerrada = sugerencia.estado !== 'abierta' && sugerencia.estado !== 'revision';
        const fila = new ActionRowBuilder();
        if (this.config.votos.activo) {
            fila.addComponents(
                ui.conEmoji(
                    new ButtonBuilder()
                        .setCustomId(`suggest:voto:${sugerencia.id}:up`)
                        .setLabel(this.config.votos.ocultarRecuento ? 'A favor' : String(positivos))
                        .setStyle(ButtonStyle.Success)
                        .setDisabled(cerrada),
                    this.emojis.get('like')
                ),
                ui.conEmoji(
                    new ButtonBuilder()
                        .setCustomId(`suggest:voto:${sugerencia.id}:down`)
                        .setLabel(this.config.votos.ocultarRecuento ? 'En contra' : String(negativos))
                        .setStyle(ButtonStyle.Danger)
                        .setDisabled(cerrada),
                    this.emojis.get('dislike')
                )
            );
        }
        fila.addComponents(ui.boton(this.emojis, {
            id: `suggest:resolver:${sugerencia.id}`,
            etiqueta: 'Responder',
            emoji: 'administrador'
        }));
        c.addSeparatorComponents(ui.linea());
        c.addActionRowComponents(fila);
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(ui.pie(`ID ${sugerencia.id}`)));

        return { components: [c], flags: ui.V2, allowedMentions: { parse: [] } };
    }

    async refrescar(sugerencia) {
        const canal = await this.client.channels.fetch(sugerencia.canalId).catch(() => null);
        const mensaje = canal?.isTextBased?.()
            ? await canal.messages.fetch(sugerencia.mensajeId).catch(() => null)
            : null;
        if (mensaje) await mensaje.edit(await this.construirSugerencia(sugerencia));
    }

    async enviar(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const configurado = this.config.canalPublicacionId;
        const canal = configurado
            ? await this.client.channels.fetch(configurado).catch(() => null)
            : interaction.channel;
        if (!canal?.isTextBased?.()) {
            return interaction.editReply({
                components: [ui.error(this.emojis, 'El canal de sugerencias no está configurado o ya no existe.')],
                flags: ui.V2
            });
        }

        const numero = ++this.db.data.contador;
        const sugerencia = {
            id: `s${numero.toString(36)}`,
            numero,
            userId: interaction.user.id,
            titulo: interaction.fields.getTextInputValue('titulo').trim(),
            detalle: interaction.fields.getTextInputValue('detalle').trim(),
            estado: 'abierta',
            votos: { aFavor: [], enContra: [] },
            respuesta: null,
            fecha: Date.now(),
            canalId: canal.id,
            mensajeId: null
        };

        const mensaje = await canal.send(await this.construirSugerencia(sugerencia));
        sugerencia.mensajeId = mensaje.id;
        this.db.data.sugerencias[sugerencia.id] = sugerencia;
        this.db.save();

        if (this.config.crearHilo && canal.type === ChannelType.GuildText) {
            await mensaje.startThread({
                name: `Sugerencia #${String(numero).padStart(4, '0')} · ${sugerencia.titulo}`.slice(0, 100),
                autoArchiveDuration: 1440
            }).catch(() => {});
        }

        await this.client.sistemas.log.enviar('bot',
            `## ${this.emojis.rol('pregunta')} Sugerencia publicada\n\n` +
            `${this.emojis.rol('usuario')} **Autor:** <@${sugerencia.userId}>\n` +
            `${this.emojis.rol('enlace')} **Mensaje:** [Abrir sugerencia](${mensaje.url})\n\n` +
            `> ${ui.plano(ui.truncar(sugerencia.titulo, 120))}`
        );

        return interaction.editReply({
            components: [ui.exito(this.emojis, `Sugerencia publicada en <#${canal.id}>.\n-# [Ir al mensaje](${mensaje.url})`)],
            flags: ui.V2
        });
    }

    async votar(interaction, id, sentido) {
        await interaction.deferUpdate();
        return this.encolar(id, async () => {
            const sugerencia = this.db.data.sugerencias[id];
            if (!sugerencia) {
                return interaction.followUp({
                    components: [ui.error(this.emojis, 'Esa sugerencia ya no existe.')],
                    flags: ui.V2_EFIMERO
                });
            }
            if (!['abierta', 'revision'].includes(sugerencia.estado)) {
                return interaction.followUp({
                    components: [ui.aviso(this.emojis, 'La votación de esta sugerencia ya está cerrada.')],
                    flags: ui.V2_EFIMERO
                });
            }

            const userId = interaction.user.id;
            const destino = sentido === 'up' ? sugerencia.votos.aFavor : sugerencia.votos.enContra;
            const contrario = sentido === 'up' ? sugerencia.votos.enContra : sugerencia.votos.aFavor;
            const yaHabiaVotado = destino.includes(userId) || contrario.includes(userId);
            if (yaHabiaVotado && !this.config.votos.permitirCambiar) {
                return interaction.followUp({
                    components: [ui.aviso(this.emojis, 'Tu voto ya está registrado y esta votación no permite cambiarlo.')],
                    flags: ui.V2_EFIMERO
                });
            }
            const indiceContrario = contrario.indexOf(userId);
            if (indiceContrario !== -1) contrario.splice(indiceContrario, 1);

            const indice = destino.indexOf(userId);
            if (indice !== -1) destino.splice(indice, 1);
            else destino.push(userId);

            this.db.save();
            await interaction.message.edit(await this.construirSugerencia(sugerencia));
            return undefined;
        });
    }

    async abrirResolucion(interaction, id) {
        if (!permisos.puede(interaction.member, 'gestionarSugerencias')) {
            return ui.responderEfimero(interaction, ui.error(this.emojis, 'Solo el equipo puede responder sugerencias.'));
        }
        const sugerencia = this.db.data.sugerencias[id];
        if (!sugerencia) return ui.responderEfimero(interaction, ui.error(this.emojis, 'Esa sugerencia ya no existe.'));

        return interaction.showModal(
            new ModalBuilder()
                .setCustomId(`suggest:resuelta:${id}`)
                .setTitle(`Responder a #${String(sugerencia.numero).padStart(4, '0')}`)
                .addLabelComponents(
                    new LabelBuilder()
                        .setLabel('Estado')
                        .setStringSelectMenuComponent(
                            new StringSelectMenuBuilder()
                                .setCustomId('estado')
                                .addOptions(Object.entries(this.config.estados).map(([value, item]) => ({
                                    label: item.nombre,
                                    value,
                                    default: value === sugerencia.estado
                                })))
                        )
                )
                .addLabelComponents(
                    new LabelBuilder()
                        .setLabel('Respuesta pública')
                        .setDescription('Explica brevemente la decisión del equipo')
                        .setTextInputComponent(
                            new TextInputBuilder()
                                .setCustomId('respuesta')
                                .setStyle(TextInputStyle.Paragraph)
                                .setRequired(true)
                                .setMaxLength(700)
                        )
                )
        );
    }

    async resolver(interaction, id) {
        if (!permisos.puede(interaction.member, 'gestionarSugerencias')) {
            return ui.responderEfimero(interaction, ui.error(this.emojis, 'Solo el equipo puede responder sugerencias.'));
        }
        const sugerencia = this.db.data.sugerencias[id];
        if (!sugerencia) return ui.responderEfimero(interaction, ui.error(this.emojis, 'Esa sugerencia ya no existe.'));

        const estado = interaction.fields.getStringSelectValues('estado')[0];
        if (!this.config.estados[estado]) {
            return ui.responderEfimero(interaction, ui.error(this.emojis, 'Ese estado ya no existe.'));
        }

        sugerencia.estado = estado;
        sugerencia.respuesta = {
            staffId: interaction.user.id,
            texto: interaction.fields.getTextInputValue('respuesta').trim(),
            fecha: Date.now()
        };
        this.db.save();

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await this.refrescar(sugerencia);

        if (this.config.avisarAlAutor) {
            const autor = await this.client.users.fetch(sugerencia.userId).catch(() => null);
            if (autor) {
                const item = this.estado(estado);
                await autor.send({
                    components: [ui.panel(this.emojis, {
                        emoji: item.emoji,
                        titulo: `Tu sugerencia #${String(sugerencia.numero).padStart(4, '0')}`,
                        subtitulo: `Estado: **${item.nombre}**`,
                        cuerpo: [ui.cita(ui.plano(sugerencia.respuesta.texto))]
                    })],
                    flags: ui.V2,
                    allowedMentions: { parse: [] }
                }).catch(() => {});
            }
        }

        return interaction.editReply({
            components: [ui.exito(this.emojis,
                `Sugerencia #${String(sugerencia.numero).padStart(4, '0')} marcada como **${this.estado(estado).nombre}**.`)],
            flags: ui.V2
        });
    }

    async handle(interaction, accion, datos) {
        if (!this.config.activo) {
            return ui.responderEfimero(interaction, ui.aviso(this.emojis, 'Las sugerencias están desactivadas.'));
        }
        if (accion === 'nueva') return this.abrirModal(interaction);
        if (accion === 'enviar') return this.enviar(interaction);
        if (accion === 'voto') return this.votar(interaction, datos[0], datos[1]);
        if (accion === 'resolver') return this.abrirResolucion(interaction, datos[0]);
        if (accion === 'resuelta') return this.resolver(interaction, datos[0]);
        return undefined;
    }
}

module.exports = SuggestionSystem;
