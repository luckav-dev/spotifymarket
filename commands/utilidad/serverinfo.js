'use strict';

const { SlashCommandBuilder, ChannelType, MessageFlags } = require('discord.js');

const VERIFICATION = ['Ninguna', 'Baja', 'Media', 'Alta', 'Muy alta'];

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
            : 'Ninguna característica especial';

        const summary = [
            { emoji: 'administrador', etiqueta: 'Propietario', valor: owner ? `<@${owner.id}> · \`${owner.id}\`` : 'No disponible' },
            { emoji: 'miembros', etiqueta: 'Miembros', valor: `**${ui.numero(guild.memberCount)}** · ${ui.numero(humans)} personas · ${ui.numero(bots)} bots` },
            { emoji: 'impulso', etiqueta: 'Mejoras', valor: `**${ui.numero(guild.premiumSubscriptionCount ?? 0)}** · nivel ${guild.premiumTier} · ${boostRoles} rol de booster` },
            { emoji: 'cuenta', etiqueta: 'Creado', valor: `${ui.fecha(guild.createdTimestamp, 'F')} · ${ui.fecha(guild.createdTimestamp, 'R')}` },
            { emoji: 'servidor', etiqueta: 'Identificador', valor: ui.dato(guild.id) }
        ];

        const body = [
            icon ? ui.seccionMiniatura(ui.contenidoCampos(emojis, summary), icon, `Icono de ${guild.name}`) : ui.campos(emojis, summary),
            ui.linea(),
            ui.texto(
                `### ${emojis.rol('canal')} Estructura de canales\n` +
                `- **Texto:** ${count(ChannelType.GuildText)} · **Anuncios:** ${count(ChannelType.GuildAnnouncement)} · **Foros:** ${count(ChannelType.GuildForum)}\n` +
                `- **Voz:** ${count(ChannelType.GuildVoice)} · **Escenarios:** ${count(ChannelType.GuildStageVoice)} · **Categorías:** ${count(ChannelType.GuildCategory)}\n` +
                `- **Total:** ${channels.size} canales · ${channels.filter(channel => channel.isThread?.()).size} hilos activos`
            ),
            ui.linea(),
            ui.texto(
                `### ${emojis.rol('rango')} Roles y comunidad\n` +
                `- **Roles:** ${roles.size} · **gestionados por integraciones:** ${managedRoles}\n` +
                `- **Emojis:** ${guild.emojis.cache.size} · **stickers:** ${guild.stickers.cache.size}\n` +
                `- **Idioma preferido:** \`${guild.preferredLocale}\` · **verificación:** ${VERIFICATION[guild.verificationLevel] ?? guild.verificationLevel}`
            ),
            ui.linea(),
            ui.texto(
                `### ${emojis.rol('settings')} Configuración operativa\n` +
                `- **Canal del sistema:** ${guild.systemChannel ?? 'No configurado'}\n` +
                `- **Canal AFK:** ${guild.afkChannel ?? 'No configurado'}${guild.afkChannel ? ` · ${guild.afkTimeout}s` : ''}\n` +
                `- **Canal de normas:** ${guild.rulesChannel ?? 'No configurado'} · **actualizaciones:** ${guild.publicUpdatesChannel ?? 'No configurado'}\n` +
                `- **Características:** ${features}`
            ),
            banner ? ui.galeria([banner], `Banner de ${guild.name}`) : null
        ];

        return interaction.editReply({
            components: [ui.panel(emojis, {
                emoji: 'servidor',
                titulo: guild.name,
                subtitulo: guild.description || 'Ficha técnica y comunitaria del servidor.',
                cuerpo: body,
                pie: `Consultado por ${interaction.user.tag} · datos actualizados ${ui.fecha(Date.now(), 'R')}`
            })],
            flags: ui.V2,
            allowedMentions: { parse: [] }
        });
    }
};
