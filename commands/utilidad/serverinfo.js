'use strict';

const { SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');

const VERIFICATION = ['None', 'Low', 'Medium', 'High', 'Very high'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('server-info')
        .setDescription('Show a detailed technical and community overview of this server')
        .setDMPermission(false),

    async execute(interaction, { emojis, ui }) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const guild = interaction.guild;
        const owner = await guild.fetchOwner().catch(() => null);
        const members = await guild.members.fetch().catch(() => guild.members.cache);
        const humans = members.filter(member => !member.user.bot).size;
        const bots = members.filter(member => member.user.bot).size;
        const channels = guild.channels.cache;
        const count = (...types) => channels.filter(channel => types.includes(channel.type)).size;
        const roles = guild.roles.cache.filter(role => role.id !== guild.id);
        const managedRoles = roles.filter(role => role.managed).size;
        const boostRoles = roles.filter(role => role.tags?.premiumSubscriberRole).size;
        const icon = guild.iconURL({ extension: 'png', size: 512 });
        const banner = guild.bannerURL({ extension: 'png', size: 1024 });
        const features = guild.features.length
            ? guild.features.slice(0, 12).map(feature => `\`${feature.toLowerCase()}\``).join(' · ')
            : 'No special features';

        const summary = [
            { emoji: 'administrador', etiqueta: 'Owner', valor: owner ? `<@${owner.id}> · \`${owner.id}\`` : 'Unavailable' },
            { emoji: 'miembros', etiqueta: 'Members', valor: `**${ui.numero(guild.memberCount)}** · ${ui.numero(humans)} people · ${ui.numero(bots)} bots` },
            { emoji: 'impulso', etiqueta: 'Boosts', valor: `**${ui.numero(guild.premiumSubscriptionCount ?? 0)}** · tier ${guild.premiumTier} · ${boostRoles} booster role(s)` },
            { emoji: 'cuenta', etiqueta: 'Created', valor: `${ui.fecha(guild.createdTimestamp, 'F')} · ${ui.fecha(guild.createdTimestamp, 'R')}` },
            { emoji: 'servidor', etiqueta: 'Server ID', valor: ui.dato(guild.id) }
        ];

        const body = [
            icon ? ui.seccionMiniatura(ui.contenidoCampos(emojis, summary), icon, `${guild.name} icon`) : ui.campos(emojis, summary),
            ui.linea(),
            ui.texto(
                `### ${emojis.rol('canal')} Channel structure\n` +
                `- **Text:** ${count(ChannelType.GuildText)} · **Announcements:** ${count(ChannelType.GuildAnnouncement)} · **Forums:** ${count(ChannelType.GuildForum)}\n` +
                `- **Voice:** ${count(ChannelType.GuildVoice)} · **Stages:** ${count(ChannelType.GuildStageVoice)} · **Categories:** ${count(ChannelType.GuildCategory)}\n` +
                `- **Total:** ${channels.size} channels · ${channels.filter(channel => channel.isThread?.()).size} active threads`
            ),
            ui.linea(),
            ui.texto(
                `### ${emojis.rol('rango')} Roles and community\n` +
                `- **Roles:** ${roles.size} · **integration-managed:** ${managedRoles}\n` +
                `- **Emojis:** ${guild.emojis.cache.size} · **stickers:** ${guild.stickers.cache.size}\n` +
                `- **Preferred locale:** \`${guild.preferredLocale}\` · **verification:** ${VERIFICATION[guild.verificationLevel] ?? guild.verificationLevel}`
            ),
            ui.linea(),
            ui.texto(
                `### ${emojis.rol('settings')} Operational settings\n` +
                `- **System channel:** ${guild.systemChannel ?? 'Not configured'}\n` +
                `- **AFK channel:** ${guild.afkChannel ?? 'Not configured'}${guild.afkChannel ? ` · ${guild.afkTimeout}s` : ''}\n` +
                `- **Rules channel:** ${guild.rulesChannel ?? 'Not configured'} · **updates:** ${guild.publicUpdatesChannel ?? 'Not configured'}\n` +
                `- **Features:** ${features}`
            ),
            banner ? ui.galeria([banner], `${guild.name} banner`) : null
        ];

        return interaction.editReply({
            components: [ui.panel(emojis, {
                emoji: 'servidor',
                titulo: guild.name,
                subtitulo: guild.description || 'Technical and community overview of this server.',
                cuerpo: body,
                pie: `Requested by ${interaction.user.tag} · updated ${ui.fecha(Date.now(), 'R')}`
            })],
            flags: ui.V2,
            allowedMentions: { parse: [] }
        });
    }
};
