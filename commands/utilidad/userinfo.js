'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

const KEY_PERMISSIONS = [
    ['Administrador', PermissionFlagsBits.Administrator],
    ['Gestionar servidor', PermissionFlagsBits.ManageGuild],
    ['Gestionar canales', PermissionFlagsBits.ManageChannels],
    ['Gestionar roles', PermissionFlagsBits.ManageRoles],
    ['Gestionar mensajes', PermissionFlagsBits.ManageMessages],
    ['Moderar miembros', PermissionFlagsBits.ModerateMembers],
    ['Banear miembros', PermissionFlagsBits.BanMembers],
    ['Expulsar miembros', PermissionFlagsBits.KickMembers]
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
                components: [ui.error(emojis, 'Ese usuario no pertenece actualmente al servidor.')],
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
            { emoji: 'usuario', etiqueta: 'Cuenta', valor: `<@${user.id}> · \`${user.tag}\`` },
            { emoji: 'perfil', etiqueta: 'Nombre visible', valor: `${member.displayName}${user.globalName ? ` · global: ${user.globalName}` : ''}` },
            { emoji: 'cuenta', etiqueta: 'Cuenta creada', valor: `${ui.fecha(user.createdTimestamp, 'F')} · ${ui.fecha(user.createdTimestamp, 'R')}` },
            { emoji: 'entrada', etiqueta: 'Entrada al servidor', valor: member.joinedTimestamp ? `${ui.fecha(member.joinedTimestamp, 'F')} · ${ui.fecha(member.joinedTimestamp, 'R')}` : 'No disponible' },
            { emoji: 'bot', etiqueta: 'Tipo', valor: user.bot ? 'Aplicación o bot' : 'Persona' },
            { emoji: 'servidor', etiqueta: 'Identificador', valor: ui.dato(user.id) }
        ];

        const body = [
            ui.seccionMiniatura(ui.contenidoCampos(emojis, summary), avatar, `Avatar de ${user.username}`),
            ui.linea(),
            ui.texto(
                `### ${emojis.rol('rango')} Membresía y roles\n` +
                `- **Rol principal:** ${member.roles.highest.id === interaction.guild.id ? 'Sin roles' : `<@&${member.roles.highest.id}>`}\n` +
                `- **Roles asignados:** ${roles.size}${shownRoles ? `\n${shownRoles}` : ''}${roles.size > 12 ? `\n-# Y ${roles.size - 12} roles adicionales.` : ''}\n` +
                `- **Booster desde:** ${member.premiumSinceTimestamp ? ui.fecha(member.premiumSinceTimestamp, 'F') : 'No es booster'}`
            ),
            ui.linea(),
            ui.texto(
                `### ${emojis.rol('moderacion')} Estado y permisos\n` +
                `- **Timeout:** ${timeout && timeout > Date.now() ? `activo hasta ${ui.fecha(timeout, 'F')}` : 'No activo'}\n` +
                `- **Verificación pendiente:** ${member.pending ? 'Sí' : 'No'}\n` +
                `- **Permisos destacados:** ${keyPermissions.length ? keyPermissions.join(' · ') : 'Ninguno'}\n` +
                `- **Insignias de cuenta:** ${flags.length ? flags.map(flag => `\`${flag}\``).join(' · ') : 'Ninguna disponible'}`
            ),
            banner ? ui.galeria([banner], `Banner de ${user.username}`) : null
        ];

        return interaction.editReply({
            components: [ui.panel(emojis, {
                emoji: 'perfil',
                titulo: member.displayName,
                subtitulo: `Perfil completo de ${user.tag}`,
                cuerpo: body,
                pie: `Consultado por ${interaction.user.tag} · ${ui.fecha(Date.now(), 'R')}`
            })],
            flags: ui.V2,
            allowedMentions: { parse: [] }
        });
    }
};
