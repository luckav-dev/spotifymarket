'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

const KEY_PERMISSIONS = [
    ['Administrator', PermissionFlagsBits.Administrator],
    ['Manage server', PermissionFlagsBits.ManageGuild],
    ['Manage channels', PermissionFlagsBits.ManageChannels],
    ['Manage roles', PermissionFlagsBits.ManageRoles],
    ['Manage messages', PermissionFlagsBits.ManageMessages],
    ['Moderate members', PermissionFlagsBits.ModerateMembers],
    ['Ban members', PermissionFlagsBits.BanMembers],
    ['Kick members', PermissionFlagsBits.KickMembers]
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('user-info')
        .setDescription('Show a detailed account, membership and permission overview')
        .setDMPermission(false)
        .addUserOption(option => option
            .setName('user')
            .setDescription('Member to inspect')),

    async execute(interaction, { emojis, ui }) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const selected = interaction.options.getUser('user') ?? interaction.user;
        const user = await interaction.client.users.fetch(selected.id, { force: true }).catch(() => selected);
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);

        if (!member) {
            return interaction.editReply({
                components: [ui.error(emojis, 'That user is not currently a member of this server.')],
                flags: ui.V2
            });
        }

        const roles = member.roles.cache
            .filter(role => role.id !== interaction.guild.id)
            .sort((a, b) => b.position - a.position);
        const shownRoles = roles.first(12).map(role => `<@&${role.id}>`).join(' ');
        const keyPermissions = KEY_PERMISSIONS
            .filter(([, permission]) => member.permissions.has(permission))
            .map(([name]) => name);
        const timeout = member.communicationDisabledUntilTimestamp;
        const avatar = user.displayAvatarURL({ extension: 'png', size: 512 });
        const banner = user.bannerURL?.({ extension: 'png', size: 1024 });
        const flags = user.flags?.toArray?.() ?? [];

        const summary = [
            { emoji: 'usuario', etiqueta: 'Account', valor: `<@${user.id}> · \`${user.tag}\`` },
            { emoji: 'perfil', etiqueta: 'Display name', valor: `${member.displayName}${user.globalName ? ` · global: ${user.globalName}` : ''}` },
            { emoji: 'cuenta', etiqueta: 'Account created', valor: `${ui.fecha(user.createdTimestamp, 'F')} · ${ui.fecha(user.createdTimestamp, 'R')}` },
            { emoji: 'entrada', etiqueta: 'Joined server', valor: member.joinedTimestamp ? `${ui.fecha(member.joinedTimestamp, 'F')} · ${ui.fecha(member.joinedTimestamp, 'R')}` : 'Unavailable' },
            { emoji: 'bot', etiqueta: 'Type', valor: user.bot ? 'Application or bot' : 'Person' },
            { emoji: 'servidor', etiqueta: 'User ID', valor: ui.dato(user.id) }
        ];

        const body = [
            ui.seccionMiniatura(ui.contenidoCampos(emojis, summary), avatar, `${user.username} avatar`),
            ui.linea(),
            ui.texto(
                `### ${emojis.rol('rango')} Membership and roles\n` +
                `- **Highest role:** ${member.roles.highest.id === interaction.guild.id ? 'No roles' : `<@&${member.roles.highest.id}>`}\n` +
                `- **Assigned roles:** ${roles.size}${shownRoles ? `\n${shownRoles}` : ''}${roles.size > 12 ? `\n-# Plus ${roles.size - 12} additional roles.` : ''}\n` +
                `- **Boosting since:** ${member.premiumSinceTimestamp ? ui.fecha(member.premiumSinceTimestamp, 'F') : 'Not boosting'}`
            ),
            ui.linea(),
            ui.texto(
                `### ${emojis.rol('moderacion')} Status and permissions\n` +
                `- **Timeout:** ${timeout && timeout > Date.now() ? `active until ${ui.fecha(timeout, 'F')}` : 'Not active'}\n` +
                `- **Pending verification:** ${member.pending ? 'Yes' : 'No'}\n` +
                `- **Key permissions:** ${keyPermissions.length ? keyPermissions.join(' · ') : 'None'}\n` +
                `- **Account badges:** ${flags.length ? flags.map(flag => `\`${flag}\``).join(' · ') : 'None available'}`
            ),
            banner ? ui.galeria([banner], `${user.username} banner`) : null
        ];

        return interaction.editReply({
            components: [ui.panel(emojis, {
                emoji: 'perfil',
                titulo: member.displayName,
                subtitulo: `Complete profile for ${user.tag}`,
                cuerpo: body,
                pie: `Requested by ${interaction.user.tag} · ${ui.fecha(Date.now(), 'R')}`
            })],
            flags: ui.V2,
            allowedMentions: { parse: [] }
        });
    }
};
