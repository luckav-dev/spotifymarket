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
        .setName('giveaway')
        .setDescription('Run a giveaway with entry requirements')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addSubcommand(sub => sub
            .setName('start')
            .setDescription('Start a new giveaway')
            .addStringOption(o => o
                .setName('prize')
                .setDescription('What is being given away')
                .setRequired(true)
                .setMaxLength(200))
            .addStringOption(o => o
                .setName('duration')
                .setDescription('How long it runs, for example 30m, 12h or 3d')
                .setRequired(true)
                .setMaxLength(10))
            .addIntegerOption(o => o
                .setName('winners')
                .setDescription('How many winners are drawn')
                .setMinValue(1)
                .setMaxValue(20))
            .addChannelOption(o => o
                .setName('channel')
                .setDescription('Where to publish it')
                .addChannelTypes(ChannelType.GuildText))
            .addStringOption(o => o
                .setName('details')
                .setDescription('Extra description shown in the panel')
                .setMaxLength(500))
            .addRoleOption(o => o
                .setName('required_role')
                .setDescription('Only members with this role can enter'))
            .addStringOption(o => o
                .setName('min_membership')
                .setDescription('Minimum time in the server, for example 7d'))
            .addBooleanOption(o => o
                .setName('customers_only')
                .setDescription('Only members with a verified purchase can enter')))
        .addSubcommand(sub => sub
            .setName('end')
            .setDescription('Draw the winners of a running giveaway right now')
            .addStringOption(o => o
                .setName('id')
                .setDescription('Giveaway number')
                .setRequired(true)))
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('Show the giveaways currently running')),

    async execute(interaction, { client, emojis }) {
        const sistema = client.sistemas?.sorteo;
        if (!sistema) {
            return ui.responderEfimero(interaction, ui.error(emojis, 'El sistema de sorteos no está disponible.'));
        }
        if (permisos.nivelDe(interaction.member) < 3) {
            return ui.responderEfimero(interaction, ui.error(emojis, 'Necesitas nivel de moderador para gestionar sorteos.'));
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'list') {
            const activos = Object.values(sistema.db.data.sorteos).filter(s => s.estado === 'activo');
            if (!activos.length) {
                return ui.responderEfimero(interaction, ui.info(emojis, 'No hay ningún sorteo en curso.'));
            }
            return ui.responderEfimero(interaction, ui.panel(emojis, {
                emoji: 'sorteo',
                titulo: 'Sorteos en curso',
                cuerpo: [activos.map(s =>
                    `- **#${s.id}** · ${ui.plano(s.premio)} · <#${s.canalId}> · ` +
                    `${s.participantes.length} participante(s) · termina ${ui.fecha(s.terminaEn, 'R')}`
                ).join('\n')],
                pie: 'Adelanta uno con /giveaway end id:<número>.'
            }));
        }

        if (sub === 'end') {
            const sorteo = sistema.db.data.sorteos[interaction.options.getString('id')];
            if (!sorteo || sorteo.estado !== 'activo') {
                return ui.responderEfimero(interaction, ui.error(emojis, 'Ese sorteo no existe o ya ha terminado.'));
            }

            await interaction.deferReply({ flags: ui.V2_EFIMERO });
            await sistema.sortear(sorteo, { motivo: `adelantado por ${interaction.user.tag}` });

            return ui.responderEfimero(interaction, ui.exito(emojis,
                sorteo.premiados.length
                    ? `Sorteo #${sorteo.id} resuelto: ${sorteo.premiados.map(id => `<@${id}>`).join(', ')}.`
                    : `Sorteo #${sorteo.id} cerrado sin participantes válidos.`));
        }

        const duracion = duracionMs(interaction.options.getString('duration'));
        if (Number.isNaN(duracion) || duracion <= 0) {
            return ui.responderEfimero(interaction, ui.error(emojis,
                'Duración no válida. Usa por ejemplo `30m`, `12h` o `3d`.'));
        }

        const maxima = Number(sistema.config.duracionMaximaMs) || 2592000000;
        if (duracion > maxima) {
            return ui.responderEfimero(interaction, ui.error(emojis,
                `La duración máxima permitida es ${ui.duracion(maxima)}.`));
        }

        const antiguedadTexto = interaction.options.getString('min_membership');
        const antiguedad = antiguedadTexto ? duracionMs(antiguedadTexto) : 0;
        if (Number.isNaN(antiguedad)) {
            return ui.responderEfimero(interaction, ui.error(emojis,
                'El valor de `min_membership` no es válido. Usa por ejemplo `7d`.'));
        }

        const canal = interaction.options.getChannel('channel') ?? interaction.channel;
        await interaction.deferReply({ flags: ui.V2_EFIMERO });

        const sorteo = await sistema.crear(canal, {
            premio: interaction.options.getString('prize'),
            descripcion: interaction.options.getString('details') ?? '',
            ganadores: interaction.options.getInteger('winners') ?? 1,
            duracionMs: duracion,
            autorId: interaction.user.id,
            requisitos: {
                rolId: interaction.options.getRole('required_role')?.id ?? '',
                antiguedadMs: antiguedad,
                soloClientes: interaction.options.getBoolean('customers_only') ?? false
            }
        });

        return ui.responderEfimero(interaction, ui.exito(emojis,
            `Sorteo **#${sorteo.id}** publicado en <#${canal.id}>. Se resolverá ${ui.fecha(sorteo.terminaEn, 'R')}.`));
    }
};
