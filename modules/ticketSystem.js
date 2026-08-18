'use strict';

const {
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    FileBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    UserSelectMenuBuilder,
    ModalBuilder,
    LabelBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType,
    PermissionFlagsBits,
    MessageFlags
} = require('discord.js');
const { createTranscript } = require('discord-html-transcripts');

const logger = require('../utils/logger');
const config = require('../utils/config');
const permisos = require('../utils/permisos');
const ui = require('../utils/ui');
const media = require('../utils/media');
const Database = require('../utils/jsonDatabase');

const ESQUEMA = {
    contador: 0,
    activos: {},
    archivados: {},
    porUsuario: {},
    panel: { canalId: '', mensajeId: '' },
    valoraciones: [],
    bloqueados: {}
};

/** Discord no admite mas de 5 componentes en un modal. */
const MAX_CAMPOS_MODAL = 5;

const SEGUNDOS_ANTES_DE_BORRAR = 5000;
const INTERVALO_PODA_MS = 6 * 60 * 60 * 1000;

/**
 * Sistema de tickets.
 *
 * Toda la configuracion vive en config/tickets.json y config/permissions.json:
 * categorias, formularios, permisos y ajustes se cambian sin tocar este archivo.
 */
class TicketSystem {
    constructor(client, emojis) {
        this.client = client;
        this.emojis = emojis;
        this.db = new Database('tickets', ESQUEMA);
        this.avisosPing = new Map();
        this.aperturasEnCurso = new Set();
        this.temporizador = null;
        this.temporizadorPanel = null;
    }

    get config() {
        return config.cargar('tickets');
    }

    // ---------------------------------------------------------------- arranque

    /**
     * Comprueba la configuracion y deja el estado consistente.
     * Los IDs vacios se avisan aqui: es preferible verlo al arrancar que
     * descubrirlo a mitad de un ticket.
     */
    async iniciar() {
        const { categorias, ajustes } = this.config;
        const pendientes = [];

        for (const [clave, cat] of Object.entries(categorias)) {
            if (!cat.categoriaId) pendientes.push(`categorias.${clave}.categoriaId`);
            if (cat.formulario.length > MAX_CAMPOS_MODAL) {
                logger.warn('tickets', `La categoria '${clave}' define ${cat.formulario.length} campos y Discord admite ${MAX_CAMPOS_MODAL}.`);
            }
        }
        if (ajustes.transcripciones.activo && !ajustes.transcripciones.canalId) {
            pendientes.push('ajustes.transcripciones.canalId');
        }
        if (ajustes.valoraciones.activo && !ajustes.valoraciones.canalId) {
            pendientes.push('ajustes.valoraciones.canalId');
        }
        if (!Object.values(config.cargar('permissions').roles).some(r => r.roleId)) {
            pendientes.push('permissions.roles[].roleId');
        }

        const huerfanos = await this.limpiarHuerfanos();

        if (pendientes.length) {
            logger.warn('tickets', `${pendientes.length} valores sin configurar en config/tickets.json`);
            logger.detalle(pendientes.join(', '));
        }
        if (huerfanos) {
            logger.detalle(`${huerfanos} tickets huerfanos retirados de la base de datos`);
        }

        if (ajustes.autocierre.activo) this.programarAutocierre();
        this.programarPoda();
        if (ajustes.sla?.activo) this.programarSla();
    }

    /**
     * Retira de la base de datos los tickets cuyo canal ya no existe.
     *
     * Se mira primero la cache y solo se pide a Discord lo que falta, en
     * paralelo: en serie, cuarenta tickets abiertos eran cuarenta viajes
     * encadenados que retrasaban el arranque varios segundos.
     */
    async limpiarHuerfanos() {
        const ids = Object.keys(this.db.data.activos);
        if (!ids.length) return 0;

        const comprobaciones = await Promise.all(ids.map(async canalId => {
            if (this.client.channels.cache.has(canalId)) return null;
            const canal = await this.client.channels.fetch(canalId).catch(() => null);
            return canal ? null : canalId;
        }));

        const huerfanos = comprobaciones.filter(Boolean);
        for (const canalId of huerfanos) {
            const t = this.db.data.activos[canalId];
            this.soltarDeUsuario(t.userId, t.id);
            delete this.db.data.activos[canalId];
        }

        if (huerfanos.length) this.db.flush();
        return huerfanos.length;
    }

    /**
     * Poda periodica del historico.
     *
     * activos es pequeno, pero archivados y valoraciones crecen para siempre y
     * el JSON se reescribe entero en cada guardado: sin poda, cada ticket nuevo
     * encarece todos los guardados posteriores. Lo retirado se conserva en
     * database/historico/.
     */
    programarPoda() {
        const podar = () => {
            const { retencion } = this.config.ajustes;
            const maxArchivados = Number(retencion?.maxArchivados) || 500;
            const maxValoraciones = Number(retencion?.maxValoraciones) || 1000;

            this.db.podar('archivados', maxArchivados, t => Number(t?.cerradoEn ?? t?.abiertoEn ?? 0));
            this.db.podar('valoraciones', maxValoraciones, v => Number(v?.fecha ?? 0));
        };

        podar();
        const temporizador = setInterval(podar, INTERVALO_PODA_MS);
        temporizador.unref?.();
        this.temporizadorPoda = temporizador;
    }

    // ------------------------------------------------------------------ panel

    construirPanel() {
        const { panel, categorias, ajustes } = this.config;
        const banner = media.resolver(panel.banner ?? panel.bannerUrl, 'spotify-market-tickets');
        const c = new ContainerBuilder();

        c.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# ${this.emojis.get('ticket')} ${panel.titulo}\n` +
                `${panel.subtitulo ? `> **${panel.subtitulo}**\n` : ''}` +
                `> ${panel.descripcion}`
            )
        );
        c.addSeparatorComponents(ui.linea());

        let lista = `## ${this.emojis.rol('info')} ${panel.tituloCategorias ?? 'Categories'}\n\n`;
        for (const cat of Object.values(categorias)) {
            lista += `${this.emojis.get(cat.emoji)} **${cat.nombre}**\n> ${cat.descripcion}\n`;
        }
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(lista));

        if (panel.pasos?.length) {
            c.addSeparatorComponents(ui.linea());
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### ${this.emojis.get('files')} How it works\n` +
                panel.pasos.slice(0, 5).map((paso, i) => `**${i + 1}.** ${paso}`).join('\n')
            ));
        }

        c.addSeparatorComponents(ui.aire());
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `${this.emojis.get('clock')} **Response:** ${panel.respuestaEstimada}\n` +
            `${this.emojis.get('ticket')} **Open tickets:** ${ui.dato(ui.numero(Object.keys(this.db.data.activos).length))}\n` +
            `${this.emojis.get('user')} **Personal limit:** ${ui.dato(ajustes.maxTicketsPorUsuario)}`
        ));

        if (banner) {
            c.addSeparatorComponents(ui.linea());
            c.addMediaGalleryComponents(ui.galeria([banner.url], panel.titulo));
        }

        c.addSeparatorComponents(ui.linea());
        c.addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `${this.emojis.get('createchannels')} **Ready to open a ticket?**\n` +
                        `-# Choose a category in the next step.`
                    )
                )
                .setButtonAccessory(
                    ui.conEmoji(
                        new ButtonBuilder()
                            .setCustomId('ticket:open:menu')
                            .setLabel(panel.etiquetaBoton ?? 'Create ticket')
                            .setStyle(ButtonStyle.Secondary),
                        this.emojis.get('ticket')
                    )
                )
        );

        if (panel.nota) {
            c.addSeparatorComponents(ui.aire());
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `-# ${this.emojis.rol('aviso')} ${panel.nota}`
            ));
        }

        return { components: [c], files: banner?.files ?? [], flags: ui.V2 };
    }

    /** Envia el panel, o edita el existente si ya se habia enviado. */
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

    /** Actualiza los contadores del panel sin enviar un mensaje nuevo. */
    programarRefrescoPanel() {
        if (this.temporizadorPanel) return;
        this.temporizadorPanel = setTimeout(async () => {
            this.temporizadorPanel = null;
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
                logger.warn('tickets', `No se pudo refrescar el panel: ${error.message}`)
            );
        }, 2000);
        this.temporizadorPanel.unref?.();
    }

    // ------------------------------------------------------------- enrutado

    async handle(interaction, accion, datos) {
        switch (accion) {
            case 'open': return this.mostrarCategorias(interaction);
            case 'categoria': return this.mostrarFormulario(interaction);
            case 'form': return this.crear(interaction, datos[0]);
            case 'claim': return this.reclamar(interaction, datos[0]);
            case 'liberar': return this.liberar(interaction, datos[0]);
            case 'admin': return this.mostrarMenuAdmin(interaction, datos[0]);
            case 'adminaccion': return this.ejecutarAccionAdmin(interaction, datos[0]);
            case 'invitar': return this.mostrarSelectorUsuario(interaction, datos[0]);
            case 'addusuario': return this.anadirUsuario(interaction, datos[0]);
            case 'retirar': return this.mostrarSelectorRetirada(interaction, datos[0]);
            case 'removeusuario': return this.retirarUsuario(interaction, datos[0]);
            case 'prioridad': return this.mostrarPrioridades(interaction, datos[0]);
            case 'setprioridad': return this.cambiarPrioridad(interaction, datos[0]);
            case 'renombrarmodal': return this.renombrarDesdeModal(interaction, datos[0]);
            case 'notamodal': return this.notaDesdeModal(interaction, datos[0]);
            case 'notificarmodal': return this.notificarDesdeModal(interaction, datos[0]);
            case 'bloquearmodal': return this.bloquearDesdeModal(interaction, datos[0]);
            case 'cerrar': return this.pedirCierre(interaction, datos[0]);
            case 'cerrarmodal': return this.cerrarDesdeModal(interaction, datos[0]);
            case 'cerrarok': return this.confirmarCierre(interaction, datos[0]);
            case 'cancelar': return this.cancelarCierre(interaction);
            case 'reabrir': return this.reabrir(interaction, datos[0]);
            case 'eliminar': return this.pedirEliminar(interaction, datos[0]);
            case 'eliminarok': return this.eliminarCanal(interaction, datos[0]);
            case 'valorar': return this.registrarValoracion(interaction, datos[0], Number(datos[1]));
            case 'macros': return this.mostrarMacros(interaction, datos[0]);
            case 'macro': return this.enviarMacro(interaction, datos[0]);
            default: return undefined;
        }
    }

    async mostrarCategorias(interaction) {
        const { categorias } = this.config;

        const fila = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('ticket:categoria')
                .setPlaceholder('Choose a category')
                .addOptions(
                    Object.entries(categorias).map(([clave, cat]) => {
                        const opcion = new StringSelectMenuOptionBuilder()
                            .setLabel(cat.nombre)
                            .setDescription(cat.descripcion.slice(0, 100))
                            .setValue(clave);

                        const emoji = this.emojis.get(cat.emoji);
                        if (emoji) opcion.setEmoji(emoji);
                        return opcion;
                    })
                )
        );

        const c = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `## ${this.emojis.get('ticket')} New ticket\n\n` +
                    `> Choose the category that best matches your request.`
                )
            )
            .addSeparatorComponents(ui.aire())
            .addActionRowComponents(fila);

        await interaction.reply({ components: [c], flags: ui.V2_EFIMERO });
    }

    async mostrarFormulario(interaction) {
        const claveCategoria = interaction.values[0];
        const cat = this.config.categorias[claveCategoria];

        if (!cat) {
            return interaction.reply({
                components: [ui.error(this.emojis, 'That category is no longer available.')],
                flags: ui.V2_EFIMERO
            });
        }

        const mantenimiento = this.client.sistemas?.mant?.bloquea(interaction.member);
        if (mantenimiento) {
            return interaction.reply({ components: [mantenimiento], flags: ui.V2_EFIMERO });
        }

        const bloqueo = this.db.data.bloqueados[interaction.user.id];
        if (bloqueo) {
            return interaction.reply({
                components: [ui.error(this.emojis,
                    `You cannot open a ticket right now.\n-# Reason: ${ui.plano(bloqueo.motivo)}`)],
                flags: ui.V2_EFIMERO
            });
        }

        const limite = this.config.ajustes.maxTicketsPorUsuario;
        if (this.abiertosDe(interaction.user.id) >= limite) {
            return interaction.reply({
                components: [ui.aviso(this.emojis, `You already have ${limite} open ticket(s). Close the current one before opening another.`)],
                flags: ui.V2_EFIMERO
            });
        }

        // showModal no admite defer: hay que responder en menos de 3 segundos.
        await interaction.showModal(this.construirModal(claveCategoria, cat));
    }

    construirModal(clave, cat) {
        const modal = new ModalBuilder()
            .setCustomId(`ticket:form:${clave}`)
            .setTitle(cat.nombre.slice(0, 45));

        for (const campo of cat.formulario.slice(0, MAX_CAMPOS_MODAL)) {
            const entrada = new TextInputBuilder()
                .setCustomId(campo.id)
                .setStyle(campo.estilo === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
                .setRequired(campo.requerido ?? false)
                .setMaxLength(campo.maxLength ?? 1000);

            const etiqueta = new LabelBuilder()
                .setLabel(campo.etiqueta)
                .setTextInputComponent(entrada);

            if (campo.descripcion) etiqueta.setDescription(campo.descripcion);

            modal.addLabelComponents(etiqueta);
        }

        return modal;
    }

    // ------------------------------------------------------------- creacion

    /** Entrada desde el modal del panel. */
    async crear(interaction, claveCategoria) {
        const cat = this.config.categorias[claveCategoria];
        if (!cat) return;

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const respuestas = {};
        for (const campo of cat.formulario) {
            const valor = interaction.fields.getTextInputValue(campo.id);
            if (valor?.trim()) respuestas[campo.id] = valor.trim();
        }

        return this.abrir(interaction, claveCategoria, respuestas);
    }

    /**
     * Abre un ticket con las respuestas ya resueltas.
     *
     * Separado de crear() porque la tienda tambien abre tickets, pero rellena
     * el formulario desde el producto en vez de desde un modal. La interaccion
     * debe llegar ya diferida en efimero.
     *
     * @param {object} interaction
     * @param {string} claveCategoria
     * @param {Record<string, string>} respuestas
     */
    async abrir(interaction, claveCategoria, respuestas) {
        const cat = this.config.categorias[claveCategoria];
        if (!cat) {
            return interaction.editReply({
                components: [ui.error(this.emojis, 'That ticket category is no longer available.')],
                flags: ui.V2
            });
        }

        const mantenimiento = this.client.sistemas?.mant?.bloquea(interaction.member);
        if (mantenimiento) {
            return interaction.editReply({ components: [mantenimiento], flags: ui.V2 });
        }

        const bloqueo = this.db.data.bloqueados[interaction.user.id];
        if (bloqueo) {
            return interaction.editReply({
                components: [ui.error(this.emojis,
                    `You cannot open a ticket right now.\n-# Reason: ${ui.plano(bloqueo.motivo)}`)],
                flags: ui.V2
            });
        }

        const limite = this.config.ajustes.maxTicketsPorUsuario;
        if (this.abiertosDe(interaction.user.id) >= limite) {
            return interaction.editReply({
                components: [ui.aviso(this.emojis, `You already have ${limite} open ticket(s).`)],
                flags: ui.V2
            });
        }

        if (this.aperturasEnCurso.has(interaction.user.id)) {
            return interaction.editReply({
                components: [ui.aviso(this.emojis, 'Another ticket is already being created for your account. Please wait a moment.')],
                flags: ui.V2
            });
        }

        this.aperturasEnCurso.add(interaction.user.id);
        try {
            return await this.abrirReservado(interaction, claveCategoria, respuestas, cat);
        } finally {
            this.aperturasEnCurso.delete(interaction.user.id);
        }
    }

    /** Creacion protegida por la reserva de usuario de abrir(). */
    async abrirReservado(interaction, claveCategoria, respuestas, cat) {

        const numero = ++this.db.data.contador;
        // La numeracion no puede retroceder ni siquiera si el proceso cae
        // mientras Discord esta creando el canal.
        this.db.flush();
        const canal = await this.crearCanal(interaction, cat, numero).catch(error => {
            logger.error('tickets', `No se pudo crear el canal: ${error.message}`);
            return null;
        });

        if (!canal) {
            // El contador es monotono: un hueco es mejor que reutilizar un ID
            // que otro ticket simultaneo ya puede haber recibido.
            return interaction.editReply({
                components: [ui.error(this.emojis, 'The ticket channel could not be created. Please contact an administrator.')],
                flags: ui.V2
            });
        }

        const ticket = {
            id: numero,
            canalId: canal.id,
            userId: interaction.user.id,
            avatarUrl: interaction.user.displayAvatarURL({ extension: 'png', size: 128 }),
            categoria: claveCategoria,
            prioridad: cat.prioridadPorDefecto,
            respuestas,
            abiertoEn: Date.now(),
            ultimaActividad: Date.now(),
            avisadoInactividad: false,
            reclamadoPor: null,
            reclamadoEn: null,
            invitados: [],
            estado: 'abierto'
        };

        this.db.data.activos[canal.id] = ticket;
        (this.db.data.porUsuario[interaction.user.id] ??= []).push(numero);
        this.db.flush();

        const mensajeInicial = await canal.send({
            ...this.mensajeInicial(ticket),
            allowedMentions: { users: [interaction.user.id] }
        }).catch(error => {
            logger.error('tickets', `No se pudo publicar el mensaje inicial de #${this.numeroFmt(numero)}: ${error.message}`);
            return null;
        });
        if (!mensajeInicial) {
            delete this.db.data.activos[canal.id];
            this.soltarDeUsuario(interaction.user.id, numero);
            this.db.flush();
            await canal.delete('Creacion de ticket incompleta').catch(() => {});
            return interaction.editReply({
                components: [ui.error(this.emojis, 'The channel was created, but Discord rejected the initial panel. The operation was rolled back.')],
                flags: ui.V2
            });
        }
        ticket.mensajeId = mensajeInicial.id;
        this.db.flush();
        this.programarRefrescoPanel();

        await this.asignarPorRotacion(ticket)
            .then(elegido => elegido && this.refrescarMensaje(ticket))
            .catch(error => logger.warn('tickets', `Reparto automatico: ${error.message}`));

        logger.ok('tickets', `#${this.numeroFmt(numero)} abierto por ${interaction.user.tag}`);
        // El registro no se espera para no retrasar la respuesta, pero se
        // captura: un fallo del log no puede acabar en un rechazo sin atender.
        Promise.resolve(this.client.sistemas?.log?.ticketAbierto?.(ticket, interaction.user))
            .catch(error => logger.error('tickets', `Log de apertura: ${error.message}`));

        await interaction.editReply({
            components: [ui.exito(this.emojis, `Your ticket is ready: <#${canal.id}>.`)],
            flags: ui.V2
        });
    }

    async crearCanal(interaction, cat, numero) {
        const permisosCanal = [
            {
                id: interaction.guild.id,
                deny: [PermissionFlagsBits.ViewChannel]
            },
            {
                id: interaction.user.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.EmbedLinks,
                    PermissionFlagsBits.ReadMessageHistory
                ]
            }
        ];

        const { roles } = config.cargar('permissions');
        for (const clave of cat.rolesPermitidos) {
            const rol = roles[clave];
            if (!rol?.roleId) continue;

            permisosCanal.push({
                id: rol.roleId,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ManageMessages,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.ReadMessageHistory
                ]
            });
        }

        return interaction.guild.channels.create({
            name: this.config.ajustes.formatoNombre.replace('{numero}', this.numeroFmt(numero)),
            type: ChannelType.GuildText,
            parent: cat.categoriaId || null,
            permissionOverwrites: permisosCanal
        });
    }

    // -------------------------------------------------------------- mensajes

    mensajeInicial(t) {
        const cat = this.config.categorias[t.categoria];
        const prioridad = this.config.prioridades[String(t.prioridad)];
        const c = new ContainerBuilder();

        const estado = t.reclamadoPor ? 'IN PROGRESS' : 'WAITING FOR STAFF';
        const resumen = [
            `CASE #${this.numeroFmt(t.id)}`,
            `PRIORITY ${String(prioridad.nombre).toUpperCase()}`,
            estado
        ].join('  |  ');

        c.addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# ${this.emojis.get(cat.emoji)} ${cat.nombre} · #${this.numeroFmt(t.id)}\n` +
                        `> Private support request opened by <@${t.userId}>.\n\n` +
                        `\`${resumen}\``
                    )
                )
                .setThumbnailAccessory(
                    new ThumbnailBuilder().setURL(t.avatarUrl).setDescription('Customer avatar')
                )
        );

        const campos = cat.formulario.filter(campo => t.respuestas[campo.id]);
        if (campos.length) {
            c.addSeparatorComponents(ui.linea());
            let texto = `### ${this.emojis.get('files')} Request details\n`;
            let mostrados = 0;
            for (const campo of campos) {
                const presupuesto = 3000 - texto.length - campo.etiqueta.length - 30;
                if (presupuesto < 80) break;
                const respuesta = ui.plano(ui.truncar(t.respuestas[campo.id], Math.min(900, presupuesto)))
                    .replace(/\n/g, ' / ');
                texto += `**${ui.plano(campo.etiqueta)}** — ${respuesta}\n`;
                mostrados++;
            }
            if (mostrados < campos.length) texto += '-# Remaining answers are preserved in the transcript.';
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(texto.trim()));
        }

        c.addSeparatorComponents(ui.linea());
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(this.lineaEstado(t)));
        c.addActionRowComponents(this.botones(t));

        return { components: [c], flags: ui.V2 };
    }

    lineaEstado(t) {
        const atencion = t.reclamadoPor
            ? `${this.emojis.get('guardian')} **Assigned to <@${t.reclamadoPor}>** · ${ui.fecha(t.reclamadoEn)}`
            : `-# Unclaimed · a support team member will be with you shortly.`;
        const invitados = t.invitados?.length
            ? ` · ${t.invitados.length} invited participant(s)`
            : '';
        const apertura = ` · Opened ${ui.fecha(t.abiertoEn, 'R')}`;
        const actividad = t.ultimaActividad ? ` · Last activity ${ui.fecha(t.ultimaActividad, 'R')}` : '';
        return `${atencion}${invitados}${apertura}${actividad}`;
    }

    botones(t) {
        const fila = new ActionRowBuilder();

        fila.addComponents(
            t.reclamadoPor
                ? ui.conEmoji(
                    new ButtonBuilder()
                        .setCustomId(`ticket:liberar:${t.canalId}`)
                        .setLabel('Release')
                        .setStyle(ButtonStyle.Secondary),
                    this.emojis.get('reply')
                )
                : ui.conEmoji(
                    new ButtonBuilder()
                        .setCustomId(`ticket:claim:${t.canalId}`)
                        .setLabel('Claim')
                        .setStyle(ButtonStyle.Success),
                    this.emojis.get('guardian')
                )
        );

        fila.addComponents(ui.conEmoji(
            new ButtonBuilder()
                .setCustomId(`ticket:admin:${t.canalId}`)
                .setLabel('Admin menu')
                .setStyle(ButtonStyle.Secondary),
            this.emojis.rol('administrador')
        ));

        fila.addComponents(
            ui.conEmoji(
                new ButtonBuilder()
                    .setCustomId(`ticket:cerrar:${t.canalId}`)
                    .setLabel('Close')
                    .setStyle(ButtonStyle.Danger),
                this.emojis.rol('error')
            )
        );

        return fila;
    }

    construirMenuAdmin(t, aviso = '') {
        const cat = this.config.categorias[t.categoria];
        const prioridad = this.config.prioridades[String(t.prioridad)];
        const bloqueado = Boolean(this.db.data.bloqueados[t.userId]);
        const notas = t.notas?.length ?? 0;
        const notificaciones = t.notificaciones?.length ?? 0;
        const c = new ContainerBuilder();

        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ${this.emojis.rol('administrador')} Administración del ticket\n` +
            `-# Controles privados · solo el equipo de soporte puede usar este panel.\n\n` +
            `${this.emojis.get('ticket')} **Caso:** #${this.numeroFmt(t.id)} · ${cat?.nombre ?? t.categoria}\n` +
            `${this.emojis.get('user')} **Cliente:** <@${t.userId}> · \`${t.userId}\`\n` +
            `${this.emojis.get(prioridad?.emoji ?? 'signal_medium')} **Prioridad:** ${prioridad?.nombreAdmin ?? prioridad?.nombre ?? t.prioridad}\n` +
            `${this.emojis.get('guardian')} **Responsable:** ${t.reclamadoPor ? `<@${t.reclamadoPor}>` : 'Sin reclamar'}\n` +
            `${this.emojis.get('people')} **Participantes:** ${t.invitados?.length ?? 0} · **Notas:** ${notas} · **Avisos:** ${notificaciones}`
        ));

        if (aviso) {
            c.addSeparatorComponents(ui.aire());
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`> ${aviso}`));
        }

        c.addSeparatorComponents(ui.linea());
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### ${this.emojis.get('settings')} Herramientas del caso\n` +
            '-# Elige una acción. Los cambios sensibles se confirman mediante formulario.'
        ));

        const acciones = new StringSelectMenuBuilder()
            .setCustomId(`ticket:adminaccion:${t.canalId}`)
            .setPlaceholder('Selecciona una acción administrativa')
            .addOptions(
                new StringSelectMenuOptionBuilder().setLabel('Cambiar prioridad').setDescription('Ajusta la urgencia operativa').setValue('priority'),
                new StringSelectMenuOptionBuilder().setLabel('Notificar al cliente').setDescription('Envía un MD profesional con enlace al ticket').setValue('notify'),
                new StringSelectMenuOptionBuilder().setLabel('Renombrar ticket').setDescription('Añade una referencia útil al canal').setValue('rename'),
                new StringSelectMenuOptionBuilder().setLabel('Añadir nota interna').setDescription('Visible únicamente desde los controles del staff').setValue('note'),
                new StringSelectMenuOptionBuilder().setLabel('Ver notas internas').setDescription(`${notas} nota(s) guardada(s)`).setValue('notes'),
                new StringSelectMenuOptionBuilder().setLabel(bloqueado ? 'Desbloquear cliente' : 'Bloquear futuros tickets').setDescription(bloqueado ? 'Permite que vuelva a abrir tickets' : 'Impide nuevas solicitudes de este cliente').setValue(bloqueado ? 'unblock' : 'block'),
                new StringSelectMenuOptionBuilder().setLabel('Respuesta rápida').setDescription(`${this.config.macros?.length ?? 0} plantilla(s) disponibles`).setValue('macro'),
                new StringSelectMenuOptionBuilder().setLabel('Actualizar panel público').setDescription('Reconstruye el resumen visible del caso').setValue('refresh')
            );
        c.addActionRowComponents(new ActionRowBuilder().addComponents(acciones));

        c.addSeparatorComponents(ui.linea());
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### ${this.emojis.get('people')} Acceso de participantes\n` +
            '-# Añade o retira miembros sin exponer estos controles en el ticket.'
        ));
        c.addActionRowComponents(new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId(`ticket:addusuario:${t.canalId}`)
                .setPlaceholder('Añadir participante')
                .setMinValues(1)
                .setMaxValues(1)
        ));
        c.addActionRowComponents(new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId(`ticket:removeusuario:${t.canalId}`)
                .setPlaceholder(t.invitados?.length ? 'Retirar participante invitado' : 'No hay participantes invitados')
                .setMinValues(1)
                .setMaxValues(1)
                .setDisabled(!t.invitados?.length)
        ));

        c.addSeparatorComponents(ui.aire());
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `-# Abierto ${ui.fecha(t.abiertoEn, 'R')} · última actividad ${ui.fecha(t.ultimaActividad ?? t.abiertoEn, 'R')} · canal \`${t.canalId}\``
        ));
        return c;
    }

    async mostrarMenuAdmin(interaction, canalId) {
        const t = this.db.data.activos[canalId];
        if (!t) return this.avisarTicketAusente(interaction);
        if (!permisos.puede(interaction.member, 'menuAdmin')) {
            return interaction.reply({ components: [ui.error(this.emojis, 'This menu is restricted to the support team.')], flags: ui.V2_EFIMERO });
        }
        return interaction.reply({
            components: [this.construirMenuAdmin(t)],
            flags: ui.V2_EFIMERO,
            allowedMentions: { parse: [] }
        });
    }

    async ejecutarAccionAdmin(interaction, canalId) {
        const t = this.db.data.activos[canalId];
        if (!t) return this.avisarTicketAusente(interaction);
        if (!permisos.puede(interaction.member, 'menuAdmin')) {
            return interaction.reply({ components: [ui.error(this.emojis, 'No tienes acceso a estas herramientas.')], flags: ui.V2_EFIMERO });
        }

        const accion = interaction.values?.[0];
        if (accion === 'priority') return this.mostrarPrioridades(interaction, canalId, true);
        if (accion === 'macro') return this.mostrarMacros(interaction, canalId);
        if (accion === 'rename') return interaction.showModal(this.modalAdmin(
            `ticket:renombrarmodal:${canalId}`, 'Renombrar ticket', 'name', 'Referencia del canal',
            'Ejemplo: revisar-pago o pedido-184', 70, false
        ));
        if (accion === 'note') return interaction.showModal(this.modalAdmin(
            `ticket:notamodal:${canalId}`, 'Nota interna', 'note', 'Nota para el equipo de soporte',
            'Contexto, comprobaciones pendientes o próximos pasos. El cliente no la verá.', 1000, true
        ));
        if (accion === 'notify') return interaction.showModal(this.modalAdmin(
            `ticket:notificarmodal:${canalId}`, 'Notificar al cliente', 'message', 'Nota opcional del equipo',
            'El MD ya incluye el número de caso y un botón para abrir el ticket.', 700, true
        ));
        if (accion === 'block') return interaction.showModal(this.modalAdmin(
            `ticket:bloquearmodal:${canalId}`, 'Bloquear futuros tickets', 'reason', 'Motivo',
            'Explica el motivo con claridad para el registro interno.', 500, true
        ));
        if (accion === 'unblock') {
            if (!permisos.puede(interaction.member, 'bloquearTickets')) {
                return interaction.update({ components: [this.construirMenuAdmin(t, `${this.emojis.rol('error')} No puedes gestionar bloqueos de tickets.`)], flags: ui.V2 });
            }
            this.desbloquearUsuario(t.userId);
            this.registrarAccion(t, 'Cliente desbloqueado para futuros tickets', interaction.user);
            return interaction.update({ components: [this.construirMenuAdmin(t, `${this.emojis.rol('exito')} Cliente desbloqueado.`)], flags: ui.V2 });
        }
        if (accion === 'notes') {
            if (!permisos.puede(interaction.member, 'notas')) {
                return interaction.update({ components: [this.construirMenuAdmin(t, `${this.emojis.rol('error')} No puedes consultar las notas internas.`)], flags: ui.V2 });
            }
            const lista = (t.notas ?? []).slice(-4).reverse().map((nota, i) =>
                `**${i + 1}.** <@${nota.autorId}> · ${ui.fecha(nota.fecha, 'R')}\n> ${ui.plano(ui.truncar(nota.contenido, 220)).replace(/\n/g, '\n> ')}`
            ).join('\n\n') || '-# Todavía no hay notas internas.';
            return interaction.update({ components: [this.construirMenuAdmin(t, `### Notas internas\n${lista}`)], flags: ui.V2, allowedMentions: { parse: [] } });
        }
        if (accion === 'refresh') {
            await this.refrescarMensaje(t);
            return interaction.update({ components: [this.construirMenuAdmin(t, `${this.emojis.rol('exito')} Panel público del ticket actualizado.`)], flags: ui.V2 });
        }
        return interaction.update({ components: [this.construirMenuAdmin(t)], flags: ui.V2 });
    }

    modalAdmin(customId, titulo, id, etiqueta, descripcion, maxLength, paragraph) {
        return new ModalBuilder()
            .setCustomId(customId)
            .setTitle(titulo.slice(0, 45))
            .addLabelComponents(new LabelBuilder()
                .setLabel(etiqueta)
                .setDescription(descripcion)
                .setTextInputComponent(new TextInputBuilder()
                    .setCustomId(id)
                    .setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
                    .setRequired(id !== 'message')
                    .setMaxLength(maxLength)));
    }

    async renombrarDesdeModal(interaction, canalId) {
        const t = this.db.data.activos[canalId];
        if (!t) return this.avisarTicketAusente(interaction);
        if (!permisos.puede(interaction.member, 'renombrar')) {
            return interaction.reply({ components: [ui.error(this.emojis, 'No tienes permiso para renombrar tickets.')], flags: ui.V2_EFIMERO });
        }
        const final = await this.renombrarTicket(t, interaction.fields.getTextInputValue('name'), interaction.user);
        if (final) this.registrarAccion(t, 'Ticket renombrado', interaction.user, final);
        return interaction.reply({ components: [final ? ui.exito(this.emojis, `Canal renombrado a **${final}**.`) : ui.error(this.emojis, 'No se pudo generar un nombre válido.')], flags: ui.V2_EFIMERO });
    }

    async notaDesdeModal(interaction, canalId) {
        const t = this.db.data.activos[canalId];
        if (!t) return this.avisarTicketAusente(interaction);
        if (!permisos.puede(interaction.member, 'notas')) {
            return interaction.reply({ components: [ui.error(this.emojis, 'No tienes permiso para añadir notas internas.')], flags: ui.V2_EFIMERO });
        }
        this.anadirNota(t, interaction.fields.getTextInputValue('note'), interaction.user.id);
        this.registrarAccion(t, 'Nota interna añadida', interaction.user, 'Contenido reservado al equipo');
        return interaction.reply({ components: [ui.exito(this.emojis, 'Nota interna guardada. No se ha mostrado al cliente.')], flags: ui.V2_EFIMERO });
    }

    async bloquearDesdeModal(interaction, canalId) {
        const t = this.db.data.activos[canalId];
        if (!t) return this.avisarTicketAusente(interaction);
        if (!permisos.puede(interaction.member, 'bloquearTickets')) {
            return interaction.reply({ components: [ui.error(this.emojis, 'No tienes permiso para bloquear clientes.')], flags: ui.V2_EFIMERO });
        }
        this.bloquearUsuario(t.userId, interaction.fields.getTextInputValue('reason'), interaction.user.id);
        this.registrarAccion(t, 'Cliente bloqueado para futuros tickets', interaction.user, interaction.fields.getTextInputValue('reason'));
        return interaction.reply({ components: [ui.exito(this.emojis, 'El cliente no podrá abrir tickets nuevos hasta que sea desbloqueado.')], flags: ui.V2_EFIMERO });
    }

    async notificarDesdeModal(interaction, canalId) {
        const t = this.db.data.activos[canalId];
        if (!t) return this.avisarTicketAusente(interaction);
        if (!permisos.puede(interaction.member, 'notificarUsuario')) {
            return interaction.reply({ components: [ui.error(this.emojis, 'No tienes permiso para notificar clientes.')], flags: ui.V2_EFIMERO });
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const usuario = await this.client.users.fetch(t.userId).catch(() => null);
        const cat = this.config.categorias[t.categoria];
        const nota = interaction.fields.getTextInputValue('message')?.trim();
        const enlace = `https://discord.com/channels/${interaction.guildId}/${t.canalId}`;
        if (!usuario) return interaction.editReply({ components: [ui.error(this.emojis, 'No se pudo localizar al cliente.')], flags: ui.V2 });

        const dm = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# ${this.emojis.get('notificacion')} Your ticket needs your attention\n` +
                `Hello <@${t.userId}>. The **${ui.plano(interaction.guild.name)}** team is waiting for your reply.\n\n` +
                `${this.emojis.get('ticket')} **Ticket:** #${this.numeroFmt(t.id)} · ${cat?.nombre ?? t.categoria}\n` +
                `${this.emojis.get('guardian')} **Assigned to:** <@${interaction.user.id}>\n` +
                `${this.emojis.get('clock')} **Last activity:** ${ui.fecha(t.ultimaActividad ?? t.abiertoEn, 'R')}` +
                (nota ? `\n\n> ${ui.plano(nota).replace(/\n/g, '\n> ')}` : '')
            ))
            .addSeparatorComponents(ui.linea())
            .addActionRowComponents(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel('Open ticket').setStyle(ButtonStyle.Link).setURL(enlace)
            ))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent('-# This reminder was sent by the support team.'));

        const enviado = await usuario.send({ components: [dm], flags: ui.V2, allowedMentions: { parse: [] } }).then(() => true).catch(() => false);
        if (!enviado) return interaction.editReply({ components: [ui.aviso(this.emojis, 'No se pudo enviar el mensaje privado. Es posible que el usuario tenga los DM cerrados.')], flags: ui.V2 });

        (t.notificaciones ??= []).push({ por: interaction.user.id, fecha: Date.now(), nota: nota?.slice(0, 700) ?? '' });
        this.db.save();
        await Promise.resolve(this.client.sistemas?.log?.ticketNotificado?.(t, interaction.user, nota)).catch(() => {});
        return interaction.editReply({ components: [ui.exito(this.emojis, 'Cliente notificado por DM con un botón directo al ticket.')], flags: ui.V2 });
    }

    // ---------------------------------------------------------- gestion extra

    async mostrarSelectorUsuario(interaction, canalId) {
        const t = this.db.data.activos[canalId];
        if (!t) return this.avisarTicketAusente(interaction);
        if (!permisos.puede(interaction.member, 'anadirUsuario')) {
            return interaction.reply({
                components: [ui.error(this.emojis, 'No tienes permisos para invitar usuarios al ticket.')],
                flags: ui.V2_EFIMERO
            });
        }

        const fila = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId(`ticket:addusuario:${canalId}`)
                .setPlaceholder('Selecciona a quien quieres invitar')
                .setMinValues(1)
                .setMaxValues(1)
        );

        return interaction.reply({
            components: [ui.panel(this.emojis, {
                emoji: 'anadir',
                titulo: 'Invitar al ticket',
                cuerpo: [ui.texto('La persona seleccionada podra ver el historial, escribir y adjuntar archivos.')],
                acciones: [fila]
            })],
            flags: ui.V2_EFIMERO
        });
    }

    async anadirUsuario(interaction, canalId) {
        const t = this.db.data.activos[canalId];
        if (!t) return this.avisarTicketAusente(interaction);
        if (!permisos.puede(interaction.member, 'anadirUsuario')) {
            return interaction.update({
                components: [ui.error(this.emojis, 'No tienes permisos para invitar usuarios.')],
                flags: ui.V2
            });
        }

        const usuarioId = interaction.values[0];
        if (usuarioId === t.userId || t.invitados?.includes(usuarioId)) {
            return interaction.update({
                components: [ui.info(this.emojis, 'Ese usuario ya forma parte del ticket.')],
                flags: ui.V2
            });
        }

        const miembro = await interaction.guild.members.fetch(usuarioId).catch(() => null);
        if (!miembro) {
            return interaction.update({
                components: [ui.error(this.emojis, 'No se encontro ese miembro en el servidor.')],
                flags: ui.V2
            });
        }

        try {
            await interaction.channel.permissionOverwrites.edit(usuarioId, {
                ViewChannel: true,
                SendMessages: true,
                AttachFiles: true,
                EmbedLinks: true,
                ReadMessageHistory: true
            }, { reason: `Invitado al ticket #${this.numeroFmt(t.id)} por ${interaction.user.tag}` });

            (t.invitados ??= []).push(usuarioId);
            this.db.save();
            await this.refrescarMensaje(t);
            this.registrarAccion(t, 'Participante añadido', interaction.user, `${miembro.user.tag} (${usuarioId})`);

            await interaction.update({
                components: [this.construirMenuAdmin(t, `${this.emojis.rol('exito')} <@${usuarioId}> ya tiene acceso al ticket.`)],
                flags: ui.V2,
                allowedMentions: { parse: [] }
            });
            await interaction.channel.send({
                components: [ui.info(this.emojis, `<@${usuarioId}> was added to this ticket by <@${interaction.user.id}>.`)],
                flags: ui.V2,
                allowedMentions: { users: [usuarioId] }
            });
        } catch (error) {
            return interaction.update({
                components: [ui.error(this.emojis, `No se pudo dar acceso: ${error.message}`)],
                flags: ui.V2
            });
        }
    }

    async mostrarSelectorRetirada(interaction, canalId) {
        const t = this.db.data.activos[canalId];
        if (!t) return this.avisarTicketAusente(interaction);
        if (!permisos.puede(interaction.member, 'anadirUsuario')) {
            return interaction.reply({
                components: [ui.error(this.emojis, 'No tienes permisos para gestionar participantes.')],
                flags: ui.V2_EFIMERO
            });
        }
        if (!t.invitados?.length) {
            return interaction.reply({
                components: [ui.info(this.emojis, 'No hay usuarios invitados que retirar.')],
                flags: ui.V2_EFIMERO
            });
        }

        const fila = new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId(`ticket:removeusuario:${canalId}`)
                .setPlaceholder('Selecciona un usuario invitado')
                .setMinValues(1)
                .setMaxValues(1)
        );

        return interaction.reply({
            components: [ui.panel(this.emojis, {
                emoji: 'eliminar',
                titulo: 'Retirar participante',
                cuerpo: [ui.texto(`Usuarios invitados actualmente: ${t.invitados.map(id => `<@${id}>`).join(' ')}`)],
                acciones: [fila]
            })],
            flags: ui.V2_EFIMERO,
            allowedMentions: { parse: [] }
        });
    }

    async retirarUsuario(interaction, canalId) {
        const t = this.db.data.activos[canalId];
        if (!t) return this.avisarTicketAusente(interaction);
        if (!permisos.puede(interaction.member, 'anadirUsuario')) {
            return interaction.update({
                components: [ui.error(this.emojis, 'No tienes permisos para gestionar participantes.')],
                flags: ui.V2
            });
        }

        const usuarioId = interaction.values[0];
        if (!t.invitados?.includes(usuarioId)) {
            return interaction.update({
                components: [ui.aviso(this.emojis, 'Ese usuario no figura como invitado en este ticket.')],
                flags: ui.V2
            });
        }

        try {
            await interaction.channel.permissionOverwrites.delete(usuarioId,
                `Retirado del ticket #${this.numeroFmt(t.id)} por ${interaction.user.tag}`);
            t.invitados = t.invitados.filter(id => id !== usuarioId);
            this.db.save();
            await this.refrescarMensaje(t);
            this.registrarAccion(t, 'Participante retirado', interaction.user, usuarioId);

            await interaction.update({
                components: [this.construirMenuAdmin(t, `${this.emojis.rol('exito')} <@${usuarioId}> ya no tiene acceso al ticket.`)],
                flags: ui.V2,
                allowedMentions: { parse: [] }
            });
            await interaction.channel.send({
                components: [ui.info(this.emojis, `<@${usuarioId}> no longer has access to this ticket.`)],
                flags: ui.V2,
                allowedMentions: { parse: [] }
            });
        } catch (error) {
            return interaction.update({
                components: [ui.error(this.emojis, `No se pudo retirar el acceso: ${error.message}`)],
                flags: ui.V2
            });
        }
    }

    async mostrarPrioridades(interaction, canalId, actualizar = false) {
        const t = this.db.data.activos[canalId];
        if (!t) return this.avisarTicketAusente(interaction);
        if (!permisos.puede(interaction.member, 'prioridad')) {
            return interaction.reply({
                components: [ui.error(this.emojis, 'No tienes permisos para cambiar la prioridad.')],
                flags: ui.V2_EFIMERO
            });
        }

        const selector = new StringSelectMenuBuilder()
            .setCustomId(`ticket:setprioridad:${canalId}`)
            .setPlaceholder('Selecciona la nueva prioridad')
            .addOptions(Object.entries(this.config.prioridades).map(([valor, prioridad]) => {
                const opcion = new StringSelectMenuOptionBuilder()
                    .setLabel(prioridad.nombreAdmin ?? prioridad.nombre)
                    .setValue(valor)
                    .setDefault(Number(valor) === Number(t.prioridad));
                const emoji = this.emojis.get(prioridad.emoji);
                if (emoji) opcion.setEmoji(emoji);
                return opcion;
            }));

        const payload = {
            components: [ui.panel(this.emojis, {
                emoji: 'prioridadMedia',
                titulo: 'Prioridad del ticket',
                cuerpo: [ui.texto('Usa la prioridad para ordenar la atencion, no para sustituir una explicacion clara.')],
                acciones: [new ActionRowBuilder().addComponents(selector)]
            })],
            flags: ui.V2_EFIMERO
        };
        return actualizar ? interaction.update({ ...payload, flags: ui.V2 }) : interaction.reply(payload);
    }

    async cambiarPrioridad(interaction, canalId) {
        const t = this.db.data.activos[canalId];
        if (!t) return this.avisarTicketAusente(interaction);
        if (!permisos.puede(interaction.member, 'prioridad')) {
            return interaction.update({
                components: [ui.error(this.emojis, 'No tienes permisos para cambiar la prioridad.')],
                flags: ui.V2
            });
        }

        const valor = interaction.values[0];
        const prioridad = this.config.prioridades[valor];
        if (!prioridad) {
            return interaction.update({
                components: [ui.error(this.emojis, 'Esa prioridad ya no existe.')],
                flags: ui.V2
            });
        }

        t.prioridad = Number(valor);
        this.db.save();
        await this.refrescarMensaje(t);
        this.registrarAccion(t, 'Prioridad actualizada', interaction.user, prioridad.nombreAdmin ?? prioridad.nombre);

        await interaction.update({
            components: [this.construirMenuAdmin(t, `${this.emojis.rol('exito')} Prioridad cambiada a **${prioridad.nombreAdmin ?? prioridad.nombre}**.`)],
            flags: ui.V2
        });
    }

    async refrescarMensaje(t) {
        if (!t.mensajeId) return false;
        const canal = await this.client.channels.fetch(t.canalId).catch(() => null);
        const mensaje = await canal?.messages?.fetch(t.mensajeId).catch(() => null);
        if (!mensaje) return false;
        await mensaje.edit(this.mensajeInicial(t)).catch(() => null);
        return true;
    }

    // ---------------------------------------------------------------- claim

    async reclamar(interaction, canalId) {
        const t = this.db.data.activos[canalId];
        if (!t) return this.avisarTicketAusente(interaction);

        if (!permisos.puede(interaction.member, 'claim')) {
            return interaction.reply({
                components: [ui.error(this.emojis, 'No tienes permisos para reclamar tickets.')],
                flags: ui.V2_EFIMERO
            });
        }
        if (t.reclamadoPor) {
            return interaction.reply({
                components: [ui.aviso(this.emojis, `Este ticket ya lo atiende <@${t.reclamadoPor}>.`)],
                flags: ui.V2_EFIMERO
            });
        }

        t.reclamadoPor = interaction.user.id;
        t.reclamadoEn = Date.now();
        this.db.save();
        this.registrarAccion(t, 'Ticket reclamado', interaction.user);

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await this.refrescarMensaje(t);
        await interaction.editReply({
            components: [ui.exito(this.emojis, `Has reclamado el ticket #${this.numeroFmt(t.id)}. El panel público ya está actualizado.`)],
            flags: ui.V2,
            allowedMentions: { parse: [] }
        });
    }

    async liberar(interaction, canalId) {
        const t = this.db.data.activos[canalId];
        if (!t) return this.avisarTicketAusente(interaction);

        const esQuienLoTiene = t.reclamadoPor === interaction.user.id;
        if (!esQuienLoTiene && !permisos.puede(interaction.member, 'cierreForzado')) {
            return interaction.reply({
                components: [ui.error(this.emojis, 'Solo quien lo tiene reclamado puede liberarlo.')],
                flags: ui.V2_EFIMERO
            });
        }

        t.reclamadoPor = null;
        t.reclamadoEn = null;
        this.db.save();
        this.registrarAccion(t, 'Ticket liberado', interaction.user);

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await this.refrescarMensaje(t);
        await interaction.editReply({
            components: [ui.exito(this.emojis, `Has liberado el ticket #${this.numeroFmt(t.id)}.`)],
            flags: ui.V2
        });
    }

    // --------------------------------------------------------------- cierre

    async pedirCierre(interaction, canalId) {
        const t = this.db.data.activos[canalId];
        if (!t) return this.avisarTicketAusente(interaction);

        const esAutor = t.userId === interaction.user.id;
        if (!esAutor && !permisos.puede(interaction.member, 'cerrar')) {
            return interaction.reply({
                components: [ui.error(this.emojis, 'You do not have permission to close this ticket.')],
                flags: ui.V2_EFIMERO
            });
        }

        const cierre = this.config.ajustes.cierre ?? {};
        if (cierre.pedirMotivo) {
            const motivo = new TextInputBuilder()
                .setCustomId('motivo')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(cierre.motivoObligatorio ?? false)
                .setMaxLength(500);

            const etiqueta = new LabelBuilder()
                .setLabel('Closing reason')
                .setDescription('Summarize the solution or explain why this ticket is being closed.')
                .setTextInputComponent(motivo);

            return interaction.showModal(
                new ModalBuilder()
                    .setCustomId(`ticket:cerrarmodal:${canalId}`)
                    .setTitle(`Close ticket #${this.numeroFmt(t.id)}`)
                    .addLabelComponents(etiqueta)
            );
        }

        // Cierre en dos pasos: un boton que borra un canal sin confirmar es un
        // accidente esperando a pasar.
        await interaction.reply({
            components: [ui.confirmar(this.emojis, {
                titulo: 'Close this ticket',
                descripcion: 'A transcript will be generated before the channel is archived.',
                idConfirmar: `ticket:cerrarok:${canalId}`,
                idCancelar: `ticket:cancelar:${canalId}`,
                peligroso: true,
                etiquetaConfirmar: 'Close ticket',
                etiquetaCancelar: 'Cancel',
                pie: 'A complete transcript is preserved before the channel is archived.'
            })],
            flags: ui.V2_EFIMERO
        });
    }

    async cerrarDesdeModal(interaction, canalId) {
        const t = this.db.data.activos[canalId];
        if (!t) return this.avisarTicketAusente(interaction);

        const esAutor = t.userId === interaction.user.id;
        if (!esAutor && !permisos.puede(interaction.member, 'cerrar')) {
            return interaction.reply({
                components: [ui.error(this.emojis, 'You do not have permission to close this ticket.')],
                flags: ui.V2_EFIMERO
            });
        }

        const motivo = interaction.fields.getTextInputValue('motivo').trim() || null;
        await interaction.reply({
            components: [ui.cargando(this.emojis, 'Generating the transcript and archiving the ticket...')],
            flags: ui.V2_EFIMERO
        });

        const canal = await this.client.channels.fetch(canalId).catch(() => null);
        if (!canal) return;
        await this.cerrar(canal, t, interaction.user.id, motivo);

        return interaction.editReply({
            components: [ui.exito(this.emojis, `Ticket #${this.numeroFmt(t.id)} was closed successfully.`)]
        });
    }

    async cancelarCierre(interaction) {
        await interaction.update({
            components: [ui.info(this.emojis, 'Closing cancelled.')],
            flags: ui.V2
        });
    }

    async confirmarCierre(interaction, canalId) {
        const t = this.db.data.activos[canalId];
        if (!t) return this.avisarTicketAusente(interaction);

        await interaction.update({
            components: [ui.cargando(this.emojis, 'Generating the transcript...')],
            flags: ui.V2
        });

        const canal = await this.client.channels.fetch(canalId).catch(() => null);
        if (!canal) return;

        await this.cerrar(canal, t, interaction.user.id);
    }

    async cerrar(canal, t, cerradoPorId, motivo = null) {
        const { ajustes } = this.config;

        t.estado = 'cerrado';
        t.cerradoEn = Date.now();
        t.cerradoPor = cerradoPorId;
        t.motivoCierre = motivo;

        this.db.data.archivados[t.id] = t;
        delete this.db.data.activos[canal.id];
        this.soltarDeUsuario(t.userId, t.id);
        this.db.flush();
        this.programarRefrescoPanel();

        if (ajustes.transcripciones.activo) {
            await this.enviarTranscripcion(canal, t, cerradoPorId, motivo).catch(error =>
                logger.error('tickets', `Transcripcion de #${this.numeroFmt(t.id)}: ${error.message}`)
            );
        }

        if (ajustes.valoraciones.activo) {
            await this.pedirValoracion(t).catch(() => {});
        }

        logger.ok('tickets', `#${this.numeroFmt(t.id)} cerrado`);
        Promise.resolve(this.client.sistemas?.log?.ticketCerrado?.(t))
            .catch(error => logger.error('tickets', `Log de cierre: ${error.message}`));

        const cierre = ajustes.cierre ?? {};
        if (cierre.archivarCanal && ajustes.categoriaArchivoId) {
            await this.archivarCanal(canal, t).catch(error =>
                logger.error('tickets', `No se pudo archivar #${this.numeroFmt(t.id)}: ${error.message}`)
            );
        } else {
            setTimeout(() => canal.delete().catch(() => {}), SEGUNDOS_ANTES_DE_BORRAR);
        }
    }

    async archivarCanal(canal, t) {
        const categoriaId = this.config.ajustes.categoriaArchivoId;
        await canal.setParent(categoriaId, { lockPermissions: false }).catch(error =>
            logger.warn('tickets', `No se pudo mover #${this.numeroFmt(t.id)} al archivo: ${error.message}`)
        );
        await canal.setName(`cerrado-${this.numeroFmt(t.id)}`).catch(() => {});

        const participantes = [t.userId, ...(t.invitados ?? [])];
        for (const usuarioId of participantes) {
            await canal.permissionOverwrites.edit(usuarioId, {
                ViewChannel: true,
                SendMessages: false,
                AddReactions: false,
                AttachFiles: false,
                ReadMessageHistory: true
            }, { reason: `Ticket #${this.numeroFmt(t.id)} cerrado` });
        }

        await canal.send(this.mensajeArchivado(t));
    }

    mensajeArchivado(t) {
        const cierre = this.config.ajustes.cierre ?? {};
        const acciones = [];

        if (cierre.permitirReabrir) {
            acciones.push(ui.boton(this.emojis, {
                id: `ticket:reabrir:${t.id}`,
                etiqueta: 'Reopen',
                estilo: 'exito',
                emoji: 'actualizar'
            }));
        }
        acciones.push(ui.boton(this.emojis, {
            id: `ticket:eliminar:${t.id}`,
            etiqueta: 'Delete channel',
            estilo: 'peligro',
            emoji: 'eliminar'
        }));

        return {
            components: [ui.panel(this.emojis, {
                emoji: 'cerrar',
                titulo: `Ticket #${this.numeroFmt(t.id)} archived`,
                subtitulo: 'This conversation is locked, but its history remains available.',
                cuerpo: [ui.campos(this.emojis, [
                    { emoji: 'usuario', etiqueta: 'Customer', valor: `<@${t.userId}>` },
                    { emoji: 'reloj', etiqueta: 'Closed', valor: ui.fecha(t.cerradoEn, 'F') },
                    { emoji: 'moderacion', etiqueta: 'Closed by', valor: `<@${t.cerradoPor}>` },
                    t.motivoCierre ? { emoji: 'motivo', etiqueta: 'Reason', valor: ui.plano(t.motivoCierre) } : null
                ])],
                acciones: [ui.fila(...acciones)],
                pie: 'Only authorized staff can reopen or permanently delete this channel.'
            })],
            flags: ui.V2,
            allowedMentions: { parse: [] }
        };
    }

    async reabrir(interaction, ticketId) {
        const t = this.db.data.archivados[ticketId];
        if (!t) return this.avisarTicketAusente(interaction);
        if (!permisos.puede(interaction.member, 'reabrir')) {
            return interaction.reply({
                components: [ui.error(this.emojis, 'No tienes permisos para reabrir tickets.')],
                flags: ui.V2_EFIMERO
            });
        }

        const canal = await this.client.channels.fetch(t.canalId).catch(() => null);
        if (!canal) return this.avisarTicketAusente(interaction);

        await interaction.deferUpdate();
        const categoria = this.config.categorias[t.categoria];
        if (!categoria) {
            return interaction.editReply({
                components: [ui.error(this.emojis, 'La categoria original de este ticket ya no existe en la configuracion.')]
            });
        }
        await canal.setParent(categoria.categoriaId || null, { lockPermissions: false });
        await canal.setName(this.config.ajustes.formatoNombre.replace('{numero}', this.numeroFmt(t.id)));

        for (const usuarioId of [t.userId, ...(t.invitados ?? [])]) {
            await canal.permissionOverwrites.edit(usuarioId, {
                ViewChannel: true,
                SendMessages: true,
                AddReactions: true,
                AttachFiles: true,
                EmbedLinks: true,
                ReadMessageHistory: true
            }, { reason: `Ticket #${this.numeroFmt(t.id)} reabierto` });
        }

        t.estado = 'abierto';
        t.reabiertoEn = Date.now();
        t.reabiertoPor = interaction.user.id;
        t.ultimaActividad = Date.now();
        t.avisadoInactividad = false;
        delete this.db.data.archivados[ticketId];
        this.db.data.activos[canal.id] = t;
        const delUsuario = (this.db.data.porUsuario[t.userId] ??= []);
        if (!delUsuario.includes(t.id)) delUsuario.push(t.id);

        const mensaje = await canal.send({
            ...this.mensajeInicial(t),
            allowedMentions: { users: [t.userId] }
        });
        t.mensajeId = mensaje.id;
        this.db.flush();
        this.programarRefrescoPanel();

        await interaction.editReply({
            components: [ui.exito(this.emojis, `Ticket #${this.numeroFmt(t.id)} reabierto por <@${interaction.user.id}>.`)],
            allowedMentions: { parse: [] }
        });
    }

    async pedirEliminar(interaction, ticketId) {
        const t = this.db.data.archivados[ticketId];
        if (!t) return this.avisarTicketAusente(interaction);
        if (!permisos.puede(interaction.member, 'eliminar')) {
            return interaction.reply({
                components: [ui.error(this.emojis, 'No tienes permisos para eliminar canales archivados.')],
                flags: ui.V2_EFIMERO
            });
        }

        return interaction.reply({
            components: [ui.confirmar(this.emojis, {
                titulo: `Eliminar el canal del ticket #${this.numeroFmt(t.id)}`,
                descripcion: 'La transcripción ya guardada se conserva, pero el canal de Discord desaparecerá.',
                idConfirmar: `ticket:eliminarok:${t.id}`,
                idCancelar: `ticket:cancelar:${t.id}`,
                peligroso: true,
                etiquetaConfirmar: 'Eliminar canal'
            })],
            flags: ui.V2_EFIMERO
        });
    }

    async eliminarCanal(interaction, ticketId) {
        const t = this.db.data.archivados[ticketId];
        if (!t) return this.avisarTicketAusente(interaction);
        if (!permisos.puede(interaction.member, 'eliminar')) {
            return interaction.update({
                components: [ui.error(this.emojis, 'No tienes permisos para eliminar este canal.')],
                flags: ui.V2
            });
        }

        await interaction.update({
            components: [ui.cargando(this.emojis, 'Eliminando el canal archivado...')],
            flags: ui.V2
        });

        t.canalEliminadoEn = Date.now();
        t.canalEliminadoPor = interaction.user.id;
        this.db.flush();

        const canal = interaction.channel;
        const temporizador = setTimeout(() => canal.delete(`Ticket #${this.numeroFmt(t.id)} eliminado por ${interaction.user.tag}`).catch(() => {}), 2000);
        temporizador.unref?.();
    }

    async enviarTranscripcion(canal, t, cerradoPorId, motivo) {
        const nombre = `ticket-${this.numeroFmt(t.id)}.html`;

        const archivo = await createTranscript(canal, {
            limit: -1,
            returnType: 'attachment',
            filename: nombre,
            poweredBy: false
        });

        const cat = this.config.categorias[t.categoria];
        const c = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `## ${this.emojis.get('folder')} Ticket #${this.numeroFmt(t.id)} cerrado\n\n` +
                    `${this.emojis.get(cat.emoji)} **Categoria:** ${cat.nombre}\n` +
                    `${this.emojis.get('user')} **Usuario:** <@${t.userId}>\n` +
                    `${this.emojis.get('hammer')} **Cerrado por:** <@${cerradoPorId}>\n` +
                    `${this.emojis.get('clock')} **Duracion:** ${this.duracion(t.cerradoEn - t.abiertoEn)}` +
                    (t.reclamadoPor ? `\n${this.emojis.get('guardian')} **Atendido por:** <@${t.reclamadoPor}>` : '') +
                    (motivo ? `\n${this.emojis.rol('info')} **Motivo:** ${motivo}` : '')
                )
            )
            .addFileComponents(new FileBuilder().setURL(`attachment://${nombre}`));

        const destino = await this.client.channels
            .fetch(this.config.ajustes.transcripciones.canalId)
            .catch(() => null);

        if (destino) {
            await destino.send({
                components: [c],
                files: [archivo],
                flags: ui.V2,
                allowedMentions: { parse: [] }
            });
        }

        if (this.config.ajustes.transcripciones.enviarAlUsuario) {
            const usuario = await this.client.users.fetch(t.userId).catch(() => null);
            if (usuario) {
                await usuario.send({
                    components: [ui.panel(this.emojis, {
                        emoji: 'transcripcion',
                        titulo: `Your ticket #${this.numeroFmt(t.id)} has been closed`,
                        cuerpo: [ui.texto('A complete copy of the conversation is attached for your records.')],
                        pie: motivo ? `Reason: ${ui.plano(motivo)}` : 'Thank you for contacting our support team.'
                    })],
                    files: [archivo],
                    flags: ui.V2,
                    allowedMentions: { parse: [] }
                }).catch(() => {});
            }
        }
    }

    // ----------------------------------------------------------- valoracion

    async pedirValoracion(t) {
        const usuario = await this.client.users.fetch(t.userId).catch(() => null);
        if (!usuario) return;

        const fila = new ActionRowBuilder().addComponents(
            [1, 2, 3, 4, 5].map(n =>
                ui.conEmoji(
                    new ButtonBuilder()
                        .setCustomId(`ticket:valorar:${t.id}:${n}`)
                        .setLabel(String(n))
                        .setStyle(ButtonStyle.Secondary),
                    this.emojis.get('estrellita')
                )
            )
        );

        const c = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `## ${this.emojis.get('estrellita')} How was your support experience?\n\n` +
                    `> Ticket #${this.numeroFmt(t.id)} is now closed. Your rating helps us improve.`
                )
            )
            .addSeparatorComponents(ui.aire())
            .addActionRowComponents(fila);

        // Muchos usuarios tienen los MD cerrados: eso no puede tumbar el cierre.
        await usuario.send({ components: [c], flags: ui.V2 });
    }

    async registrarValoracion(interaction, ticketId, estrellas) {
        const t = this.db.data.archivados[ticketId];
        if (!t) return this.avisarTicketAusente(interaction);

        if (interaction.user.id !== t.userId || !Number.isInteger(estrellas) || estrellas < 1 || estrellas > 5) {
            return interaction.update({
                components: [ui.error(this.emojis, 'This rating does not belong to your account or is invalid.')],
                flags: ui.V2
            });
        }

        if (t.valoracion) {
            return interaction.update({
                components: [ui.info(this.emojis, 'You have already rated this ticket. Thank you.')],
                flags: ui.V2
            });
        }

        t.valoracion = estrellas;
        this.db.data.valoraciones.push({
            ticketId: t.id,
            userId: t.userId,
            atendidoPor: t.reclamadoPor,
            estrellas,
            fecha: Date.now()
        });
        this.db.save();

        await interaction.update({
            components: [ui.exito(this.emojis, `Thank you for rating your support experience ${estrellas} out of 5.`)],
            flags: ui.V2
        });

        const canalId = this.config.ajustes.valoraciones.canalId;
        if (!canalId) return;

        const destino = await this.client.channels.fetch(canalId).catch(() => null);
        if (!destino) return;

        const estrellasTexto = this.emojis.get('estrellita').repeat(estrellas);
        await destino.send({
            components: [new ContainerBuilder().addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `## ${this.emojis.get('estrellita')} Nueva valoracion\n\n` +
                    `${estrellasTexto} **${estrellas}/5**\n` +
                    `${this.emojis.get('user')} **De:** <@${t.userId}>\n` +
                    (t.reclamadoPor ? `${this.emojis.get('guardian')} **Atendido por:** <@${t.reclamadoPor}>\n` : '') +
                    `-# Ticket #${this.numeroFmt(t.id)} · ${ui.fecha(Date.now(), 'F')}`
                )
            )],
            flags: ui.V2,
            allowedMentions: { parse: [] }
        });
    }

    // ---------------------------------------------------------- respuestas rapidas

    /**
     * Plantillas de respuesta definidas en config/tickets.json > macros.
     *
     * El contenido va en ingles porque lo lee el cliente; el selector, en
     * espanol, porque solo lo ve el equipo.
     */
    async mostrarMacros(interaction, canalId) {
        const t = this.db.data.activos[canalId];
        if (!t) return this.avisarTicketAusente(interaction);
        if (!permisos.puede(interaction.member, 'menuAdmin')) {
            return ui.responderEfimero(interaction, ui.error(this.emojis, 'No tienes permiso para usar las respuestas rápidas.'));
        }

        const macros = (this.config.macros ?? []).slice(0, 25);
        if (!macros.length) {
            return ui.responderEfimero(interaction, ui.info(this.emojis,
                'No hay plantillas definidas. Añádelas en `config/tickets.json` > `macros`.'));
        }

        const selector = new StringSelectMenuBuilder()
            .setCustomId(`ticket:macro:${canalId}`)
            .setPlaceholder('Elige una respuesta rápida')
            .addOptions(macros.map(macro =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(ui.truncar(macro.nombre, 100))
                    .setDescription(ui.truncar(macro.descripcion ?? '', 100))
                    .setValue(macro.id)
            ));

        return ui.responderEfimero(interaction, ui.panel(this.emojis, {
            emoji: 'macro',
            titulo: 'Respuestas rápidas',
            subtitulo: 'Se publicará en el ticket a nombre del equipo.',
            acciones: [new ActionRowBuilder().addComponents(selector)],
            pie: 'Revisa el texto antes de enviarlo: se publica tal cual.'
        }));
    }

    async enviarMacro(interaction, canalId) {
        const t = this.db.data.activos[canalId];
        if (!t) return this.avisarTicketAusente(interaction);
        if (!permisos.puede(interaction.member, 'menuAdmin')) {
            return ui.responderEfimero(interaction, ui.error(this.emojis, 'No tienes permiso para usar las respuestas rápidas.'));
        }

        const macro = (this.config.macros ?? []).find(item => item.id === interaction.values[0]);
        if (!macro) {
            return ui.responderEfimero(interaction, ui.error(this.emojis, 'Esa plantilla ya no existe.'));
        }

        const canal = await this.client.channels.fetch(canalId).catch(() => null);
        if (!canal) return this.avisarTicketAusente(interaction);

        await canal.send({
            components: [ui.panel(this.emojis, {
                emoji: 'info',
                titulo: 'Support update',
                cuerpo: [macro.contenido],
                pie: `Sent by the support team · ${interaction.user.displayName ?? interaction.user.username}`
            })],
            flags: ui.V2,
            allowedMentions: { users: [t.userId] }
        });

        t.ultimaRespuestaStaff = Date.now();
        t.slaAvisadoEn = 0;
        this.db.save();
        this.registrarAccion(t, 'Respuesta rápida', interaction.user, macro.nombre);

        return ui.responderEfimero(interaction, ui.exito(this.emojis, `Plantilla «${ui.plano(macro.nombre)}» publicada en el ticket.`));
    }

    // ---------------------------------------------------------------- reparto

    /**
     * Reparto rotatorio del staff.
     *
     * Sin esto, un ticket se queda sin duenio hasta que alguien pulsa Claim, y
     * en la practica los casos incomodos esperan mas. La rotacion recuerda a
     * quien le toco por ultima vez y sigue por el siguiente.
     */
    async asignarPorRotacion(ticket) {
        const { asignacion } = this.config.ajustes;
        if (!asignacion?.activo || !asignacion.rolesId?.length) return null;

        const guild = this.client.guilds.cache.get(process.env.GUILD_ID) ?? this.client.guilds.cache.first();
        if (!guild) return null;

        const miembros = await guild.members.fetch().catch(() => null);
        if (!miembros) return null;

        const candidatos = [...miembros.values()]
            .filter(miembro => !miembro.user.bot)
            .filter(miembro => asignacion.rolesId.some(rol => miembro.roles.cache.has(rol)))
            .filter(miembro => !asignacion.excluirAusentes
                || !['idle', 'dnd', 'offline'].includes(miembro.presence?.status ?? 'offline')
                || !miembro.presence)
            .sort((a, b) => a.id.localeCompare(b.id));

        if (!candidatos.length) return null;

        const indice = (this.db.data.ultimoAsignado ?? -1) + 1;
        const elegido = candidatos[indice % candidatos.length];
        this.db.data.ultimoAsignado = indice % candidatos.length;

        ticket.reclamadoPor = elegido.id;
        ticket.reclamadoEn = Date.now();
        ticket.asignadoAutomaticamente = true;
        this.db.save();

        if (asignacion.avisarPorMd) {
            await elegido.send({
                components: [ui.panel(this.emojis, {
                    emoji: 'ticketAbierto',
                    titulo: `Te han asignado el ticket #${this.numeroFmt(ticket.id)}`,
                    cuerpo: [ui.campos(this.emojis, [
                        { emoji: 'usuario', etiqueta: 'Cliente', valor: `<@${ticket.userId}>` },
                        { emoji: 'catalogo', etiqueta: 'Categoría', valor: this.config.categorias[ticket.categoria]?.nombre ?? ticket.categoria }
                    ])],
                    acciones: [ui.fila(ui.boton(this.emojis, {
                        url: `https://discord.com/channels/${guild.id}/${ticket.canalId}`,
                        etiqueta: 'Abrir ticket',
                        estilo: 'enlace',
                        emoji: 'enlace'
                    }))],
                    pie: 'Reparto automático por rotación. Puedes liberarlo desde el propio ticket.'
                })],
                flags: ui.V2,
                allowedMentions: { parse: [] }
            }).catch(() => {});
        }

        return elegido;
    }

    // -------------------------------------------------------------------- SLA

    /**
     * Vigilancia de tiempos de respuesta.
     *
     * /ticket-stats ya calculaba el SLA, pero solo cuando alguien se acordaba
     * de mirarlo. Esto avisa al equipo mientras todavia se puede corregir.
     */
    programarSla() {
        const { sla } = this.config.ajustes;
        const intervalo = Math.max(60_000, Number(sla?.intervaloMs) || 300_000);

        this.temporizadorSla = setInterval(() => {
            this.revisarSla().catch(error => logger.traza('tickets:sla', error));
        }, intervalo);
        this.temporizadorSla.unref?.();
    }

    async revisarSla() {
        const { sla } = this.config.ajustes;
        if (!sla?.activo) return;

        const destinoId = sla.canalAvisosId || this.config.ajustes.transcripciones?.canalId;
        if (!destinoId) return;

        const ahora = Date.now();
        const recordar = Number(sla.recordarCadaMs) || 3_600_000;
        const incumplen = [];

        for (const t of Object.values(this.db.data.activos)) {
            if (ahora - (t.slaAvisadoEn ?? 0) < recordar) continue;

            const sinReclamar = !t.reclamadoPor && ahora - t.abiertoEn >= Number(sla.sinReclamarMs || 0);
            const sinRespuesta = t.reclamadoPor
                && ahora - (t.ultimaRespuestaStaff ?? t.abiertoEn) >= Number(sla.sinRespuestaMs || 0);

            if (!sinReclamar && !sinRespuesta) continue;

            t.slaAvisadoEn = ahora;
            incumplen.push({ t, motivo: sinReclamar ? 'sin reclamar' : 'sin respuesta del staff' });
        }

        if (!incumplen.length) return;
        this.db.save();

        const canal = await this.client.channels.fetch(destinoId).catch(() => null);
        if (!canal?.isTextBased?.()) return;

        const lineas = incumplen.slice(0, 15).map(({ t, motivo }) =>
            `- **#${this.numeroFmt(t.id)}** · <#${t.canalId}> · ${motivo} desde ${ui.fecha(t.reclamadoPor ? (t.ultimaRespuestaStaff ?? t.abiertoEn) : t.abiertoEn, 'R')}` +
            `${t.reclamadoPor ? ` · responsable <@${t.reclamadoPor}>` : ''}`
        ).join('\n');

        await canal.send({
            components: [ui.panel(this.emojis, {
                emoji: 'sla',
                titulo: 'Tickets fuera de SLA',
                subtitulo: `${incumplen.length} caso(s) pendientes de atención.`,
                cuerpo: [lineas],
                pie: 'Aviso interno del sistema de tickets. Se repite como mucho una vez por hora y ticket.'
            })],
            flags: ui.V2,
            allowedMentions: { parse: [] }
        }).catch(error => logger.warn('tickets:sla', `No se pudo avisar: ${error.message}`));
    }

    // -------------------------------------------------------------- actividad

    /**
     * Se llama desde messageCreate. Solo cuenta como actividad lo que escribe
     * el autor del ticket: si contara la del staff, un aviso pidiendo datos
     * mantendria el ticket vivo indefinidamente.
     */
    async registrarActividad(mensaje) {
        const t = this.db.data.activos[mensaje.channel.id];
        if (!t) return;

        if (mensaje.author.id === t.userId) {
            t.ultimaActividad = Date.now();
            t.avisadoInactividad = false;
            this.db.save();
        } else {
            // El SLA mide cuanto lleva el cliente esperando: solo se reinicia
            // cuando responde alguien del equipo, no con la actividad del bot.
            t.ultimaRespuestaStaff = Date.now();
            t.slaAvisadoEn = 0;
            this.db.save();
        }

        await this.controlarPing(mensaje, t);
    }

    /** Borra las menciones al staff dentro del ticket, con esperas escaladas. */
    async controlarPing(mensaje, t) {
        const { antiPingStaff } = this.config.ajustes;
        if (!antiPingStaff.activo) return;
        if (mensaje.author.id !== t.userId) return;

        const staff = permisos.rolesStaff();
        const menciona = staff.some(id => mensaje.mentions.roles.has(id));
        if (!menciona) return;

        const previos = this.avisosPing.get(t.canalId) ?? 0;
        const espera = antiPingStaff.esperas[Math.min(previos, antiPingStaff.esperas.length - 1)];
        this.avisosPing.set(t.canalId, previos + 1);

        await mensaje.delete().catch(() => {});

        const aviso = await mensaje.channel.send({
            components: [ui.aviso(this.emojis, `<@${t.userId}>, there is no need to mention the team. We will assist you as soon as possible.`)],
            flags: ui.V2,
            allowedMentions: { users: [t.userId] }
        }).catch(() => null);

        if (aviso) setTimeout(() => aviso.delete().catch(() => {}), espera);
    }

    // -------------------------------------------------------------- autocierre

    programarAutocierre() {
        const { intervaloMs } = this.config.ajustes.autocierre;

        this.temporizador = setInterval(() => {
            this.revisarInactivos().catch(error => logger.traza('tickets', error));
        }, intervaloMs);

        this.temporizador.unref?.();
    }

    async revisarInactivos() {
        const { inactividadMs, avisoMs } = this.config.ajustes.autocierre;
        const ahora = Date.now();

        for (const t of Object.values({ ...this.db.data.activos })) {
            const inactivo = ahora - t.ultimaActividad;

            if (inactivo >= inactividadMs) {
                const canal = await this.client.channels.fetch(t.canalId).catch(() => null);
                if (canal) await this.cerrar(canal, t, this.client.user.id, 'Inactivity');
                continue;
            }

            if (inactivo >= avisoMs && !t.avisadoInactividad) {
                t.avisadoInactividad = true;
                this.db.save();

                const canal = await this.client.channels.fetch(t.canalId).catch(() => null);
                await canal?.send({
                    components: [ui.aviso(this.emojis,
                        `<@${t.userId}>, this ticket will close automatically if there is no reply within ${this.duracion(inactividadMs - avisoMs)}.`
                    )],
                    flags: ui.V2,
                    allowedMentions: { users: [t.userId] }
                }).catch(() => {});
            }
        }
    }

    // ------------------------------------------------------------- auxiliares

    avisarTicketAusente(interaction) {
        return interaction.reply({
            components: [ui.error(this.emojis, 'This ticket no longer exists.')],
            flags: ui.V2_EFIMERO
        });
    }

    abiertosDe(userId) {
        return Object.values(this.db.data.activos).filter(t => t.userId === userId).length;
    }

    ticketDeCanal(canalId) {
        return this.db.data.activos[canalId] ?? null;
    }

    registrarAccion(ticket, accion, actor, detalle = '') {
        Promise.resolve(this.client.sistemas?.log?.ticketAccion?.(ticket, { accion, actor, detalle }))
            .catch(error => logger.warn('tickets', `Log de acción: ${error.message}`));
    }

    bloquearUsuario(userId, motivo, moderadorId) {
        const bloqueo = {
            motivo: String(motivo).trim().slice(0, 500),
            moderadorId,
            fecha: Date.now()
        };
        this.db.data.bloqueados[userId] = bloqueo;
        this.db.save();
        return bloqueo;
    }

    desbloquearUsuario(userId) {
        const bloqueo = this.db.data.bloqueados[userId];
        if (!bloqueo) return null;
        delete this.db.data.bloqueados[userId];
        this.db.save();
        return bloqueo;
    }

    anadirNota(t, contenido, autorId) {
        const nota = {
            id: `n${Date.now().toString(36)}`,
            contenido: String(contenido).trim().slice(0, 1000),
            autorId,
            fecha: Date.now()
        };
        (t.notas ??= []).push(nota);
        this.db.save();
        return nota;
    }

    async renombrarTicket(t, nombre, autor) {
        const canal = await this.client.channels.fetch(t.canalId).catch(() => null);
        if (!canal) return null;

        const slug = String(nombre)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 70);
        if (!slug) return false;

        const final = `ticket-${this.numeroFmt(t.id)}-${slug}`.slice(0, 100);
        await canal.setName(final, `Ticket renombrado por ${autor.tag}`);
        t.nombreCanal = final;
        t.renombradoEn = Date.now();
        t.renombradoPor = autor.id;
        this.db.save();
        return final;
    }

    soltarDeUsuario(userId, numero) {
        const lista = this.db.data.porUsuario[userId];
        if (!lista) return;

        const restantes = lista.filter(n => n !== numero);
        if (restantes.length) this.db.data.porUsuario[userId] = restantes;
        else delete this.db.data.porUsuario[userId];
    }

    numeroFmt(numero) {
        return String(numero).padStart(4, '0');
    }

    duracion(ms) {
        const unidades = [
            ['d', 86400000],
            ['h', 3600000],
            ['m', 60000]
        ];

        const partes = [];
        let resto = ms;

        for (const [sufijo, tamano] of unidades) {
            const cantidad = Math.floor(resto / tamano);
            if (cantidad) {
                partes.push(`${cantidad}${sufijo}`);
                resto -= cantidad * tamano;
            }
        }

        return partes.length ? partes.join(' ') : 'menos de 1m';
    }
}

module.exports = TicketSystem;
