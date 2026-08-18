'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

const ui = require('../../utils/ui');
const permisos = require('../../utils/permisos');

const UNIDADES = { m: 60000, h: 3600000, d: 86400000 };

function duracionMs(texto) {
    const partes = String(texto ?? '').trim().toLowerCase().match(/^(\d+)\s*([mhd])$/);
    return partes ? Number(partes[1]) * UNIDADES[partes[2]] : NaN;
}

module.exports = {
    cooldown: 5,

    data: new SlashCommandBuilder()
        .setName('poll')
        .setDescription('Open a community poll with one vote per member')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setDMPermission(false)
        .addSubcommand(sub => {
            sub.setName('start')
                .setDescription('Publish a new poll')
                .addStringOption(o => o
                    .setName('question')
                    .setDescription('The question members will answer')
                    .setRequired(true)
                    .setMaxLength(250))
                .addStringOption(o => o
                    .setName('option_1')
                    .setDescription('First answer')
                    .setRequired(true)
                    .setMaxLength(100))
                .addStringOption(o => o
                    .setName('option_2')
                    .setDescription('Second answer')
                    .setRequired(true)
                    .setMaxLength(100));

            for (const numero of [3, 4, 5, 6]) {
                sub.addStringOption(o => o
                    .setName(`option_${numero}`)
                    .setDescription(`Answer number ${numero}`)
                    .setMaxLength(100));
            }

            return sub
                .addStringOption(o => o
                    .setName('duration')
                    .setDescription('How long it stays open, for example 6h or 3d')
                    .setMaxLength(10))
                .addChannelOption(o => o
                    .setName('channel')
                    .setDescription('Where to publish it')
                    .addChannelTypes(ChannelType.GuildText))
                .addStringOption(o => o
                    .setName('details')
                    .setDescription('Extra context shown under the question')
                    .setMaxLength(400));
        })
        .addSubcommand(sub => sub
            .setName('close')
            .setDescription('Close a running poll and publish the result')
            .addStringOption(o => o
                .setName('id')
                .setDescription('Poll number')
                .setRequired(true))),

    async execute(interaction, { client, emojis }) {
        const sistema = client.sistemas?.encuesta;
        if (!sistema) {
            return ui.responderEfimero(interaction, ui.error(emojis, 'El sistema de encuestas no está disponible.'));
        }
        if (permisos.nivelDe(interaction.member) < 1) {
            return ui.responderEfimero(interaction, ui.error(emojis, 'Necesitas ser parte del equipo para abrir encuestas.'));
        }

        if (interaction.options.getSubcommand() === 'close') {
            const encuesta = sistema.db.data.encuestas[interaction.options.getString('id')];
            if (!encuesta || encuesta.estado !== 'activa') {
                return ui.responderEfimero(interaction, ui.error(emojis, 'Esa encuesta no existe o ya está cerrada.'));
            }

            await interaction.deferReply({ flags: ui.V2_EFIMERO });
            await sistema.cerrar(encuesta);
            return ui.responderEfimero(interaction, ui.exito(emojis,
                `Encuesta #${encuesta.id} cerrada con ${Object.keys(encuesta.votos).length} voto(s).`));
        }

        const opciones = [1, 2, 3, 4, 5, 6]
            .map(numero => interaction.options.getString(`option_${numero}`))
            .filter(opcion => opcion?.trim())
            .map(opcion => opcion.trim());

        if (new Set(opciones.map(o => o.toLowerCase())).size !== opciones.length) {
            return ui.responderEfimero(interaction, ui.error(emojis, 'Hay opciones repetidas. Cada respuesta tiene que ser distinta.'));
        }

        const textoDuracion = interaction.options.getString('duration');
        const duracion = textoDuracion ? duracionMs(textoDuracion) : 86400000;
        if (Number.isNaN(duracion) || duracion <= 0) {
            return ui.responderEfimero(interaction, ui.error(emojis, 'Duración no válida. Usa por ejemplo `6h` o `3d`.'));
        }

        const maxima = Number(sistema.config.duracionMaximaMs) || 2592000000;
        if (duracion > maxima) {
            return ui.responderEfimero(interaction, ui.error(emojis, `La duración máxima permitida es ${ui.duracion(maxima)}.`));
        }

        const canal = interaction.options.getChannel('channel') ?? interaction.channel;
        await interaction.deferReply({ flags: ui.V2_EFIMERO });

        const encuesta = await sistema.crear(canal, {
            pregunta: interaction.options.getString('question'),
            descripcion: interaction.options.getString('details') ?? '',
            opciones,
            duracionMs: duracion,
            autorId: interaction.user.id
        });

        return ui.responderEfimero(interaction, ui.exito(emojis,
            `Encuesta **#${encuesta.id}** publicada en <#${canal.id}>. Se cierra ${ui.fecha(encuesta.terminaEn, 'R')}.`));
    }
};
