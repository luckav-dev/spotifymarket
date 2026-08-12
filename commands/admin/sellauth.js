'use strict';

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    ContainerBuilder,
    TextDisplayBuilder,
    MessageFlags
} = require('discord.js');

const config = require('../../utils/config');
const ui = require('../../utils/ui');
const arte = require('../../utils/sellAuthArtwork');

const ACCIONES = [
    { name: 'Integration status', value: 'status' },
    { name: 'List invoices', value: 'invoices' },
    { name: 'View one invoice', value: 'invoice' },
    { name: 'List SellAuth products', value: 'products' },
    { name: 'View review activity', value: 'reviews' },
    { name: 'Synchronize now', value: 'sync' },
    { name: 'Configure Discord channels', value: 'channels' }
];

function arrayDatos(respuesta) {
    if (Array.isArray(respuesta)) return respuesta;
    return Array.isArray(respuesta?.data) ? respuesta.data : [];
}

function idDe(valor) {
    return String(valor?.id ?? valor?.$id ?? '').trim();
}

function fecha(valor) {
    const ms = Date.parse(valor ?? '');
    return Number.isFinite(ms) ? ui.fecha(ms, 'f') : '`—`';
}

function dinero(valor, moneda = 'EUR') {
    return arte.precio(Number(valor ?? 0), String(moneda || 'EUR').toUpperCase());
}

function truncarLista(lineas, max = 3200) {
    const salida = [];
    let total = 0;
    for (const linea of lineas) {
        if (total + linea.length > max) break;
        salida.push(linea);
        total += linea.length;
    }
    return salida;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sellauth')
        .setDescription('Inspect and synchronize the connected SellAuth shop')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option => option
            .setName('action')
            .setDescription('SellAuth action to perform')
            .setAutocomplete(true)
            .setRequired(true))
        .addStringOption(option => option
            .setName('id')
            .setDescription('Invoice ID or unique invoice ID')
            .setAutocomplete(true))
        .addIntegerOption(option => option
            .setName('page')
            .setDescription('Result page to display')
            .setMinValue(1)
            .setMaxValue(1000))
        .addStringOption(option => option
            .setName('status')
            .setDescription('Optional invoice status filter')
            .addChoices(
                { name: 'Completed', value: 'completed' },
                { name: 'Partially completed', value: 'partially_completed' },
                { name: 'Pending', value: 'pending' },
                { name: 'Confirming', value: 'confirming' },
                { name: 'Out of stock', value: 'out_of_stock' },
                { name: 'Cancelled', value: 'cancelled' },
                { name: 'Failed', value: 'failed' },
                { name: 'Refunded', value: 'refunded' }
            ))
        .addChannelOption(option => option
            .setName('reviews_channel')
            .setDescription('Channel for verified reviews and the review guide')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addChannelOption(option => option
            .setName('restocks_channel')
            .setDescription('Channel for product restock announcements')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addChannelOption(option => option
            .setName('price_updates_channel')
            .setDescription('Channel for product price update announcements')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addBooleanOption(option => option
            .setName('import_reviews')
            .setDescription('Import unseen review history during this synchronization')),

    cooldown: 3,

    async autocomplete(interaction, { client }) {
        const focused = interaction.options.getFocused(true);
        const query = String(focused.value ?? '').toLowerCase();
        if (focused.name === 'action') {
            return interaction.respond(ACCIONES
                .filter(item => item.name.toLowerCase().includes(query) || item.value.includes(query))
                .map(item => ({ name: item.name, value: item.value })));
        }

        if (focused.name !== 'id' || interaction.options.getString('action') !== 'invoice') {
            return interaction.respond([]);
        }

        const sistema = client.sistemas?.sellauth;
        if (!sistema?.estaConfigurado()) return interaction.respond([]);
        try {
            const respuesta = await sistema.api.listarFacturas({
                page: 1,
                perPage: 25,
                orderColumn: 'created_at',
                orderDirection: 'desc',
                id: query || undefined
            });
            return interaction.respond(arrayDatos(respuesta).slice(0, 25).map(factura => ({
                name: `#${idDe(factura)} · ${factura.status || 'unknown'} · ${dinero(factura.price, factura.currency)}`.slice(0, 100),
                value: String(factura.unique_id || idDe(factura)).slice(0, 100)
            })));
        } catch {
            return interaction.respond([]);
        }
    },

    async execute(interaction, { client, emojis }) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const sistema = client.sistemas.sellauth;
        const accion = interaction.options.getString('action');

        if (!ACCIONES.some(item => item.value === accion)) {
            return interaction.editReply({ components: [ui.error(emojis, 'Selecciona una accion valida.')], flags: ui.V2 });
        }

        if (accion === 'channels') return configurarCanales(interaction, sistema, emojis);
        if (accion === 'status') return mostrarEstado(interaction, sistema, emojis);
        if (!sistema.estaConfigurado()) {
            return interaction.editReply({
                components: [ui.error(
                    emojis,
                    'SellAuth aun no esta conectado. Añade `SELLAUTH_API_KEY` y `SELLAUTH_SHOP_ID` al `.env` y reinicia el bot.'
                )],
                flags: ui.V2
            });
        }

        try {
            switch (accion) {
                case 'invoices': return listarFacturas(interaction, sistema, emojis);
                case 'invoice': return verFactura(interaction, sistema, emojis);
                case 'products': return listarProductos(interaction, sistema, emojis);
                case 'reviews': return verResenas(interaction, sistema, emojis);
                case 'sync': return sincronizar(interaction, sistema, emojis);
                default: return undefined;
            }
        } catch (error) {
            return interaction.editReply({
                components: [ui.error(emojis, `SellAuth no pudo completar la consulta: ${ui.plano(error.message)}`)],
                flags: ui.V2
            });
        }
    }
};

async function mostrarEstado(interaction, sistema, emojis) {
    const ajustes = sistema.config;
    const pendientes = Object.keys(sistema.db.data.webhook.pendientes).length;
    const ultima = sistema.db.data.ultimaSincronizacion
        ? ui.fecha(sistema.db.data.ultimaSincronizacion, 'R')
        : '`nunca`';
    const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## ${emojis.rol('conexion')} Estado de SellAuth\n` +
            `> Conexion del catalogo, facturas, reseñas y avisos automaticos.`
        ))
        .addSeparatorComponents(ui.linea())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `${emojis.rol(sistema.estaConfigurado() ? 'exito' : 'aviso')} **API:** ${sistema.estaConfigurado() ? 'Configurada' : 'Pendiente de credenciales'}\n` +
            `${emojis.rol('producto')} **Referencias cacheadas:** ${ui.dato(sistema.productos().length)}\n` +
            `${emojis.rol('valoracion')} **Reseñas publicadas:** ${ui.dato(Object.keys(sistema.db.data.resenas).length)}\n` +
            `${emojis.rol('actualizar')} **Ultima sincronizacion:** ${ultima}\n` +
            `${emojis.rol('info')} **Webhooks pendientes:** ${ui.dato(pendientes)}`
        ))
        .addSeparatorComponents(ui.linea())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### ${emojis.rol('canal')} Destinos\n` +
            `**Reseñas:** ${ajustes.channels.reviews ? `<#${ajustes.channels.reviews}>` : '`sin configurar`'}\n` +
            `**Restocks:** ${ajustes.channels.restocks ? `<#${ajustes.channels.restocks}>` : '`sin configurar`'}\n` +
            `**Cambios de precio:** ${ajustes.channels.priceUpdates ? `<#${ajustes.channels.priceUpdates}>` : '`sin configurar`'}`
        ))
        .addSeparatorComponents(ui.aire())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `-# Intervalo ${ui.duracion(ajustes.sync.intervalMs)} · webhook ${ajustes.webhook.path} · tienda ${process.env.SELLAUTH_SHOP_ID || ajustes.shopId || 'sin ID'}`
        ));
    return interaction.editReply({ components: [container], flags: ui.V2 });
}

async function configurarCanales(interaction, sistema, emojis) {
    const reviews = interaction.options.getChannel('reviews_channel');
    const restocks = interaction.options.getChannel('restocks_channel');
    const prices = interaction.options.getChannel('price_updates_channel');
    if (!reviews && !restocks && !prices) return mostrarEstado(interaction, sistema, emojis);

    const ajustes = structuredClone(sistema.config);
    if (reviews) ajustes.channels.reviews = reviews.id;
    if (restocks) ajustes.channels.restocks = restocks.id;
    if (prices) ajustes.channels.priceUpdates = prices.id;
    config.guardar('sellauth', ajustes);

    if (reviews) await sistema.publicarPanel(reviews);
    return interaction.editReply({
        components: [ui.exito(
            emojis,
            `Canales de SellAuth actualizados.\n` +
            `${reviews ? `- Reseñas: <#${reviews.id}>\n` : ''}` +
            `${restocks ? `- Restocks: <#${restocks.id}>\n` : ''}` +
            `${prices ? `- Precios: <#${prices.id}>` : ''}`
        )],
        flags: ui.V2
    });
}

async function listarFacturas(interaction, sistema, emojis) {
    const page = interaction.options.getInteger('page') || 1;
    const status = interaction.options.getString('status');
    const respuesta = await sistema.api.listarFacturas({
        page,
        perPage: 10,
        orderColumn: 'created_at',
        orderDirection: 'desc',
        statuses: status ? [status] : undefined
    });
    const facturas = arrayDatos(respuesta);
    const lineas = facturas.map(factura => {
        const productos = (factura.items ?? [])
            .map(item => item.product?.name || item.product_name)
            .filter(Boolean)
            .slice(0, 2)
            .join(', ') || factura.product?.name || 'Sin detalle';
        return `${emojis.rol(factura.status === 'completed' ? 'exito' : 'info')} **#${idDe(factura)}** · ${ui.dato(factura.status || 'unknown')} · ${dinero(factura.price, factura.currency)}\n` +
            `-# ${ui.plano(productos)} · ${fecha(factura.created_at)}`;
    });
    const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## ${emojis.rol('files')} Facturas de SellAuth\n` +
            `> Pagina ${ui.dato(page)} · ${status ? `filtro ${ui.dato(status)}` : 'todos los estados'}`
        ))
        .addSeparatorComponents(ui.linea())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            lineas.length ? lineas.join('\n\n') : '-# No hay facturas en esta pagina.'
        ))
        .addSeparatorComponents(ui.aire())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `-# Total devuelto ${facturas.length} · usa /sellauth action:invoice id:... para el detalle completo`
        ));
    return interaction.editReply({ components: [container], flags: ui.V2 });
}

async function verFactura(interaction, sistema, emojis) {
    const id = interaction.options.getString('id')?.trim();
    if (!id) {
        return interaction.editReply({ components: [ui.error(emojis, 'Indica la factura en la opcion `id`.')], flags: ui.V2 });
    }

    const factura = await sistema.api.obtenerFactura(id);
    const items = truncarLista((factura.items ?? []).map((item, indice) => {
        const nombre = item.product?.name || item.product_name || 'Producto';
        const variante = item.variant?.name || item.variant_name || '';
        return `**${indice + 1}. ${ui.plano(nombre)}${variante && variante !== nombre ? ` · ${ui.plano(variante)}` : ''}**\n` +
            `-# Estado ${item.status || 'unknown'} · cantidad ${item.quantity ?? 1} · ${dinero(item.total_price ?? item.price, factura.currency)}`;
    }), 1900);
    const discordId = factura.discord_id || factura.customer?.discord_id || factura.shop_customer?.discord_id;
    const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## ${emojis.rol('files')} Factura #${idDe(factura)}\n` +
            `> ${ui.dato(factura.status || 'unknown')} · ${dinero(factura.price, factura.currency)} · pagado ${dinero(factura.paid, factura.currency)}`
        ))
        .addSeparatorComponents(ui.linea())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `${emojis.rol('usuario')} **Cliente:** ${ui.dato(factura.email || 'sin email')}\n` +
            `${emojis.rol('perfil')} **Discord:** ${discordId ? `<@${discordId}> · ${ui.dato(discordId)}` : '`no vinculado`'}\n` +
            `${emojis.rol('paypal')} **Pago:** ${ui.plano(factura.payment_method?.name || factura.gateway || 'sin detalle')}\n` +
            `${emojis.rol('world')} **Pais / IP:** ${ui.dato(factura.country_code || '—')} · ${ui.dato(factura.ip || '—')}\n` +
            `${emojis.rol('reloj')} **Creada:** ${fecha(factura.created_at)}\n` +
            `${emojis.rol('exito')} **Completada:** ${fecha(factura.completed_at)}\n` +
            `${emojis.rol('info')} **ID unico:** ${ui.dato(factura.unique_id || '—')}`
        ));
    if (items.length) {
        container
            .addSeparatorComponents(ui.linea())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### ${emojis.rol('producto')} Productos\n${items.join('\n\n')}`
            ));
    }
    if (factura.feedback) {
        container
            .addSeparatorComponents(ui.linea())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### ${emojis.rol('valoracion')} Reseña asociada\n` +
                `**Puntuacion:** ${ui.dato(`${factura.feedback.rating}/5`)} · **Estado:** ${ui.dato(factura.feedback.status)}\n` +
                `${ui.cita(ui.plano(factura.feedback.message || 'Sin comentario'))}`
            ));
    }
    container
        .addSeparatorComponents(ui.aire())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Las credenciales y entregables del pedido se ocultan intencionadamente.'));
    return interaction.editReply({ components: [container], flags: ui.V2, allowedMentions: { parse: [] } });
}

async function listarProductos(interaction, sistema, emojis) {
    const productos = sistema.productos();
    const lineas = truncarLista(productos.map(producto =>
        `${emojis.rol(producto.stock === 0 ? 'error' : 'exito')} **${ui.plano(producto.nombre)}** · ${dinero(producto.precio, producto.moneda)}\n` +
        `-# ${ui.dato(producto.id)} · ${ui.plano(producto.categoria)} · stock ${producto.stock < 0 ? 'sin limite' : producto.stock} · ${producto.visible ? 'publico' : 'no publico'}`
    ));
    const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## ${emojis.rol('catalogo')} Catalogo SellAuth\n` +
            `> ${productos.length} referencias · ${productos.filter(p => p.visible).length} publicas · ${productos.filter(p => p.stock === 0).length} agotadas`
        ))
        .addSeparatorComponents(ui.linea())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(lineas.join('\n\n') || '-# El catalogo cacheado esta vacio.'));
    if (lineas.length < productos.length) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${productos.length - lineas.length} referencias adicionales no caben en esta vista.`));
    }
    return interaction.editReply({ components: [container], flags: ui.V2 });
}

async function verResenas(interaction, sistema, emojis) {
    const [respuesta, stats] = await Promise.all([
        sistema.api.listarResenas({ page: 1, perPage: 10, orderColumn: 'created_at', orderDirection: 'desc' }),
        sistema.api.estadisticasResenas().catch(() => null)
    ]);
    const resenas = arrayDatos(respuesta);
    const lineas = resenas.map(resena =>
        `${emojis.rol('valoracion')} **#${idDe(resena)} · ${resena.rating}/5** · ${ui.dato(resena.status || 'unknown')}\n` +
        `-# Factura #${resena.invoice_id || '—'} · ${ui.plano(resena.product_name || 'producto sin nombre')} · ${fecha(resena.created_at)}`
    );
    const resumen = stats
        ? Object.entries(stats).slice(0, 6).map(([clave, valor]) => `**${clave}:** ${ui.dato(valor)}`).join(' · ')
        : 'Estadisticas globales no disponibles';
    const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## ${emojis.rol('valoracion')} Actividad de reseñas\n> ${resumen}`
        ))
        .addSeparatorComponents(ui.linea())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(lineas.join('\n\n') || '-# SellAuth no ha devuelto reseñas.'));
    return interaction.editReply({ components: [container], flags: ui.V2 });
}

async function sincronizar(interaction, sistema, emojis) {
    const importar = interaction.options.getBoolean('import_reviews') ?? false;
    const resultado = await sistema.sincronizar({ anunciar: false, importarResenas: importar });
    return interaction.editReply({
        components: [ui.exito(
            emojis,
            `Sincronizacion completada.\n` +
            `- Referencias: ${ui.dato(resultado.productos)}\n` +
            `- Reseñas nuevas: ${ui.dato(resultado.resenas)}\n` +
            `- Restocks detectados: ${ui.dato(resultado.restocks)}\n` +
            `- Cambios de precio: ${ui.dato(resultado.cambiosPrecio)}`
        )],
        flags: ui.V2
    });
}
