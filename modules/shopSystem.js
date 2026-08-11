'use strict';

const {
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    LabelBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags
} = require('discord.js');

const logger = require('../utils/logger');
const config = require('../utils/config');
const ui = require('../utils/ui');
const media = require('../utils/media');
const Database = require('../utils/jsonDatabase');

const ESQUEMA = {
    contador: 0,
    productos: {},
    panel: { canalId: '', mensajeId: '' }
};

const STOCK_ILIMITADO = -1;

/**
 * Catalogo de productos.
 *
 * El bot no cobra ni procesa pagos: enseña el catalogo y, al comprar, abre un
 * ticket de la categoria configurada con el producto ya rellenado. El trato se
 * cierra ahi, con una persona delante.
 */
class ShopSystem {
    constructor(client, emojis) {
        this.client = client;
        this.emojis = emojis;
        this.db = new Database('productos', ESQUEMA);
    }

    get config() {
        return config.cargar('shop');
    }

    iniciar() {
        const { compra } = this.config;
        const categorias = config.cargar('tickets').categorias;

        if (!categorias[compra.categoriaTicket]) {
            logger.warn('tienda', `compra.categoriaTicket apunta a '${compra.categoriaTicket}', que no existe en config/tickets.json`);
        }

        const visibles = this.visibles().length;
        logger.detalle(`${Object.keys(this.db.data.productos).length} productos · ${visibles} visibles`);
    }

    // ------------------------------------------------------------- catalogo

    /** Productos publicados, ordenados por categoria y nombre. */
    visibles() {
        return Object.values(this.db.data.productos)
            .filter(p => p.visible)
            .sort((a, b) =>
                a.categoria.localeCompare(b.categoria) || a.nombre.localeCompare(b.nombre)
            );
    }

    hayStock(producto) {
        return producto.stock === STOCK_ILIMITADO || producto.stock > 0;
    }

    stockTexto(producto) {
        if (producto.stock === STOCK_ILIMITADO) return 'Made to order';
        return producto.stock > 0 ? String(producto.stock) : 'Sold out';
    }

    precioTexto(producto) {
        try {
            return new Intl.NumberFormat('es-ES', {
                style: 'currency', currency: this.config.moneda,
                minimumFractionDigits: 2, maximumFractionDigits: 2
            }).format(producto.precio);
        } catch {
            return `${Number(producto.precio).toFixed(2)}${this.config.simbolo}`;
        }
    }

    /** Panel publico. No pagina: abre el catalogo en efimero para cada usuario. */
    construirPanel() {
        const { catalogo } = this.config;
        const productos = this.visibles();
        const banner = media.resolver(catalogo.banner, 'spotify-market-catalogo');

        const c = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# ${this.emojis.get('bots')} ${catalogo.titulo}\n` +
                    `${catalogo.subtitulo ? `> **${catalogo.subtitulo}**\n` : ''}` +
                    `> ${catalogo.descripcion}`
                )
            )
            .addSeparatorComponents(ui.linea());

        const porCategoria = new Map();
        for (const p of productos) {
            const lista = porCategoria.get(p.categoria) ?? [];
            lista.push(p);
            porCategoria.set(p.categoria, lista);
        }

        if (porCategoria.size) {
            let resumen = '';
            for (const [categoria, lista] of porCategoria) {
                const desde = Math.min(...lista.map(p => p.precio));
                resumen += `> ${this.emojis.get('folder')} **${categoria}**・${lista.length} product(s) · from ${desde.toFixed(2)}${this.config.simbolo}\n`;
            }
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(resumen.trim()));
        } else {
            c.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('-# No products have been published yet.')
            );
        }

        if (catalogo.ventajas?.length) {
            c.addSeparatorComponents(ui.linea());
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### ${this.emojis.rol('destacado')} How we work\n` +
                catalogo.ventajas.slice(0, 6).map(item => `- ${item}`).join('\n')
            ));
        }

        c.addSeparatorComponents(ui.aire());
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `${this.emojis.rol('producto')} **Published products:** ${ui.dato(ui.numero(productos.length))}\n` +
            `${this.emojis.rol('catalogo')} **Active categories:** ${ui.dato(ui.numero(porCategoria.size))}`
        ));

        if (banner) {
            c.addSeparatorComponents(ui.linea());
            c.addMediaGalleryComponents(ui.galeria([banner.url], catalogo.titulo));
        }

        c.addSeparatorComponents(ui.linea());
        c.addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `${this.emojis.get('buscar')} **Want to see every product?**\n` +
                        `-# The catalog opens privately and does not change the public panel.`
                    )
                )
                .setButtonAccessory(
                    ui.conEmoji(
                        new ButtonBuilder()
                            .setCustomId('shop:pagina:0:-1')
                            .setLabel(catalogo.etiquetaBoton ?? 'Browse catalog')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(productos.length === 0),
                        this.emojis.get('buscar')
                    )
                )
        );

        if (catalogo.nota) {
            c.addSeparatorComponents(ui.aire());
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `-# ${this.emojis.rol('info')} ${catalogo.nota}`
            ));
        }

        return { components: [c], files: banner?.files ?? [], flags: ui.V2 };
    }

    /**
     * Una pagina del catalogo: un producto por pagina.
     * Con uno solo caben imagen, descripcion completa y boton sin acercarse al
     * limite de 4000 caracteres.
     */
    construirPagina(productos, pagina, filtro = '-1') {
        const p = productos[pagina];
        const agotado = !this.hayStock(p);
        const { catalogo } = this.config;

        const c = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# ${this.emojis.get('bots')} ${p.nombre}\n\n> ${p.descripcion}`
                )
            );

        if (p.imagen?.trim() && media.esHttps(p.imagen)) {
            c.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(
                    new MediaGalleryItemBuilder().setURL(p.imagen).setDescription(p.nombre)
                )
            );
        }

        c.addSeparatorComponents(ui.linea());
        c.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${this.emojis.get('dinero')} **Price:** ${this.precioTexto(p)}\n` +
                `${this.emojis.get('folder')} **Category:** ${p.categoria}\n` +
                `${this.emojis.get('files')} **Availability:** ${this.stockTexto(p)}`
            )
        );

        c.addSeparatorComponents(ui.linea());
        c.addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        agotado
                            ? `${this.emojis.rol('error')} **Unavailable**\n-# ${catalogo.textoAgotado}`
                            : `${this.emojis.get('wallet')} **Buy now**\n-# ${catalogo.textoCompra}`
                    )
                )
                .setButtonAccessory(
                    ui.conEmoji(
                        new ButtonBuilder()
                            .setCustomId(`shop:comprar:${p.id}`)
                            .setLabel(agotado ? 'Unavailable' : 'Buy')
                            .setStyle(agotado ? ButtonStyle.Secondary : ButtonStyle.Success)
                            .setDisabled(agotado),
                        this.emojis.get(agotado ? 'error' : 'wallet')
                    )
                )
        );

        // El contador como boton deshabilitado en el centro: asi no hay que
        // meterlo en el texto y no se desalinea al cambiar de pagina.
        c.addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`shop:pagina:${pagina - 1}:${filtro}`)
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(pagina === 0),
                new ButtonBuilder()
                    .setCustomId('shop:nada:0')
                    .setLabel(`${pagina + 1} / ${productos.length}`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId(`shop:pagina:${pagina + 1}:${filtro}`)
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(pagina >= productos.length - 1)
            )
        );

        const categoriasActivas = this.config.categorias
            .map((nombre, indice) => ({ nombre, indice }))
            .filter(({ nombre }) => this.visibles().some(producto => producto.categoria === nombre))
            .slice(0, 24);
        if (categoriasActivas.length > 1) {
            const selector = new StringSelectMenuBuilder()
                .setCustomId('shop:filtrar')
                .setPlaceholder('Filter by category')
                .addOptions(
                    new StringSelectMenuOptionBuilder()
                        .setLabel('All products')
                        .setValue('-1')
                        .setDefault(filtro === '-1'),
                    ...categoriasActivas.map(({ nombre, indice }) =>
                        new StringSelectMenuOptionBuilder()
                            .setLabel(nombre.slice(0, 100))
                            .setValue(String(indice))
                            .setDefault(String(indice) === filtro)
                    )
                );
            c.addActionRowComponents(new ActionRowBuilder().addComponents(selector));
        }

        return { components: [c], flags: ui.V2_EFIMERO };
    }

    async publicarPanel(canal) {
        const carga = this.construirPanel();
        const { panel } = this.db.data;

        if (panel.canalId === canal.id && panel.mensajeId) {
            const previo = await canal.messages.fetch(panel.mensajeId).catch(() => null);
            if (previo) {
                await previo.edit({ ...carga, attachments: [] });
                return previo;
            }
        }

        const mensaje = await canal.send(carga);
        this.db.data.panel = { canalId: canal.id, mensajeId: mensaje.id };
        this.db.save();
        return mensaje;
    }

    /**
     * Reescribe el panel publicado tras un cambio en el catalogo.
     * Si el mensaje ya no existe, se olvida la referencia en vez de reintentar
     * en cada cambio.
     */
    async refrescarPanel() {
        const { canalId, mensajeId } = this.db.data.panel;
        if (!canalId || !mensajeId) return;

        const canal = await this.client.channels.fetch(canalId).catch(() => null);
        const mensaje = canal ? await canal.messages.fetch(mensajeId).catch(() => null) : null;

        if (!mensaje) {
            this.db.data.panel = { canalId: '', mensajeId: '' };
            this.db.save();
            return;
        }

        await mensaje.edit({ ...this.construirPanel(), attachments: [] }).catch(error =>
            logger.error('tienda', `No se pudo refrescar el panel: ${error.message}`)
        );
    }

    // -------------------------------------------------------------- enrutado

    async handle(interaction, accion, datos) {
        switch (accion) {
            case 'pagina': return this.mostrarPagina(interaction, Number(datos[0]), datos[1] ?? '-1');
            case 'filtrar': return this.mostrarPagina(interaction, 0, interaction.values[0]);
            case 'comprar': return this.comprar(interaction, datos[0]);
            case 'crear': return this.guardarDesdeModal(interaction, null, Number(datos[0]));
            case 'guardar': return this.guardarDesdeModal(interaction, datos[0], null);
            default: return undefined;
        }
    }

    /**
     * Modal de alta o edicion. Cinco campos, que es el maximo de Discord, por
     * eso la categoria no va aqui: se elige en el comando.
     *
     * @param {object|null} producto  Si viene, el modal es de edicion
     * @param {number|null} indiceCategoria  Indice en config/shop.json > categorias
     */
    modalProducto(producto = null, indiceCategoria = null) {
        const modal = new ModalBuilder()
            .setCustomId(producto ? `shop:guardar:${producto.id}` : `shop:crear:${indiceCategoria}`)
            .setTitle(producto ? `Editar ${producto.nombre}`.slice(0, 45) : 'Nuevo producto');

        const campos = [
            {
                id: 'nombre',
                etiqueta: 'Nombre',
                estilo: TextInputStyle.Short,
                maxLength: 80,
                requerido: true,
                valor: producto?.nombre
            },
            {
                id: 'descripcion',
                etiqueta: 'Descripcion',
                descripcion: 'Que incluye y para quien es',
                estilo: TextInputStyle.Paragraph,
                maxLength: 800,
                requerido: true,
                valor: producto?.descripcion
            },
            {
                id: 'precio',
                etiqueta: 'Precio',
                descripcion: `En ${this.config.moneda}. Admite coma o punto`,
                estilo: TextInputStyle.Short,
                maxLength: 12,
                requerido: true,
                valor: producto ? String(producto.precio) : undefined
            },
            {
                id: 'stock',
                etiqueta: 'Stock',
                descripcion: 'Un numero, o "bajo pedido" si no tiene limite',
                estilo: TextInputStyle.Short,
                maxLength: 20,
                requerido: true,
                valor: producto
                    ? (producto.stock === STOCK_ILIMITADO ? 'bajo pedido' : String(producto.stock))
                    : undefined
            },
            {
                id: 'imagen',
                etiqueta: 'Imagen',
                descripcion: 'URL completa. Dejalo vacio si no tiene',
                estilo: TextInputStyle.Short,
                maxLength: 400,
                requerido: false,
                valor: producto?.imagen
            }
        ];

        for (const campo of campos) {
            const entrada = new TextInputBuilder()
                .setCustomId(campo.id)
                .setStyle(campo.estilo)
                .setRequired(campo.requerido)
                .setMaxLength(campo.maxLength);

            if (campo.valor) entrada.setValue(campo.valor.slice(0, campo.maxLength));

            const etiqueta = new LabelBuilder()
                .setLabel(campo.etiqueta)
                .setTextInputComponent(entrada);

            if (campo.descripcion) etiqueta.setDescription(campo.descripcion);

            modal.addLabelComponents(etiqueta);
        }

        return modal;
    }

    /**
     * Acepta coma o punto decimal, y simbolos alrededor: se escriben las dos
     * formas y es facil colar un '€'.
     *
     * Se exige que quede un numero de verdad tras limpiar. Sin esa
     * comprobacion, un texto sin digitos deja la cadena vacia y Number('') es
     * 0: un precio mal escrito crearia un producto gratis sin avisar.
     */
    static parsePrecio(texto) {
        const limpio = String(texto).trim().replace(',', '.').replace(/[^\d.]/g, '');
        if (!/^\d+(\.\d+)?$/.test(limpio)) return null;

        return Math.round(Number(limpio) * 100) / 100;
    }

    /** Un numero, o cualquier forma de decir que no tiene limite. */
    static parseStock(texto) {
        const limpio = String(texto).trim().toLowerCase();

        if (['bajo pedido', 'ilimitado', 'infinito', '-1', 'sin limite'].includes(limpio)) {
            return STOCK_ILIMITADO;
        }

        const valor = Number.parseInt(limpio, 10);
        return Number.isInteger(valor) && valor >= 0 ? valor : null;
    }

    async guardarDesdeModal(interaction, id, indiceCategoria) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const leer = campo => interaction.fields.getTextInputValue(campo);

        const precio = ShopSystem.parsePrecio(leer('precio'));
        if (precio === null) {
            return interaction.editReply({
                components: [ui.error(this.emojis, 'El precio no es valido. Escribe solo el numero, por ejemplo `49,90`.')],
                flags: ui.V2
            });
        }

        const stock = ShopSystem.parseStock(leer('stock'));
        if (stock === null) {
            return interaction.editReply({
                components: [ui.error(this.emojis, 'El stock no es valido. Pon un numero entero o `bajo pedido`.')],
                flags: ui.V2
            });
        }

        const imagen = leer('imagen')?.trim() ?? '';
        if (imagen && !/^https:\/\/\S+$/i.test(imagen)) {
            return interaction.editReply({
                components: [ui.error(this.emojis, 'La imagen tiene que ser una URL https completa, o quedarse vacia.')],
                flags: ui.V2
            });
        }

        const datos = {
            nombre: leer('nombre'),
            descripcion: leer('descripcion'),
            precio,
            stock,
            imagen
        };

        if (id) {
            const producto = await this.editar(id, datos);
            return interaction.editReply({
                components: [producto
                    ? ui.exito(this.emojis, `**${producto.nombre}** actualizado.`)
                    : ui.error(this.emojis, 'Ese producto ya no existe.')],
                flags: ui.V2
            });
        }

        const categoria = this.config.categorias[indiceCategoria];
        if (!categoria) {
            return interaction.editReply({
                components: [ui.error(this.emojis, 'Esa categoria ya no existe en config/shop.json.')],
                flags: ui.V2
            });
        }

        const producto = await this.anadir({ ...datos, categoria });
        logger.ok('tienda', `Producto anadido: ${producto.nombre}`);

        return interaction.editReply({
            components: [ui.exito(this.emojis, `**${producto.nombre}** anadido a ${categoria} por ${this.precioTexto(producto)}.\n-# ID \`${producto.id}\``)],
            flags: ui.V2
        });
    }

    async mostrarPagina(interaction, pagina, filtro = '-1') {
        const categoria = Number(filtro) >= 0 ? this.config.categorias[Number(filtro)] : null;
        const productos = categoria
            ? this.visibles().filter(producto => producto.categoria === categoria)
            : this.visibles();

        if (!productos.length) {
            return interaction.reply({
                components: [ui.info(this.emojis, 'No products have been published yet.')],
                flags: ui.V2_EFIMERO
            });
        }

        // El catalogo puede haber encogido entre que se abrio y se navega.
        const indice = Math.max(0, Math.min(pagina, productos.length - 1));
        const carga = this.construirPagina(productos, indice, String(filtro));

        // Si ya hay una vista abierta se edita, y si no se crea: asi navegar no
        // deja un rastro de mensajes efimeros.
        if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
            await interaction.deferUpdate();
            return interaction.editReply({ components: carga.components, flags: ui.V2 });
        }

        return interaction.reply(carga);
    }

    async comprar(interaction, productoId) {
        const producto = this.db.data.productos[productoId];

        if (!producto || !producto.visible) {
            return interaction.reply({
                components: [ui.error(this.emojis, 'That product is no longer available.')],
                flags: ui.V2_EFIMERO
            });
        }

        // Se vuelve a mirar el stock aqui, no solo al pintar la pagina: entre
        // que se abrio el catalogo y se pulsa pueden haber pasado minutos.
        if (!this.hayStock(producto)) {
            return interaction.reply({
                components: [ui.aviso(this.emojis, this.config.catalogo.textoAgotado)],
                flags: ui.V2_EFIMERO
            });
        }

        const tickets = this.client.sistemas?.ticket;
        if (!tickets) {
            return interaction.reply({
                components: [ui.error(this.emojis, 'The ticket system is currently unavailable.')],
                flags: ui.V2_EFIMERO
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const clave = this.config.compra.categoriaTicket;
        const campos = config.cargar('tickets').categorias[clave]?.formulario ?? [];

        // El formulario se rellena por id de campo, para que siga funcionando
        // si se reordenan o se anaden campos en config/tickets.json.
        const respuestas = {};
        if (campos.some(c => c.id === 'producto')) {
            respuestas.producto = `${producto.nombre} · ${this.precioTexto(producto)}`;
        }
        if (campos.some(c => c.id === 'requisitos')) {
            respuestas.requisitos = producto.descripcion;
        }

        await tickets.abrir(interaction, clave, respuestas);
    }

    // ------------------------------------------------------------------ CRUD

    /**
     * Discord no interpreta HTML: si llega pegado desde una web, se veria tal
     * cual en el panel. Se limpia al guardar, no al renderizar.
     */
    static limpiar(texto) {
        return String(texto)
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    async anadir({ nombre, descripcion, precio, stock, categoria, imagen }) {
        const id = String(++this.db.data.contador);

        const producto = {
            id,
            nombre: ShopSystem.limpiar(nombre),
            descripcion: ShopSystem.limpiar(descripcion),
            precio,
            stock,
            categoria,
            imagen: imagen?.trim() || '',
            visible: true,
            creadoEn: Date.now(),
            actualizadoEn: Date.now()
        };

        this.db.data.productos[id] = producto;
        this.db.save();

        await this.refrescarPanel();
        return producto;
    }

    async editar(id, cambios) {
        const producto = this.db.data.productos[id];
        if (!producto) return null;

        if (cambios.nombre !== undefined) producto.nombre = ShopSystem.limpiar(cambios.nombre);
        if (cambios.descripcion !== undefined) producto.descripcion = ShopSystem.limpiar(cambios.descripcion);
        if (cambios.precio !== undefined) producto.precio = cambios.precio;
        if (cambios.stock !== undefined) producto.stock = cambios.stock;
        if (cambios.categoria !== undefined) producto.categoria = cambios.categoria;
        if (cambios.imagen !== undefined) producto.imagen = cambios.imagen.trim();
        if (cambios.visible !== undefined) producto.visible = cambios.visible;

        producto.actualizadoEn = Date.now();
        this.db.save();

        await this.refrescarPanel();
        return producto;
    }

    async eliminar(id) {
        const producto = this.db.data.productos[id];
        if (!producto) return null;

        delete this.db.data.productos[id];
        this.db.save();

        await this.refrescarPanel();
        return producto;
    }

    static get stockIlimitado() {
        return STOCK_ILIMITADO;
    }
}

module.exports = ShopSystem;
