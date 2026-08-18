'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

const ui = require('../../utils/ui');
const permisos = require('../../utils/permisos');

const UNIDADES = { m: 60000, h: 3600000, d: 86400000 };

/**
 * Acepta un desplazamiento relativo ("2h", "3d") o una fecha absoluta
 * ("2026-09-01 18:30"). Devuelve la marca de tiempo, o NaN si no se entiende.
 */
function momento(texto) {
    const limpio = String(texto ?? '').trim();

    const relativo = limpio.toLowerCase().match(/^(\d+)\s*([mhd])$/);
    if (relativo) return Date.now() + Number(relativo[1]) * UNIDADES[relativo[2]];

    // Se interpreta como hora local del servidor donde corre el bot.
    const absoluto = Date.parse(limpio.replace(' ', 'T'));
    return Number.isFinite(absoluto) ? absoluto : NaN;
}

module.exports = {
    cooldown: 3,

    data: new SlashCommandBuilder()
        .setName('schedule')
        .setDescription('Publish a message later, once or on a repeating cadence')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addSubcommand(sub => sub
            .setName('message')
            .setDescription('Schedule a text message')
            .addChannelOption(o => o
                .setName('channel')
                .setDescription('Destination channel')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText))
            .addStringOption(o => o
                .setName('when')
                .setDescription('Relative like 2h or 3d, or absolute like 2026-09-01 18:30')
                .setRequired(true)
                .setMaxLength(40))
            .addStringOption(o => o
                .setName('title')
                .setDescription('Heading shown at the top of the message')
                .setRequired(true)
                .setMaxLength(200))
            .addStringOption(o => o
                .setName('body')
                .setDescription('Message body. Use \\n for a line break')
                .setRequired(true)
                .setMaxLength(1800))
            .addStringOption(o => o
                .setName('repeat')
                .setDescription('Repeat cadence')
                .addChoices(
                    { name: 'Daily', value: 'diaria' },
                    { name: 'Weekly', value: 'semanal' },
                    { name: 'Monthly', value: 'mensual' }
                ))
            .addStringOption(o => o
                .setName('mention')
                .setDescription('Mentions to allow when it is published')
                .addChoices(
                    { name: 'None', value: 'ninguna' },
                    { name: 'Roles', value: 'roles' },
                    { name: 'Everyone', value: 'everyone' }
                ))
            .addStringOption(o => o
                .setName('label')
                .setDescription('Internal name to recognise it in the list')
                .setMaxLength(80)))
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('Show every pending scheduled message'))
        .addSubcommand(sub => sub
            .setName('cancel')
            .setDescription('Cancel a pending scheduled message')
            .addStringOption(o => o
                .setName('id')
                .setDescription('Scheduled message number')
                .setRequired(true))),

    async execute(interaction, { client, emojis }) {
        const sistema = client.sistemas?.programados;
        if (!sistema) {
            return ui.responderEfimero(interaction, ui.error(emojis, 'El programador no está disponible.'));
        }
        if (permisos.nivelDe(interaction.member) < 3) {
            return ui.responderEfimero(interaction, ui.error(emojis, 'Necesitas nivel de moderador para programar mensajes.'));
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'list') {
            return ui.responderEfimero(interaction, sistema.resumen());
        }

        if (sub === 'cancel') {
            const cancelado = sistema.cancelar(interaction.options.getString('id'));
            return ui.responderEfimero(interaction, cancelado
                ? ui.exito(emojis, `Mensaje programado **#${cancelado.id}** («${ui.plano(cancelado.nombre)}») cancelado.`)
                : ui.error(emojis, 'Ese mensaje no existe o ya no está pendiente.'));
        }

        const cuando = momento(interaction.options.getString('when'));
        if (Number.isNaN(cuando)) {
            return ui.responderEfimero(interaction, ui.error(emojis,
                'No entiendo esa fecha. Usa `2h`, `3d` o `2026-09-01 18:30`.'));
        }
        if (cuando <= Date.now()) {
            return ui.responderEfimero(interaction, ui.error(emojis, 'Esa fecha ya ha pasado.'));
        }

        const adelanto = Number(sistema.config.adelantoMaximoMs) || 31536000000;
        if (cuando - Date.now() > adelanto) {
            return ui.responderEfimero(interaction, ui.error(emojis,
                `No se puede programar con más de ${ui.duracion(adelanto)} de antelación.`));
        }

        const mencion = interaction.options.getString('mention') ?? 'ninguna';
        if (mencion === 'everyone' && !interaction.memberPermissions?.has(PermissionFlagsBits.MentionEveryone)) {
            return ui.responderEfimero(interaction, ui.error(emojis,
                'Necesitas el permiso Mencionar a todos para programar un mensaje con @everyone.'));
        }

        const canal = interaction.options.getChannel('channel');
        const bloques = [
            { tipo: 'titulo', texto: interaction.options.getString('title'), nivel: 2 },
            { tipo: 'separador', divisor: true, espaciado: 'grande' },
            { tipo: 'texto', contenido: interaction.options.getString('body').replaceAll('\\n', '\n') }
        ];

        let programado;
        try {
            programado = sistema.programar({
                canalId: canal.id,
                bloques,
                enviarEn: cuando,
                repeticion: interaction.options.getString('repeat') ?? null,
                mencion,
                autorId: interaction.user.id,
                nombre: interaction.options.getString('label') ?? interaction.options.getString('title')
            });
        } catch (error) {
            return ui.responderEfimero(interaction, ui.error(emojis, ui.plano(error.message)));
        }

        return ui.responderEfimero(interaction, ui.panel(emojis, {
            emoji: 'programado',
            titulo: 'Mensaje programado',
            cuerpo: [ui.campos(emojis, [
                { emoji: 'canal', etiqueta: 'Canal', valor: `<#${canal.id}>` },
                { emoji: 'reloj', etiqueta: 'Se publica', valor: `${ui.fecha(cuando, 'F')} · ${ui.fecha(cuando, 'R')}` },
                { emoji: 'actualizar', etiqueta: 'Repetición', valor: programado.repeticion ?? 'una sola vez' },
                { emoji: 'anuncio', etiqueta: 'Menciones', valor: mencion }
            ])],
            pie: `Identificador #${programado.id}. Cancélalo con /schedule cancel id:${programado.id}.`
        }));
    }
};
