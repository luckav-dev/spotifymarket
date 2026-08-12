'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');

const config = require('../../utils/config');

const DESTINOS = {
    bienvenida: ['welcome', 'bienvenida.canalId', 'Welcome messages'],
    despedida: ['welcome', 'despedida.canalId', 'Farewell messages'],
    hitos: ['welcome', 'hitos.canalId', 'Member milestones'],
    verificacion: ['verify', 'canalId', 'Verification'],
    transcripciones: ['tickets', 'ajustes.transcripciones.canalId', 'Ticket transcripts'],
    valoraciones: ['tickets', 'ajustes.valoraciones.canalId', 'Ticket ratings'],
    sugerencias: ['suggestions', 'canalPublicacionId', 'Suggestions'],
    'sellauth-reviews': ['sellauth', 'channels.reviews', 'SellAuth reviews'],
    'sellauth-restocks': ['sellauth', 'channels.restocks', 'SellAuth restocks'],
    'sellauth-prices': ['sellauth', 'channels.priceUpdates', 'SellAuth price updates'],
    'logs-tickets': ['logs', 'canales.tickets', 'Ticket logs'],
    'logs-mensajes': ['logs', 'canales.mensajes', 'Message logs'],
    'logs-moderacion': ['logs', 'canales.moderacion', 'Moderation logs'],
    'logs-miembros': ['logs', 'canales.miembros', 'Member logs'],
    'logs-servidor': ['logs', 'canales.servidor', 'Server logs'],
    'logs-canales': ['logs', 'canales.canales', 'Channel logs'],
    'logs-roles': ['logs', 'canales.roles', 'Role logs'],
    'logs-voz': ['logs', 'canales.voz', 'Voice logs'],
    'logs-bot': ['logs', 'canales.bot', 'Bot logs']
};

const ROLES = {
    verificado: ['verify', 'rolId', 'Verified role'],
    administrador: ['permissions', 'roles.administrador.roleId', 'Administrator'],
    moderador: ['permissions', 'roles.moderador.roleId', 'Moderator'],
    soporte: ['permissions', 'roles.soporte.roleId', 'Support']
};

function opciones(tabla) {
    return Object.entries(tabla).map(([value, [, , name]]) => ({ name, value }));
}

function asignar(objeto, recorrido, valor) {
    const partes = recorrido.split('.');
    const ultima = partes.pop();
    let actual = objeto;
    for (const parte of partes) {
        if (!actual[parte] || typeof actual[parte] !== 'object') actual[parte] = {};
        actual = actual[parte];
    }
    actual[ultima] = valor;
}

function guardarReferencia(definicion, valor) {
    const [archivo, recorrido, etiqueta] = definicion;
    const datos = structuredClone(config.cargar(archivo));
    asignar(datos, recorrido, valor);
    config.guardar(archivo, datos);
    return { archivo, recorrido, etiqueta };
}

module.exports = {
    cooldown: 3,
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Configure channels, roles and ticket categories')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub
            .setName('channel')
            .setDescription('Assign a channel to a bot function')
            .addStringOption(o => o
                .setName('function')
                .setDescription('Function that will use the channel')
                .setRequired(true)
                .addChoices(...opciones(DESTINOS)))
            .addChannelOption(o => o
                .setName('channel')
                .setDescription('Channel to assign')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(true)))
        .addSubcommand(sub => sub
            .setName('role')
            .setDescription('Assign a role to a bot function')
            .addStringOption(o => o
                .setName('function')
                .setDescription('Function that will use the role')
                .setRequired(true)
                .addChoices(...opciones(ROLES)))
            .addRoleOption(o => o
                .setName('role')
                .setDescription('Role to assign')
                .setRequired(true)))
        .addSubcommand(sub => sub
            .setName('ticket-category')
            .setDescription('Choose where a ticket category creates channels')
            .addStringOption(o => o
                .setName('type')
                .setDescription('Ticket category configured in tickets.json')
                .setAutocomplete(true)
                .setRequired(true))
            .addChannelOption(o => o
                .setName('category')
                .setDescription('Discord category where channels will be created')
                .addChannelTypes(ChannelType.GuildCategory)
                .setRequired(true)))
        .addSubcommand(sub => sub
            .setName('clear-channel')
            .setDescription('Clear a configured channel destination')
            .addStringOption(o => o
                .setName('function')
                .setDescription('Configured destination to clear')
                .setRequired(true)
                .addChoices(...opciones(DESTINOS)))),

    async autocomplete(interaction) {
        const escrito = interaction.options.getFocused().toLowerCase();
        const categorias = Object.entries(config.cargar('tickets').categorias ?? {})
            .filter(([clave, categoria]) =>
                clave.toLowerCase().includes(escrito) || categoria.nombre.toLowerCase().includes(escrito))
            .slice(0, 25)
            .map(([value, categoria]) => ({ name: categoria.nombre, value }));
        return interaction.respond(categorias);
    },

    async execute(interaction, { client, emojis, ui }) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'channel' || sub === 'clear-channel') {
            const funcion = interaction.options.getString('function');
            const definicion = DESTINOS[funcion];
            if (!definicion) return ui.responderEfimero(interaction, ui.error(emojis, 'Funcion desconocida.'));

            const canal = sub === 'channel' ? interaction.options.getChannel('channel') : null;
            const guardado = guardarReferencia(definicion, canal?.id ?? '');
            if (canal && funcion === 'sellauth-reviews') {
                await client.sistemas?.sellauth?.publicarPanel?.(canal);
            }
            return ui.responderEfimero(interaction, ui.exito(emojis,
                canal
                    ? `**${guardado.etiqueta}** utilizara ${canal}.\n-# Guardado en config/${guardado.archivo}.json · ${guardado.recorrido}`
                    : `Se ha limpiado el destino de **${guardado.etiqueta}**.`));
        }

        if (sub === 'role') {
            const funcion = interaction.options.getString('function');
            const definicion = ROLES[funcion];
            const rol = interaction.options.getRole('role');
            if (!definicion) return ui.responderEfimero(interaction, ui.error(emojis, 'Funcion desconocida.'));
            if (rol.managed) return ui.responderEfimero(interaction, ui.aviso(emojis, 'Ese rol lo gestiona una integracion y no se puede utilizar.'));

            const guardado = guardarReferencia(definicion, rol.id);
            return ui.responderEfimero(interaction, ui.exito(emojis,
                `**${guardado.etiqueta}** utilizara ${rol}.\n-# Guardado en config/${guardado.archivo}.json · ${guardado.recorrido}`));
        }

        const tipo = interaction.options.getString('type');
        const categoria = interaction.options.getChannel('category');
        const datos = structuredClone(config.cargar('tickets'));
        if (!datos.categorias?.[tipo]) {
            return ui.responderEfimero(interaction, ui.error(emojis, 'Esa categoria de tickets ya no existe.'));
        }

        datos.categorias[tipo].categoriaId = categoria.id;
        config.guardar('tickets', datos);
        return ui.responderEfimero(interaction, ui.exito(emojis,
            `Los tickets de **${datos.categorias[tipo].nombre}** se crearan en **${categoria.name}**.`));
    }
};
