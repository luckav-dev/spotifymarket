'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');

const config = require('../../utils/config');
const validacionConfig = require('../../utils/validacionConfig');

const PERMISOS_BOT = [
    ['Gestionar canales', PermissionFlagsBits.ManageChannels],
    ['Gestionar roles', PermissionFlagsBits.ManageRoles],
    ['Gestionar mensajes', PermissionFlagsBits.ManageMessages],
    ['Ver registro de auditoria', PermissionFlagsBits.ViewAuditLog],
    ['Moderar miembros', PermissionFlagsBits.ModerateMembers],
    ['Expulsar miembros', PermissionFlagsBits.KickMembers],
    ['Banear miembros', PermissionFlagsBits.BanMembers],
    ['Adjuntar archivos', PermissionFlagsBits.AttachFiles],
    ['Crear hilos públicos', PermissionFlagsBits.CreatePublicThreads],
    ['Escribir en hilos', PermissionFlagsBits.SendMessagesInThreads]
];

function referenciasConfiguradas() {
    const canales = [];
    const roles = [];

    const tickets = config.cargar('tickets');
    for (const [clave, categoria] of Object.entries(tickets.categorias ?? {})) {
        if (categoria.categoriaId) canales.push([`Tickets · ${clave}`, categoria.categoriaId, ChannelType.GuildCategory]);
    }
    if (tickets.ajustes?.categoriaArchivoId) canales.push(['Archivo de tickets', tickets.ajustes.categoriaArchivoId, ChannelType.GuildCategory]);
    if (tickets.ajustes?.transcripciones?.canalId) canales.push(['Transcripciones', tickets.ajustes.transcripciones.canalId]);
    if (tickets.ajustes?.valoraciones?.canalId) canales.push(['Valoraciones', tickets.ajustes.valoraciones.canalId]);

    const welcome = config.cargar('welcome');
    for (const [nombre, bloque] of [['Bienvenidas', welcome.bienvenida], ['Despedidas', welcome.despedida], ['Hitos', welcome.hitos]]) {
        if (bloque?.canalId) canales.push([nombre, bloque.canalId]);
    }
    for (const roleId of welcome.rolesAutomaticos?.roles ?? []) roles.push(['Rol automatico', roleId]);

    const verify = config.cargar('verify');
    if (verify.canalId) canales.push(['Verificacion', verify.canalId]);
    if (verify.rolId) roles.push(['Rol verificado', verify.rolId]);

    const suggestions = config.cargar('suggestions');
    if (suggestions.canalPublicacionId) canales.push(['Sugerencias', suggestions.canalPublicacionId]);

    const sellauth = config.cargar('sellauth');
    if (sellauth.channels?.reviews) canales.push(['SellAuth · Reseñas', sellauth.channels.reviews]);
    if (sellauth.channels?.restocks) canales.push(['SellAuth · Restocks', sellauth.channels.restocks]);
    if (sellauth.channels?.priceUpdates) canales.push(['SellAuth · Precios', sellauth.channels.priceUpdates]);

    for (const [clave, id] of Object.entries(config.cargar('logs').canales ?? {})) {
        if (id) canales.push([`Logs · ${clave}`, id]);
    }
    for (const [clave, rol] of Object.entries(config.cargar('permissions').roles ?? {})) {
        if (rol.roleId) roles.push([`Staff · ${clave}`, rol.roleId]);
    }

    return { canales, roles };
}

module.exports = {
    cooldown: 5,
    data: new SlashCommandBuilder()
        .setName('diagnostics')
        .setDescription('Check bot configuration, resource IDs and operational permissions')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, { emojis, ui }) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const revisiones = validacionConfig.validarTodo();
        const errores = revisiones.flatMap(r => r.errores.map(mensaje => `**${r.nombre}:** ${mensaje}`));
        const avisos = revisiones.flatMap(r => r.avisos.map(mensaje => `**${r.nombre}:** ${mensaje}`));
        const recursos = referenciasConfiguradas();

        const sellauth = config.cargar('sellauth');
        if (sellauth.enabled && !process.env.SELLAUTH_API_KEY?.trim()) {
            errores.push('**SellAuth:** falta `SELLAUTH_API_KEY` en el `.env`.');
        }
        if (sellauth.enabled && !(process.env.SELLAUTH_SHOP_ID?.trim() || String(sellauth.shopId ?? '').trim())) {
            errores.push('**SellAuth:** falta `SELLAUTH_SHOP_ID` en el `.env` o `shopId` en config.');
        }
        if (sellauth.webhook?.enabled && !process.env.SELLAUTH_WEBHOOK_SECRET?.trim()) {
            avisos.push('**SellAuth webhook:** falta `SELLAUTH_WEBHOOK_SECRET`; las reseñas dependerán de la sincronización periódica.');
        }

        for (const [nombre, id, tipo] of recursos.canales) {
            const canal = interaction.guild.channels.cache.get(id);
            if (!canal) errores.push(`**${nombre}:** el canal o categoria \`${id}\` no existe en este servidor.`);
            else if (tipo !== undefined && canal.type !== tipo) errores.push(`**${nombre}:** \`${id}\` no es una categoria de Discord.`);
        }
        for (const [nombre, id] of recursos.roles) {
            const rol = interaction.guild.roles.cache.get(id);
            if (!rol) errores.push(`**${nombre}:** el rol \`${id}\` no existe en este servidor.`);
            else if (!rol.editable && id !== interaction.guild.members.me.roles.highest.id) {
                avisos.push(`**${nombre}:** el rol ${rol} esta por encima del bot o no es gestionable.`);
            }
        }

        const yo = interaction.guild.members.me;
        const faltanPermisos = PERMISOS_BOT
            .filter(([, permiso]) => !yo.permissions.has(permiso))
            .map(([nombre]) => nombre);
        if (faltanPermisos.length) avisos.push(`**Permisos del bot:** faltan ${faltanPermisos.join(', ')}.`);

        const estado = errores.length ? 'Requiere correcciones' : avisos.length ? 'Operativo con avisos' : 'Todo listo';
        const seccion = (titulo, lista, vacio) => ui.texto(
            `### ${titulo}\n${lista.length ? lista.slice(0, 8).map(item => `- ${ui.truncar(item, 180)}`).join('\n') : `- ${vacio}`}` +
            (lista.length > 8 ? `\n-# Y ${lista.length - 8} resultado(s) mas.` : '')
        );

        return interaction.editReply({
            components: [ui.panel(emojis, {
                emoji: errores.length ? 'error' : avisos.length ? 'aviso' : 'exito',
                titulo: 'Diagnostico del bot',
                subtitulo: estado,
                cuerpo: [
                    ui.campos(emojis, [
                        { emoji: 'servidor', etiqueta: 'Servidor', valor: interaction.guild.name },
                        { emoji: 'comando', etiqueta: 'Configuraciones', valor: ui.dato(revisiones.length) },
                        { emoji: 'error', etiqueta: 'Errores', valor: ui.dato(errores.length) },
                        { emoji: 'aviso', etiqueta: 'Avisos', valor: ui.dato(avisos.length) },
                        { emoji: 'conexion', etiqueta: 'Gateway', valor: `${Math.round(interaction.client.ws.ping)} ms` }
                    ]),
                    ui.linea(),
                    seccion(`${emojis.rol('error')} Errores`, errores, 'No se han detectado errores.'),
                    ui.linea(),
                    seccion(`${emojis.rol('aviso')} Avisos`, avisos, 'No hay avisos pendientes.')
                ],
                pie: 'Los valores vacios de sistemas desactivados no bloquean el arranque.'
            })],
            flags: ui.V2,
            allowedMentions: { parse: [] }
        });
    }
};
