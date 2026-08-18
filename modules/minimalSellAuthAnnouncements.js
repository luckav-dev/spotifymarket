'use strict';

const crypto = require('node:crypto');
const {
    AttachmentBuilder,
    ContainerBuilder,
    TextDisplayBuilder
} = require('discord.js');

const SellAuthSystem = require('./sellAuthSystem');
const Database = require('../utils/jsonDatabase');
const logger = require('../utils/logger');
const arte = require('../utils/sellAuthArtwork');
const stockArte = require('../utils/sellAuthStockArtwork');
const ui = require('../utils/ui');

const STOCK_SCHEMA = {
    channelId: '',
    messageId: '',
    fingerprint: '',
    updatedAt: 0,
    pageCount: 0,
    lastError: ''
};

/** Suscripciones de restock y compras acumuladas por cliente. */
const CLIENTES_SCHEMA = {
    suscripciones: {},
    compras: {},
    facturasContadas: {}
};

function cantidadFactura(factura) {
    const items = Array.isArray(factura?.items) ? factura.items : [];
    return items.reduce((total, item) => {
        const cantidad = Math.trunc(Number(item?.quantity));
        return total + (Number.isFinite(cantidad) && cantidad > 0 ? cantidad : 1);
    }, 0);
}

function productoConCantidad(nombre, cantidad) {
    const limpio = String(nombre || 'SellAuth purchase')
        .replace(/\s+·\s+x\d+\s*$/i, '')
        .trim();
    return cantidad > 0 ? `${limpio} · x${cantidad}` : limpio;
}

class MinimalSellAuthAnnouncements extends SellAuthSystem {
    constructor(client, emojis) {
        super(client, emojis);
        this.stockDb = new Database('sellauth-stock-panel', STOCK_SCHEMA);
        this.clientesDb = new Database('sellauth-clientes', CLIENTES_SCHEMA);
        this.actualizandoStock = null;
    }

    productosConStock() {
        return this.productosVisibles().filter(producto => Number(producto.stock) !== 0);
    }

    fingerprintStock(productos = this.productosConStock()) {
        const ajustes = this.config.stockPanel ?? {};
        const estable = productos
            .map(producto => ({
                id: producto.id,
                nombre: producto.nombre,
                categoria: producto.categoria,
                precio: producto.precio,
                moneda: producto.moneda,
                stock: producto.stock,
                imagen: producto.imagen,
                visible: producto.visible
            }))
            .sort((a, b) => a.id.localeCompare(b.id));
        return crypto.createHash('sha256').update(JSON.stringify({
            renderer: stockArte.RENDERER_VERSION,
            productos: estable,
            panel: {
                title: ajustes.title,
                description: ajustes.description,
                imageTitle: ajustes.imageTitle,
                imageSubtitle: ajustes.imageSubtitle,
                lowStockThreshold: ajustes.lowStockThreshold,
                productsPerPage: ajustes.productsPerPage,
                maxPages: ajustes.maxPages
            }
        })).digest('hex');
    }

    async sincronizarProductos(opciones = {}) {
        const resultado = await super.sincronizarProductos(opciones);
        await this.actualizarPanelStock().catch(error => {
            this.stockDb.data.lastError = String(error.message).slice(0, 400);
            this.stockDb.save();
            logger.error('sellauth:stock', `No se pudo actualizar el panel: ${error.message}`);
        });
        return resultado;
    }

    async publicarResena(resena, opciones = {}) {
        if (resena?.invoiceId) {
            try {
                const factura = await this.api.obtenerFactura(resena.invoiceId);
                const cantidad = cantidadFactura(factura);
                if (cantidad > 0) {
                    resena.quantity = cantidad;
                    resena.productName = productoConCantidad(resena.productName, cantidad);
                }
            } catch (error) {
                logger.warn(
                    'sellauth:resena',
                    `No se pudo leer la cantidad de la factura ${resena.invoiceId}: ${error.message}`
                );
            }
        }

        return super.publicarResena(resena, opciones);
    }

    // ------------------------------------------------------- niveles de cliente

    /** Compras y gasto acumulado de un usuario de Discord. */
    historialDe(discordId) {
        return this.clientesDb.data.compras[discordId] ?? { compras: 0, gastado: 0, ultimaEn: 0 };
    }

    /** Nivel mas alto que alcanza un historial, o null si no llega a ninguno. */
    nivelPara(historial) {
        const niveles = this.config.clientes?.niveles ?? [];
        return niveles
            .filter(nivel => nivel.roleId
                && historial.compras >= Number(nivel.minimoCompras ?? 0)
                && historial.gastado >= Number(nivel.minimoGastado ?? 0))
            .sort((a, b) => Number(b.minimoCompras ?? 0) - Number(a.minimoCompras ?? 0))[0] ?? null;
    }

    /**
     * Registra la compra y ajusta los roles del cliente.
     *
     * Sustituye al rol unico que estaba hardcodeado en el codigo: los niveles,
     * sus umbrales y sus roles viven ahora en config/sellauth.json, asi que
     * anadir un tramo VIP no toca ni una linea.
     */
    async aplicarNivelDesdeFactura(factura) {
        const ajustes = this.config.clientes ?? {};
        if (!ajustes.activo) return false;
        if (String(factura?.status ?? '').toLowerCase() !== 'completed') return false;

        const discordId = SellAuthSystem.extraerDiscordId?.(factura) || '';
        if (!discordId) {
            logger.detalle(`Factura ${factura?.id ?? '?'} completada sin Discord vinculado; no se asigna nivel.`);
            return false;
        }

        // Una factura solo suma una vez, por si el webhook llega repetido.
        const facturaId = String(factura.id ?? factura.unique_id ?? '');
        if (facturaId && this.clientesDb.data.facturasContadas[facturaId]) {
            logger.detalle(`Factura ${facturaId} ya contabilizada para ${discordId}.`);
        } else {
            const historial = this.historialDe(discordId);
            const total = Number(factura.total ?? factura.amount ?? 0);

            this.clientesDb.data.compras[discordId] = {
                compras: historial.compras + 1,
                gastado: historial.gastado + (Number.isFinite(total) ? total : 0),
                ultimaEn: Date.now()
            };
            if (facturaId) this.clientesDb.data.facturasContadas[facturaId] = Date.now();
            this.clientesDb.flush();
        }

        const historial = this.historialDe(discordId);
        const objetivo = this.nivelPara(historial);
        if (!objetivo) return false;

        const guild = await this.guildDeClientes();
        if (!guild) return false;

        const miembro = await guild.members.fetch(discordId).catch(() => null);
        if (!miembro) {
            logger.warn('sellauth:clientes', `Discord ${discordId} compro, pero no esta en el servidor.`);
            return false;
        }

        if (miembro.roles.cache.has(objetivo.roleId)) return true;

        const rol = await guild.roles.fetch(objetivo.roleId).catch(() => null);
        if (!rol) {
            logger.warn('sellauth:clientes', `El rol ${objetivo.roleId} del nivel '${objetivo.id}' no existe en ${guild.name}.`);
            return false;
        }

        try {
            await miembro.roles.add(rol, `Nivel ${objetivo.nombre} · ${historial.compras} compra(s)`);
            logger.ok('sellauth:clientes', `${miembro.user.tag} sube a ${objetivo.nombre} (${historial.compras} compras).`);
        } catch (error) {
            logger.error('sellauth:clientes', `No se pudo dar ${objetivo.nombre} a ${miembro.user.tag}: ${error.message}`);
            return false;
        }

        // Los niveles inferiores se retiran para que el rol visible sea uno solo.
        for (const nivel of this.config.clientes.niveles ?? []) {
            if (nivel.id === objetivo.id || !nivel.roleId) continue;
            if (!miembro.roles.cache.has(nivel.roleId)) continue;
            if (Number(nivel.minimoCompras ?? 0) >= Number(objetivo.minimoCompras ?? 0)) continue;
            await miembro.roles.remove(nivel.roleId, `Sustituido por ${objetivo.nombre}`).catch(() => null);
        }

        if (ajustes.avisarPorMd) {
            await miembro.send({
                components: [ui.panel(this.emojis, {
                    emoji: 'cliente',
                    titulo: `You are now ${objetivo.nombre}`,
                    cuerpo: [
                        `Thanks for shopping with Spotify Market. Your account has been upgraded.`,
                        ui.campos(this.emojis, [
                            { emoji: 'comprar', etiqueta: 'Purchases', valor: String(historial.compras), codigo: true },
                            { emoji: 'rango', etiqueta: 'Tier', valor: objetivo.nombre }
                        ])
                    ],
                    pie: 'Your tier is updated automatically after every completed order.'
                })],
                flags: ui.V2,
                allowedMentions: { parse: [] }
            }).catch(() => null);
        }

        return true;
    }

    async guildDeClientes() {
        const guildId = process.env.GUILD_ID?.trim();
        if (guildId) return this.client.guilds.fetch(guildId).catch(() => null);
        return this.client.guilds.cache.first() ?? null;
    }

    // ------------------------------------------------------- avisos de restock

    /**
     * Suscripcion a un producto agotado.
     *
     * El aviso general con @everyone sirve para el escaparate, pero quien
     * espera un producto concreto quiere que le avisen a el y no enterarse por
     * un ping que ademas molesta a todos los demas.
     */
    async alternarSuscripcion(interaction, productoId) {
        const ajustes = this.config.restockAlerts ?? {};
        if (!ajustes.activo) {
            return ui.responderEfimero(interaction, ui.info(this.emojis, 'Restock alerts are currently disabled.'));
        }

        const producto = this.productos().find(item => item.id === productoId);
        if (!producto) {
            return ui.responderEfimero(interaction, ui.error(this.emojis, 'That product is no longer available.'));
        }

        const suscritos = this.clientesDb.data.suscripciones[productoId] ?? [];
        const usuarioId = interaction.user.id;

        if (suscritos.includes(usuarioId)) {
            this.clientesDb.data.suscripciones[productoId] = suscritos.filter(id => id !== usuarioId);
            if (!this.clientesDb.data.suscripciones[productoId].length) {
                delete this.clientesDb.data.suscripciones[productoId];
            }
            this.clientesDb.save();
            return ui.responderEfimero(interaction, ui.info(this.emojis,
                `You will no longer be notified about **${ui.plano(producto.nombre)}**.`));
        }

        const total = Object.values(this.clientesDb.data.suscripciones)
            .filter(lista => lista.includes(usuarioId)).length;
        const maximo = Number(ajustes.maxSuscripcionesPorUsuario) || 15;
        if (total >= maximo) {
            return ui.responderEfimero(interaction, ui.aviso(this.emojis,
                `You are already following ${maximo} products. Remove one before adding another.`));
        }

        this.clientesDb.data.suscripciones[productoId] = [...suscritos, usuarioId];
        this.clientesDb.save();

        return ui.responderEfimero(interaction, ui.exito(this.emojis,
            `You will get a direct message as soon as **${ui.plano(producto.nombre)}** is back in stock.`));
    }

    /** Avisa por MD a quien seguia un producto que acaba de reponerse. */
    async avisarSuscriptores(producto) {
        const ajustes = this.config.restockAlerts ?? {};
        if (!ajustes.activo) return 0;

        const suscritos = this.clientesDb.data.suscripciones[producto.id] ?? [];
        if (!suscritos.length) return 0;

        // La lista se vacia antes de enviar: si algo falla a mitad, nadie
        // recibe el mismo aviso dos veces al siguiente ciclo de sincronizacion.
        delete this.clientesDb.data.suscripciones[producto.id];
        this.clientesDb.flush();

        const carga = {
            components: [ui.panel(this.emojis, {
                emoji: 'stock',
                titulo: 'Back in stock',
                cuerpo: [
                    `**${ui.plano(producto.nombre)}** is available again.`,
                    ui.campos(this.emojis, [
                        { emoji: 'precio', etiqueta: 'Price', valor: arte.precio(producto.precio, producto.moneda) },
                        { emoji: 'stock', etiqueta: 'Available', valor: producto.stock < 0 ? 'Unlimited' : String(producto.stock), codigo: true }
                    ])
                ],
                acciones: producto.checkoutUrl
                    ? [ui.fila(ui.boton(this.emojis, {
                        url: producto.checkoutUrl, etiqueta: 'View product', estilo: 'enlace', emoji: 'enlace'
                    }))]
                    : [],
                pie: 'You asked to be notified about this product. You will not get another alert unless you follow it again.'
            })],
            flags: ui.V2,
            allowedMentions: { parse: [] }
        };

        let enviados = 0;
        for (const usuarioId of suscritos.slice(0, Number(ajustes.maxAvisosPorTanda) || 40)) {
            const usuario = await this.client.users.fetch(usuarioId).catch(() => null);
            if (!usuario) continue;
            const ok = await usuario.send(carga).then(() => true).catch(() => false);
            if (ok) enviados += 1;
        }

        if (enviados) logger.detalle(`Restock de ${producto.nombre}: ${enviados} aviso(s) enviados.`);
        return enviados;
    }

    async handle(interaction, accion, datos) {
        if (accion === 'seguir') return this.alternarSuscripcion(interaction, datos.join(':'));
        return super.handle(interaction, accion, datos);
    }

    detener() {
        stockArte.cerrar?.().catch(() => null);
        return super.detener();
    }

    async canalStock(canalPreferido = null) {
        if (canalPreferido?.isTextBased?.()) return canalPreferido;
        const id = this.config.channels?.stock || this.stockDb.data.channelId;
        if (!id) return null;
        const canal = await this.client.channels.fetch(id).catch(() => null);
        return canal?.isTextBased?.() ? canal : null;
    }

    async mensajeStock(canal) {
        const estado = this.stockDb.data;
        if (!estado.messageId || !estado.channelId || estado.channelId !== canal.id) return null;
        return canal.messages.fetch(estado.messageId).catch(() => null);
    }

    construirStockContainer(nombresArchivos, productos) {
        const stockFinito = productos.filter(producto => producto.stock > 0)
            .reduce((total, producto) => total + Number(producto.stock), 0);
        const infinitos = productos.filter(producto => producto.stock < 0).length;
        const resumenUnidades = infinitos ? `${stockFinito}+` : String(stockFinito);
        const ajustes = this.config.stockPanel ?? {};

        return new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `## ${this.emojis.rol('stock')} ${ajustes.title || 'LIVE STOCK'}\n` +
                `> ${ajustes.description || 'Current availability, synchronized automatically with SellAuth.'}`
            ))
            .addSeparatorComponents(ui.linea())
            .addMediaGalleryComponents(ui.galeria(
                nombresArchivos.map(nombre => `attachment://${nombre}`),
                'Spotify Market live product stock'
            ))
            .addSeparatorComponents(ui.aire())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `${this.emojis.rol('producto')} **Available products:** ${ui.dato(productos.length)} · ` +
                `${this.emojis.rol('stock')} **Ready units:** ${ui.dato(resumenUnidades)}`
            ));
    }

    async actualizarPanelStock({ canal = null, forzar = false } = {}) {
        const ajustes = this.config.stockPanel ?? {};
        if (ajustes.enabled === false) return null;

        const trabajo = async () => {
            const destino = await this.canalStock(canal);
            if (!destino) return null;

            const productos = this.productosConStock();
            const fingerprint = this.fingerprintStock(productos);
            let mensaje = await this.mensajeStock(destino);
            if (!forzar && mensaje && fingerprint === this.stockDb.data.fingerprint) return mensaje;

            const actualizadoEn = Date.now();
            const paneles = await stockArte.generarPanelesStock(productos, {
                title: ajustes.imageTitle || 'Stock board',
                subtitle: ajustes.imageSubtitle || 'Current availability synchronized automatically from SellAuth.',
                lowStockThreshold: ajustes.lowStockThreshold,
                productsPerPage: ajustes.productsPerPage,
                maxPages: ajustes.maxPages,
                updatedAt: actualizadoEn
            });
            const nombres = paneles.map(panel => panel.nombre);
            const archivos = paneles.map(panel => new AttachmentBuilder(panel.buffer, { name: panel.nombre }));
            const payload = {
                components: [this.construirStockContainer(nombres, productos)],
                files: archivos,
                flags: ui.V2,
                allowedMentions: { parse: [] }
            };

            if (mensaje) {
                mensaje = await mensaje.edit({ ...payload, attachments: [] });
            } else {
                const estadoAnterior = this.stockDb.data;
                if (estadoAnterior.channelId && estadoAnterior.messageId && estadoAnterior.channelId !== destino.id) {
                    const canalAnterior = await this.client.channels.fetch(estadoAnterior.channelId).catch(() => null);
                    const mensajeAnterior = canalAnterior?.isTextBased?.()
                        ? await canalAnterior.messages.fetch(estadoAnterior.messageId).catch(() => null)
                        : null;
                    await mensajeAnterior?.delete().catch(() => null);
                }
                mensaje = await destino.send(payload);
            }

            this.stockDb.data.channelId = destino.id;
            this.stockDb.data.messageId = mensaje.id;
            this.stockDb.data.fingerprint = fingerprint;
            this.stockDb.data.updatedAt = actualizadoEn;
            this.stockDb.data.pageCount = paneles.length;
            this.stockDb.data.lastError = '';
            this.stockDb.flush();
            logger.detalle(`Panel HTML/Chromium de stock actualizado: ${productos.length} productos · ${paneles.length} imagen(es) · #${destino.id}`);
            return mensaje;
        };

        const previo = this.actualizandoStock ?? Promise.resolve();
        const actual = previo.then(trabajo, trabajo);
        const cierre = actual.finally(() => {
            if (this.actualizandoStock === cierre) this.actualizandoStock = null;
        });
        this.actualizandoStock = cierre;
        return cierre;
    }

    async procesarEventoWebhook(payload) {
        const evento = String(payload?.event ?? '');
        const datos = payload?.data ?? {};
        const eventosFactura = new Set([
            'NOTIFICATION.SHOP_INVOICE_CREATED',
            'NOTIFICATION.SHOP_INVOICE_PROCESSED',
            'NOTIFICATION.SHOP_INVOICE_CONFIRMING',
            'NOTIFICATION.SHOP_INVOICE_OUT_OF_STOCK'
        ]);

        if (eventosFactura.has(evento)) {
            if (evento === 'NOTIFICATION.SHOP_INVOICE_PROCESSED' && datos.invoice_id) {
                try {
                    const factura = await this.api.obtenerFactura(datos.invoice_id);
                    await this.aplicarNivelDesdeFactura(factura);
                } catch (error) {
                    logger.error(
                        'sellauth:clientes',
                        `No se pudo comprobar la factura ${datos.invoice_id}: ${error.message}`
                    );
                }
            }

            await this.sincronizarProductos({ anunciar: true });
            return;
        }

        return super.procesarEventoWebhook(payload);
    }

    async publicarAviso(tipo, producto, anterior = null) {
        if (tipo === 'new') {
            return super.publicarAviso(tipo, producto, anterior);
        }

        const canales = this.config.channels ?? {};
        const canalId = tipo === 'price' ? canales.priceUpdates : canales.restocks;
        const activado = tipo === 'price'
            ? this.config.announcements?.priceChanges?.enabled
            : this.config.announcements?.restocks?.enabled;

        if (!activado || !canalId) return null;

        const canal = await this.client.channels.fetch(canalId).catch(() => null);
        if (!canal?.isTextBased?.()) {
            logger.warn('sellauth:avisos', `El canal ${canalId} no existe o no admite mensajes.`);
            return null;
        }

        if (tipo === 'restock') {
            await this.avisarSuscriptores(producto).catch(error =>
                logger.warn('sellauth:restock', `No se pudo avisar a los suscriptores: ${error.message}`));
        }

        const bajada = tipo === 'price' && Number(producto.precio) < Number(anterior);
        const ajustesAviso = tipo === 'price'
            ? this.config.announcements.priceChanges
            : this.config.announcements.restocks;
        const titulo = tipo === 'price'
            ? (bajada ? ajustesAviso.titleDrop : ajustesAviso.titleIncrease)
            : ajustesAviso.title;

        const buffer = await arte.generarAviso({
            tipo: tipo === 'price' ? 'price' : 'restock',
            producto,
            anterior,
            titulo
        });
        const nombre = arte.nombreArchivo(tipo, producto);
        const archivo = new AttachmentBuilder(buffer, { name: nombre });
        const mencionarEveryone = tipo !== 'price';

        const container = new ContainerBuilder();
        if (mencionarEveryone) {
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('@everyone')
            );
        }
        container.addMediaGalleryComponents(
            ui.galeria([`attachment://${nombre}`])
        );

        return canal.send({
            components: [container],
            files: [archivo],
            flags: ui.V2,
            allowedMentions: mencionarEveryone
                ? { parse: ['everyone'] }
                : { parse: [] }
        });
    }
}

module.exports = MinimalSellAuthAnnouncements;
