'use strict';

const {
    Events,
    ContainerBuilder,
    TextDisplayBuilder,
    AuditLogEvent,
    escapeMarkdown
} = require('discord.js');

const logger = require('../utils/logger');
const config = require('../utils/config');
const ui = require('../utils/ui');

/** Ventana en la que se atribuye una entrada de auditoria al evento actual. */
const VENTANA_AUDITORIA_MS = 5000;

const MAX_CONTENIDO = 900;

/**
 * Discord suma 4000 caracteres entre todos los TextDisplay de un mensaje.
 * Se deja margen para los separadores y para no rozar el limite.
 */
const LIMITE_LOTE = 3600;

/**
 * Registro de eventos del servidor.
 *
 * Sin accent color, el indicador visual rapido cuando hay cien logs seguidos es
 * el emoji de cabecera: uno distinto por tipo de accion, siempre el mismo para
 * la misma accion.
 */
class LogSystem {
    constructor(client, emojis) {
        this.client = client;
        this.emojis = emojis;
        this.buffers = new Map();
        this.temporizadores = new Map();
    }

    get config() {
        return config.cargar('logs');
    }

    // ---------------------------------------------------------------- destino

    /** Canal donde va una categoria, con 'todos' como respaldo. */
    async canalDe(categoria) {
        const cfg = this.config;
        if (!cfg.activo) return null;

        const id = cfg.modo === 'unificado'
            ? cfg.canales.todos
            : (cfg.canales[categoria] || cfg.canales.todos);

        if (!id) return null;
        return this.client.channels.fetch(id).catch(() => null);
    }

    /** Los filtros se comprueban antes de construir nada. */
    debeIgnorar(canalId, miembro) {
        const { ignorar } = this.config;

        if (canalId && ignorar.canales.includes(canalId)) return true;
        if (ignorar.bots && miembro?.user?.bot) return true;
        if (miembro?.roles?.cache && ignorar.roles.some(r => miembro.roles.cache.has(r))) return true;

        return false;
    }

    /**
     * Envia un bloque de texto a la categoria indicada.
     * Con agrupacion activa, los acumula y vuelca en un solo mensaje: en un
     * servidor con trafico, un mensaje por evento se come el rate limit.
     */
    async enviar(categoria, texto) {
        const { agrupacion } = this.config;

        // Un solo evento ya podria pasarse de largo: se recorta antes de nada.
        const recortado = texto.length > LIMITE_LOTE
            ? `${texto.slice(0, LIMITE_LOTE - 3)}...`
            : texto;

        if (!agrupacion.activo) return this.volcar(categoria, [recortado]);

        const buffer = this.buffers.get(categoria) ?? [];

        // El limite de Discord es de caracteres, no de eventos: agrupar solo
        // por cantidad hace que ocho logs largos tiren el mensaje entero.
        const acumulado = buffer.reduce((total, t) => total + t.length, 0);
        if (buffer.length && acumulado + recortado.length > LIMITE_LOTE) {
            await this.vaciar(categoria);
        }

        const actual = this.buffers.get(categoria) ?? [];
        actual.push(recortado);
        this.buffers.set(categoria, actual);

        if (actual.length >= agrupacion.maximoPorLote) return this.vaciar(categoria);

        if (!this.temporizadores.has(categoria)) {
            const t = setTimeout(() => this.vaciar(categoria), agrupacion.ventanaMs);
            t.unref?.();
            this.temporizadores.set(categoria, t);
        }

        return undefined;
    }

    async vaciar(categoria) {
        const temporizador = this.temporizadores.get(categoria);
        if (temporizador) {
            clearTimeout(temporizador);
            this.temporizadores.delete(categoria);
        }

        const buffer = this.buffers.get(categoria);
        if (!buffer?.length) return;

        this.buffers.delete(categoria);
        await this.volcar(categoria, buffer);
    }

    async volcar(categoria, textos) {
        const canal = await this.canalDe(categoria);
        if (!canal) return;

        const c = new ContainerBuilder();
        textos.forEach((texto, i) => {
            if (i) c.addSeparatorComponents(ui.linea());
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(texto));
        });

        // Sin esto, registrar un mensaje borrado que contenia @everyone lo
        // volveria a disparar.
        await canal.send({
            components: [c],
            flags: ui.V2,
            allowedMentions: { parse: [] }
        }).catch(error => logger.error('logs', `No se pudo escribir en ${categoria}: ${error.message}`));
    }

    /** Los eventos de gateway no dicen quien actuo: se consulta la auditoria. */
    async auditoriaDe(guild, tipo, objetivoId) {
        const registros = await guild.fetchAuditLogs({ type: tipo, limit: 5 }).catch(() => null);
        if (!registros) return null;

        return registros.entries.find(e =>
            String(e.target?.id ?? e.target?.code ?? '') === String(objetivoId) &&
            Date.now() - e.createdTimestamp < VENTANA_AUDITORIA_MS
        ) ?? null;
    }

    async autorDe(guild, tipo, objetivoId) {
        return (await this.auditoriaDe(guild, tipo, objetivoId))?.executor ?? null;
    }

    detalleAuditoria(entrada) {
        if (!entrada) return '';
        const executor = entrada.executor
            ? `${this.emojis.get('hammer')} **Ejecutor:** <@${entrada.executor.id}> · \`${entrada.executor.tag}\`\n`
            : '';
        const reason = entrada.reason
            ? `${this.emojis.get('motivo')} **Motivo de auditoría:** ${ui.plano(ui.truncar(entrada.reason, 500))}\n`
            : `${this.emojis.get('motivo')} **Motivo de auditoría:** no indicado\n`;
        return `${executor}${reason}`;
    }

    detallesMensaje(mensaje) {
        const attachments = [...mensaje.attachments.values()].slice(0, 8).map(file =>
            `- [${ui.plano(file.name || file.id)}](${file.url}) · ${Math.max(1, Math.round((file.size || 0) / 1024))} KB`
        );
        return [
            `${this.emojis.get('files')} **Adjuntos:** ${mensaje.attachments.size}`,
            attachments.length ? attachments.join('\n') : null,
            `${this.emojis.get('monitor')} **Estructura:** ${mensaje.embeds.length} embeds · ${mensaje.components.length} componentes · ${mensaje.stickers.size} stickers`
        ].filter(Boolean).join('\n');
    }

    pie(id) {
        return `-# ${ui.fecha(Date.now(), 'F')}${id ? ` · \`${id}\`` : ''}`;
    }

    cita(texto) {
        const limpio = escapeMarkdown(String(texto)).slice(0, MAX_CONTENIDO);
        return `> ${limpio.replace(/\n/g, '\n> ')}`;
    }

    // ----------------------------------------------------------------- alta

    /** Engancha todos los listeners. Se llama una vez, al arrancar. */
    registrar() {
        const on = (evento, handler) => {
            this.client.on(evento, (...args) => {
                // Un fallo registrando no puede tumbar el evento original.
                Promise.resolve(handler(...args)).catch(error => logger.traza('logs', error));
            });
        };

        on(Events.MessageDelete, m => this.mensajeBorrado(m));
        on(Events.MessageBulkDelete, ms => this.mensajesBorrados(ms));
        on(Events.MessageUpdate, (a, b) => this.mensajeEditado(a, b));
        on(Events.GuildMemberAdd, m => this.miembroEntra(m));
        on(Events.GuildMemberRemove, m => this.miembroSale(m));
        on(Events.GuildMemberUpdate, (a, b) => this.miembroEditado(a, b));
        on(Events.GuildBanAdd, b => this.baneo(b, true));
        on(Events.GuildBanRemove, b => this.baneo(b, false));
        on(Events.ChannelCreate, c => this.canalCreado(c));
        on(Events.ChannelDelete, c => this.canalBorrado(c));
        on(Events.ChannelUpdate, (a, b) => this.canalEditado(a, b));
        on(Events.ThreadCreate, h => this.hilo(h, true));
        on(Events.ThreadDelete, h => this.hilo(h, false));
        on(Events.ThreadUpdate, (a, b) => this.hiloEditado(a, b));
        on(Events.GuildRoleCreate, r => this.rolCreado(r));
        on(Events.GuildRoleDelete, r => this.rolBorrado(r));
        on(Events.GuildRoleUpdate, (a, b) => this.rolEditado(a, b));
        on(Events.VoiceStateUpdate, (a, b) => this.voz(a, b));
        on(Events.GuildUpdate, (a, b) => this.servidorEditado(a, b));
        on(Events.GuildEmojiCreate, e => this.emoji(e, 'creado'));
        on(Events.GuildEmojiDelete, e => this.emoji(e, 'eliminado'));
        on(Events.GuildEmojiUpdate, (a, b) => this.emoji(b, 'actualizado', a));
        on(Events.GuildStickerCreate, s => this.sticker(s, 'creado'));
        on(Events.GuildStickerDelete, s => this.sticker(s, 'eliminado'));
        on(Events.GuildStickerUpdate, (a, b) => this.sticker(b, 'actualizado', a));
        on(Events.GuildScheduledEventCreate, e => this.eventoProgramado(e, 'creado'));
        on(Events.GuildScheduledEventDelete, e => this.eventoProgramado(e, 'eliminado'));
        on(Events.GuildScheduledEventUpdate, (a, b) => this.eventoProgramado(b, 'actualizado', a));
        on(Events.InviteCreate, i => this.invitacion(i, 'creada'));
        on(Events.InviteDelete, i => this.invitacion(i, 'eliminada'));
        on(Events.WebhooksUpdate, c => this.webhooksActualizados(c));
    }

    // ------------------------------------------------------------- mensajes

    async mensajeBorrado(mensaje) {
        if (!mensaje.guild || this.debeIgnorar(mensaje.channel.id, mensaje.member)) return;
        if (!mensaje.author) return;
        const audit = await this.auditoriaDe(mensaje.guild, AuditLogEvent.MessageDelete, mensaje.author.id);

        await this.enviar('mensajes',
            `## ${this.emojis.rol('eliminar')} Mensaje borrado\n\n` +
            `${this.emojis.get('user')} **Autor:** <@${mensaje.author.id}> · \`${mensaje.author.tag}\` · \`${mensaje.author.id}\`\n` +
            `${this.emojis.get('folder')} **Canal:** <#${mensaje.channel.id}> · \`${mensaje.channel.name}\`\n` +
            `${this.emojis.get('calendar')} **Publicado:** ${ui.fecha(mensaje.createdTimestamp, 'F')}\n` +
            `${this.emojis.get('files')} **Mensaje:** \`${mensaje.id}\` · ${mensaje.content?.length ?? 0} caracteres\n` +
            this.detalleAuditoria(audit) +
            (mensaje.content ? `\n**Contenido conservado**\n${this.cita(mensaje.content)}\n` : '\n-# El mensaje no contenía texto o no estaba en caché.\n') +
            `\n${this.detallesMensaje(mensaje)}\n\n${this.pie(mensaje.id)}`
        );
    }

    async mensajesBorrados(mensajes) {
        const primero = mensajes.first();
        if (!primero?.guild || this.debeIgnorar(primero.channel.id, null)) return;

        const authors = new Set(mensajes.map(message => message.author?.id).filter(Boolean));
        const attachments = mensajes.reduce((total, message) => total + message.attachments.size, 0);
        const oldest = Math.min(...mensajes.map(message => message.createdTimestamp || Date.now()));
        const newest = Math.max(...mensajes.map(message => message.createdTimestamp || 0));
        await this.enviar('mensajes',
            `## ${this.emojis.rol('eliminar')} Purga de mensajes\n\n` +
            `${this.emojis.get('folder')} **Canal:** <#${primero.channel.id}> · \`${primero.channel.name}\`\n` +
            `${this.emojis.get('files')} **Cantidad:** ${mensajes.size} mensajes · ${authors.size} autores · ${attachments} adjuntos\n` +
            `${this.emojis.get('clock')} **Rango conservado:** ${ui.fecha(oldest, 'F')} → ${ui.fecha(newest, 'F')}\n\n` +
            this.pie(null)
        );
    }

    async mensajeEditado(antes, despues) {
        if (!despues.guild || despues.author?.bot) return;
        if (antes.content === despues.content) return;
        if (this.debeIgnorar(despues.channel.id, despues.member)) return;

        await this.enviar('mensajes',
            `## ${this.emojis.rol('editar')} Mensaje editado\n\n` +
            `${this.emojis.get('user')} **Autor:** <@${despues.author.id}> · \`${despues.author.tag}\` · \`${despues.author.id}\`\n` +
            `${this.emojis.get('folder')} **Canal:** <#${despues.channel.id}> · \`${despues.channel.name}\`\n` +
            `${this.emojis.get('link')} **Mensaje:** [abrir](${despues.url}) · \`${despues.id}\`\n` +
            `${this.emojis.get('clock')} **Editado:** ${ui.fecha(despues.editedTimestamp ?? Date.now(), 'F')}\n\n` +
            `**Antes**\n${this.cita(antes.content || '(vacio)')}\n\n` +
            `**Despues**\n${this.cita(despues.content || '(vacio)')}\n\n` +
            this.pie(despues.id)
        );
    }

    // ------------------------------------------------------------- miembros

    async miembroEntra(miembro) {
        const edad = Date.now() - miembro.user.createdTimestamp;
        const reciente = edad < 7 * 86400000;
        await this.enviar('miembros',
            `## ${this.emojis.get('boatjoin')} Miembro nuevo\n\n` +
            `${this.emojis.get('user')} **Usuario:** <@${miembro.id}> · \`${miembro.user.tag}\` · \`${miembro.id}\`\n` +
            `${this.emojis.get('calendar')} **Cuenta creada:** ${ui.fecha(miembro.user.createdTimestamp, 'F')} · ${ui.fecha(miembro.user.createdTimestamp, 'R')}\n` +
            `${this.emojis.get('info')} **Perfil:** ${miembro.user.bot ? 'bot/aplicación' : 'persona'} · avatar ${miembro.user.avatar ? 'personalizado' : 'predeterminado'}\n` +
            `${this.emojis.get('warning')} **Revisión:** ${reciente ? 'cuenta con menos de 7 días' : 'sin señal de cuenta reciente'}\n` +
            `${this.emojis.get('people')} **Posición aproximada:** miembro #${miembro.guild.memberCount}\n\n` +
            this.pie(miembro.id)
        );
    }

    async miembroSale(miembro) {
        const roles = miembro.roles?.cache
            ?.filter(r => r.id !== miembro.guild.id)
            .map(r => `<@&${r.id}>`)
            .join(' ');

        const audit = await this.auditoriaDe(miembro.guild, AuditLogEvent.MemberKick, miembro.id);
        const permanencia = miembro.joinedTimestamp ? Date.now() - miembro.joinedTimestamp : null;
        await this.enviar('miembros',
            `## ${this.emojis.get('kick')} Miembro fuera\n\n` +
            `${this.emojis.get('user')} **Usuario:** <@${miembro.id}> · \`${miembro.user.tag}\` · \`${miembro.id}\`\n` +
            (miembro.joinedTimestamp ? `${this.emojis.get('clock')} **Miembro desde:** ${ui.fecha(miembro.joinedTimestamp, 'F')} · permanencia ${ui.duracion(permanencia)}\n` : '') +
            `${this.emojis.get('info')} **Salida detectada:** ${audit ? 'expulsión confirmada por auditoría' : 'salida voluntaria o acción no atribuible'}\n` +
            this.detalleAuditoria(audit) +
            (roles ? `${this.emojis.get('guardian')} **Roles conservados (${miembro.roles.cache.size - 1}):** ${roles}\n` : '') +
            `${this.emojis.get('people')} **Miembros:** ${miembro.guild.memberCount}\n\n` +
            this.pie(miembro.id)
        );
    }

    async miembroEditado(antes, despues) {
        if (despues.user.bot || this.debeIgnorar(null, despues)) return;
        const cambios = [];

        if (antes.nickname !== despues.nickname) {
            cambios.push(`${this.emojis.rol('editar')} **Apodo:** ${ui.dato(antes.nickname || 'sin apodo')} → ${ui.dato(despues.nickname || 'sin apodo')}`);
        }

        const anadidos = despues.roles.cache.filter(rol => !antes.roles.cache.has(rol.id));
        const retirados = antes.roles.cache.filter(rol => !despues.roles.cache.has(rol.id));
        if (anadidos.size) cambios.push(`${this.emojis.rol('anadir')} **Roles añadidos:** ${anadidos.map(r => `<@&${r.id}>`).slice(0, 12).join(' ')}`);
        if (retirados.size) cambios.push(`${this.emojis.rol('eliminar')} **Roles retirados:** ${retirados.map(r => `<@&${r.id}>`).slice(0, 12).join(' ')}`);

        if (antes.communicationDisabledUntilTimestamp !== despues.communicationDisabledUntilTimestamp) {
            cambios.push(`${this.emojis.rol('silenciar')} **Timeout:** ${despues.communicationDisabledUntilTimestamp
                ? `hasta ${ui.fecha(despues.communicationDisabledUntilTimestamp, 'F')}`
                : 'retirado'}`);
        }
        if (antes.pending !== despues.pending) cambios.push(`${this.emojis.rol('verificacion')} **Verificación pendiente:** ${despues.pending ? 'sí' : 'completada'}`);
        if (antes.premiumSinceTimestamp !== despues.premiumSinceTimestamp) {
            cambios.push(`${this.emojis.rol('impulso')} **Booster:** ${despues.premiumSinceTimestamp ? `desde ${ui.fecha(despues.premiumSinceTimestamp, 'F')}` : 'dejó de impulsar el servidor'}`);
        }
        if (!cambios.length) return;

        await this.enviar('miembros',
            `## ${this.emojis.rol('usuario')} Miembro actualizado\n\n` +
            `${this.emojis.rol('usuario')} **Usuario:** <@${despues.id}> · ${ui.dato(despues.user.tag)}\n` +
            `${cambios.join('\n')}\n\n${this.pie(despues.id)}`
        );
    }

    async baneo({ guild, user }, esBaneo) {
        const tipo = esBaneo ? AuditLogEvent.MemberBanAdd : AuditLogEvent.MemberBanRemove;
        const audit = await this.auditoriaDe(guild, tipo, user.id);

        await this.enviar('moderacion',
            `## ${this.emojis.get('ban')} ${esBaneo ? 'Usuario baneado' : 'Baneo retirado'}\n\n` +
            `${this.emojis.get('user')} **Usuario:** <@${user.id}> · \`${user.tag}\`\n` +
            this.detalleAuditoria(audit) +
            `\n${this.pie(user.id)}`
        );
    }

    // -------------------------------------------------------------- servidor

    async canalCreado(canal) {
        if (!canal.guild) return;
        const audit = await this.auditoriaDe(canal.guild, AuditLogEvent.ChannelCreate, canal.id);

        await this.enviar('canales',
            `## ${this.emojis.get('createchannels')} Canal creado\n\n` +
            `${this.emojis.get('folder')} **Canal:** <#${canal.id}> · \`${canal.name}\`\n` +
            `${this.emojis.get('info')} **Tipo:** \`${canal.type}\` · **categoría:** ${canal.parentId ? `<#${canal.parentId}>` : 'ninguna'}\n` +
            `${this.emojis.get('settings')} **Ajustes:** ${canal.nsfw ? 'NSFW · ' : ''}slowmode ${canal.rateLimitPerUser ?? 0}s · ${canal.permissionOverwrites?.cache?.size ?? 0} sobrescrituras\n` +
            this.detalleAuditoria(audit) +
            `\n${this.pie(canal.id)}`
        );
    }

    async canalBorrado(canal) {
        if (!canal.guild) return;
        const audit = await this.auditoriaDe(canal.guild, AuditLogEvent.ChannelDelete, canal.id);

        await this.enviar('canales',
            `## ${this.emojis.rol('eliminar')} Canal borrado\n\n` +
            `${this.emojis.get('folder')} **Canal:** \`${canal.name}\` · \`${canal.id}\`\n` +
            `${this.emojis.get('info')} **Tipo:** \`${canal.type}\` · **categoría anterior:** ${canal.parentId ? `<#${canal.parentId}>` : 'ninguna'}\n` +
            `${this.emojis.get('settings')} **Estado conservado:** ${canal.nsfw ? 'NSFW · ' : ''}slowmode ${canal.rateLimitPerUser ?? 0}s · ${canal.permissionOverwrites?.cache?.size ?? 0} sobrescrituras\n` +
            this.detalleAuditoria(audit) +
            `\n${this.pie(canal.id)}`
        );
    }

    async canalEditado(antes, despues) {
        if (!despues.guild) return;
        const cambios = [];
        if (antes.name !== despues.name) cambios.push(`**Nombre:** ${ui.dato(antes.name)} → ${ui.dato(despues.name)}`);
        if (antes.parentId !== despues.parentId) cambios.push(`**Categoria:** ${antes.parentId ? `<#${antes.parentId}>` : 'ninguna'} → ${despues.parentId ? `<#${despues.parentId}>` : 'ninguna'}`);
        if (antes.rateLimitPerUser !== despues.rateLimitPerUser) cambios.push(`**Modo lento:** ${antes.rateLimitPerUser || 0}s → ${despues.rateLimitPerUser || 0}s`);
        if (antes.nsfw !== despues.nsfw) cambios.push(`**NSFW:** ${despues.nsfw ? 'activado' : 'desactivado'}`);
        if (antes.topic !== despues.topic) cambios.push(`**Tema:** ${this.cita(despues.topic || '(vacio)')}`);
        if (!cambios.length) return;

        if (antes.permissionOverwrites?.cache?.size !== despues.permissionOverwrites?.cache?.size) {
            cambios.push(`**Sobrescrituras:** ${antes.permissionOverwrites?.cache?.size ?? 0} → ${despues.permissionOverwrites?.cache?.size ?? 0}`);
        }
        const audit = await this.auditoriaDe(despues.guild, AuditLogEvent.ChannelUpdate, despues.id);
        await this.enviar('canales',
            `## ${this.emojis.rol('editar')} Canal actualizado\n\n` +
            `${this.emojis.rol('canal')} **Canal:** <#${despues.id}>\n` +
            this.detalleAuditoria(audit) +
            `${cambios.join('\n')}\n\n${this.pie(despues.id)}`
        );
    }

    async hilo(hilo, creado) {
        if (!hilo.guild) return;
        await this.enviar('canales',
            `## ${this.emojis.rol(creado ? 'anadir' : 'eliminar')} Hilo ${creado ? 'creado' : 'eliminado'}\n\n` +
            `${this.emojis.rol('canal')} **Hilo:** ${creado ? `<#${hilo.id}>` : ui.dato(hilo.name)}\n` +
            `${this.emojis.rol('folder')} **Canal principal:** ${hilo.parentId ? `<#${hilo.parentId}>` : 'No disponible'}\n\n` +
            this.pie(hilo.id)
        );
    }

    async hiloEditado(antes, despues) {
        const cambios = [];
        if (antes.name !== despues.name) cambios.push(`**Nombre:** ${ui.dato(antes.name)} → ${ui.dato(despues.name)}`);
        if (antes.archived !== despues.archived) cambios.push(`**Archivado:** ${despues.archived ? 'sí' : 'no'}`);
        if (antes.locked !== despues.locked) cambios.push(`**Bloqueado:** ${despues.locked ? 'sí' : 'no'}`);
        if (antes.rateLimitPerUser !== despues.rateLimitPerUser) cambios.push(`**Modo lento:** ${antes.rateLimitPerUser ?? 0}s → ${despues.rateLimitPerUser ?? 0}s`);
        if (antes.autoArchiveDuration !== despues.autoArchiveDuration) cambios.push(`**Autoarchivo:** ${antes.autoArchiveDuration ?? 0} min → ${despues.autoArchiveDuration ?? 0} min`);
        if (!cambios.length) return;
        const audit = await this.auditoriaDe(despues.guild, AuditLogEvent.ThreadUpdate, despues.id);
        await this.enviar('canales',
            `## ${this.emojis.rol('editar')} Hilo actualizado\n\n` +
            `${this.emojis.rol('canal')} **Hilo:** <#${despues.id}> · \`${despues.id}\`\n` +
            `${this.emojis.rol('folder')} **Canal principal:** ${despues.parentId ? `<#${despues.parentId}>` : 'No disponible'}\n` +
            this.detalleAuditoria(audit) + `${cambios.join('\n')}\n\n${this.pie(despues.id)}`
        );
    }

    async rolCreado(rol) {
        const audit = await this.auditoriaDe(rol.guild, AuditLogEvent.RoleCreate, rol.id);

        await this.enviar('roles',
            `## ${this.emojis.rol('anadir')} Rol creado\n\n` +
            `${this.emojis.get('guardian')} **Rol:** <@&${rol.id}> · \`${rol.name}\`\n` +
            `${this.emojis.get('settings')} **Posición:** ${rol.position} · **permisos:** ${rol.permissions.toArray().length} · **mencionable:** ${rol.mentionable ? 'sí' : 'no'} · **separado:** ${rol.hoist ? 'sí' : 'no'}\n` +
            this.detalleAuditoria(audit) +
            `\n${this.pie(rol.id)}`
        );
    }

    async rolBorrado(rol) {
        const audit = await this.auditoriaDe(rol.guild, AuditLogEvent.RoleDelete, rol.id);

        await this.enviar('roles',
            `## ${this.emojis.rol('eliminar')} Rol borrado\n\n` +
            `${this.emojis.get('guardian')} **Rol:** \`${rol.name}\` · \`${rol.id}\`\n` +
            `${this.emojis.get('settings')} **Estado conservado:** posición ${rol.position} · ${rol.permissions.toArray().length} permisos · ${rol.members.size} miembros\n` +
            this.detalleAuditoria(audit) +
            `\n${this.pie(rol.id)}`
        );
    }

    async rolEditado(antes, despues) {
        const cambios = [];
        if (antes.name !== despues.name) cambios.push(`**Nombre:** ${ui.dato(antes.name)} → ${ui.dato(despues.name)}`);
        if (!antes.permissions.equals(despues.permissions)) {
            const before = new Set(antes.permissions.toArray());
            const after = new Set(despues.permissions.toArray());
            const added = [...after].filter(permission => !before.has(permission));
            const removed = [...before].filter(permission => !after.has(permission));
            cambios.push(`**Permisos añadidos:** ${added.length ? added.map(value => `\`${value}\``).join(' · ') : 'ninguno'}`);
            cambios.push(`**Permisos retirados:** ${removed.length ? removed.map(value => `\`${value}\``).join(' · ') : 'ninguno'}`);
        }
        if (antes.hoist !== despues.hoist) cambios.push(`**Separado en la lista:** ${despues.hoist ? 'si' : 'no'}`);
        if (antes.mentionable !== despues.mentionable) cambios.push(`**Mencionable:** ${despues.mentionable ? 'si' : 'no'}`);
        if (!cambios.length) return;

        const audit = await this.auditoriaDe(despues.guild, AuditLogEvent.RoleUpdate, despues.id);

        await this.enviar('roles',
            `## ${this.emojis.rol('editar')} Rol actualizado\n\n` +
            `${this.emojis.get('guardian')} **Rol:** <@&${despues.id}>\n` +
            this.detalleAuditoria(audit) +
            `${cambios.join('\n')}\n\n` +
            this.pie(despues.id)
        );
    }

    async voz(antes, despues) {
        if (despues.member?.user?.bot || this.debeIgnorar(null, despues.member)) return;
        const tracked = ['channelId', 'serverMute', 'serverDeaf', 'selfMute', 'selfDeaf', 'streaming', 'selfVideo'];
        if (tracked.every(key => antes[key] === despues[key])) return;

        let accion;
        if (!antes.channelId && despues.channelId) accion = `entro en <#${despues.channelId}>`;
        else if (antes.channelId && !despues.channelId) accion = `salio de <#${antes.channelId}>`;
        else if (antes.channelId !== despues.channelId) accion = `se movio de <#${antes.channelId}> a <#${despues.channelId}>`;
        else if (antes.serverMute !== despues.serverMute) accion = despues.serverMute ? 'fue silenciado por el servidor' : 'recupero el microfono';
        else if (antes.serverDeaf !== despues.serverDeaf) accion = despues.serverDeaf ? 'fue ensordecido por el servidor' : 'recuperó el audio';
        else if (antes.streaming !== despues.streaming) accion = despues.streaming ? 'inició una transmisión' : 'finalizó la transmisión';
        else if (antes.selfVideo !== despues.selfVideo) accion = despues.selfVideo ? 'activó la cámara' : 'desactivó la cámara';
        else if (antes.selfMute !== despues.selfMute) accion = despues.selfMute ? 'silenció su micrófono' : 'activó su micrófono';
        else accion = despues.selfDeaf ? 'silenció su audio' : 'recuperó su audio';

        await this.enviar('voz',
            `## ${this.emojis.rol('conexion')} Actividad de voz\n\n` +
            `${this.emojis.rol('usuario')} **Usuario:** <@${despues.id}>\n` +
            `${this.emojis.rol('info')} **Acción:** ${accion}\n` +
            `${this.emojis.rol('canal')} **Canal actual:** ${despues.channelId ? `<#${despues.channelId}>` : 'ninguno'}\n` +
            `${this.emojis.rol('settings')} **Estado:** servidor mute ${despues.serverMute ? 'sí' : 'no'} · deaf ${despues.serverDeaf ? 'sí' : 'no'} · stream ${despues.streaming ? 'sí' : 'no'} · vídeo ${despues.selfVideo ? 'sí' : 'no'}\n\n${this.pie(despues.id)}`
        );
    }

    async servidorEditado(antes, despues) {
        const cambios = [];
        if (antes.name !== despues.name) cambios.push(`**Nombre:** ${ui.dato(antes.name)} → ${ui.dato(despues.name)}`);
        if (antes.description !== despues.description) cambios.push('**Descripcion:** modificada');
        if (antes.icon !== despues.icon) cambios.push('**Icono:** modificado');
        if (antes.banner !== despues.banner) cambios.push('**Banner:** modificado');
        if (antes.preferredLocale !== despues.preferredLocale) cambios.push(`**Idioma preferido:** ${antes.preferredLocale} → ${despues.preferredLocale}`);
        if (antes.afkChannelId !== despues.afkChannelId) cambios.push(`**Canal AFK:** ${antes.afkChannelId ? `<#${antes.afkChannelId}>` : 'ninguno'} → ${despues.afkChannelId ? `<#${despues.afkChannelId}>` : 'ninguno'}`);
        if (antes.afkTimeout !== despues.afkTimeout) cambios.push(`**Tiempo AFK:** ${antes.afkTimeout}s → ${despues.afkTimeout}s`);
        if (antes.systemChannelId !== despues.systemChannelId) cambios.push(`**Canal del sistema:** ${antes.systemChannelId ? `<#${antes.systemChannelId}>` : 'ninguno'} → ${despues.systemChannelId ? `<#${despues.systemChannelId}>` : 'ninguno'}`);
        if (antes.verificationLevel !== despues.verificationLevel) cambios.push(`**Nivel de verificacion:** ${antes.verificationLevel} → ${despues.verificationLevel}`);
        if (!cambios.length) return;

        const audit = await this.auditoriaDe(despues, AuditLogEvent.GuildUpdate, despues.id);
        await this.enviar('servidor',
            `## ${this.emojis.rol('servidor')} Servidor actualizado\n\n${this.detalleAuditoria(audit)}${cambios.join('\n')}\n\n${this.pie(despues.id)}`
        );
    }

    async emoji(emoji, accion, anterior = null) {
        const tipos = { creado: AuditLogEvent.EmojiCreate, eliminado: AuditLogEvent.EmojiDelete, actualizado: AuditLogEvent.EmojiUpdate };
        const audit = await this.auditoriaDe(emoji.guild, tipos[accion], emoji.id);
        await this.enviar('servidor',
            `## ${this.emojis.rol(accion === 'eliminado' ? 'eliminar' : accion === 'creado' ? 'anadir' : 'editar')} Emoji ${accion}\n\n` +
            `${this.emojis.get('info')} **Nombre:** ${anterior && anterior.name !== emoji.name ? `\`${anterior.name}\` → \`${emoji.name}\`` : `\`${emoji.name}\``}\n` +
            `${this.emojis.get('files')} **ID:** \`${emoji.id}\` · animado ${emoji.animated ? 'sí' : 'no'} · gestionado ${emoji.managed ? 'sí' : 'no'}\n` +
            this.detalleAuditoria(audit) + `\n${this.pie(emoji.id)}`
        );
    }

    async sticker(sticker, accion, anterior = null) {
        const tipos = { creado: AuditLogEvent.StickerCreate, eliminado: AuditLogEvent.StickerDelete, actualizado: AuditLogEvent.StickerUpdate };
        const audit = await this.auditoriaDe(sticker.guild, tipos[accion], sticker.id);
        await this.enviar('servidor',
            `## ${this.emojis.rol(accion === 'eliminado' ? 'eliminar' : accion === 'creado' ? 'anadir' : 'editar')} Sticker ${accion}\n\n` +
            `${this.emojis.get('info')} **Nombre:** ${anterior && anterior.name !== sticker.name ? `\`${anterior.name}\` → \`${sticker.name}\`` : `\`${sticker.name}\``}\n` +
            `${this.emojis.get('files')} **ID:** \`${sticker.id}\` · formato \`${sticker.format}\` · etiquetas ${ui.dato(sticker.tags || 'ninguna')}\n` +
            (sticker.description ? `${this.emojis.get('info')} **Descripción:** ${ui.plano(sticker.description)}\n` : '') +
            this.detalleAuditoria(audit) + `\n${this.pie(sticker.id)}`
        );
    }

    async eventoProgramado(evento, accion, anterior = null) {
        const cambios = [];
        if (anterior?.name !== evento.name) cambios.push(`**Nombre:** ${anterior ? ui.dato(anterior.name) : 'nuevo'} → ${ui.dato(evento.name)}`);
        if (anterior && anterior.status !== evento.status) cambios.push(`**Estado:** ${anterior.status} → ${evento.status}`);
        if (anterior && anterior.scheduledStartTimestamp !== evento.scheduledStartTimestamp) cambios.push(`**Inicio:** ${ui.fecha(anterior.scheduledStartTimestamp, 'F')} → ${ui.fecha(evento.scheduledStartTimestamp, 'F')}`);
        await this.enviar('servidor',
            `## ${this.emojis.rol('calendar')} Evento programado ${accion}\n\n` +
            `${this.emojis.get('info')} **Evento:** ${ui.dato(evento.name)} · \`${evento.id}\`\n` +
            `${this.emojis.get('calendar')} **Inicio:** ${ui.fecha(evento.scheduledStartTimestamp, 'F')} · **estado:** \`${evento.status}\`\n` +
            `${this.emojis.get('user')} **Creador:** ${evento.creatorId ? `<@${evento.creatorId}>` : 'no disponible'} · **interesados:** ${evento.userCount ?? 0}\n` +
            (cambios.length ? `\n${cambios.join('\n')}\n` : '') +
            `\n${this.pie(evento.id)}`
        );
    }

    async invitacion(invitacion, accion) {
        const auditType = accion === 'creada' ? AuditLogEvent.InviteCreate : AuditLogEvent.InviteDelete;
        const audit = await this.auditoriaDe(invitacion.guild, auditType, invitacion.code);
        const expires = invitacion.expiresTimestamp
            ? ui.fecha(invitacion.expiresTimestamp, 'F')
            : 'sin caducidad';
        await this.enviar('servidor',
            `## ${this.emojis.rol(accion === 'creada' ? 'anadir' : 'eliminar')} Invitación ${accion}\n\n` +
            `${this.emojis.get('link')} **Código:** \`${invitacion.code}\` · **canal:** ${invitacion.channelId ? `<#${invitacion.channelId}>` : 'no disponible'}\n` +
            `${this.emojis.get('user')} **Creador conocido:** ${invitacion.inviterId ? `<@${invitacion.inviterId}> · \`${invitacion.inviterId}\`` : 'no disponible'}\n` +
            `${this.emojis.get('clock')} **Caducidad:** ${expires} · **usos:** ${invitacion.uses ?? 0}/${invitacion.maxUses || '∞'} · **temporal:** ${invitacion.temporary ? 'sí' : 'no'}\n` +
            this.detalleAuditoria(audit) + `\n${this.pie(invitacion.code)}`
        );
    }

    async webhooksActualizados(canal) {
        await this.enviar('servidor',
            `## ${this.emojis.rol('settings')} Webhooks actualizados\n\n` +
            `${this.emojis.get('folder')} **Canal afectado:** <#${canal.id}> · \`${canal.name}\` · \`${canal.id}\`\n` +
            `${this.emojis.get('info')} **Alcance:** se creó, editó o eliminó un webhook; Discord no incluye el objeto exacto en este evento.\n\n` +
            this.pie(canal.id)
        );
    }

    // --------------------------------------------------- llamadas del propio bot

    async ticketAbierto(ticket, usuario) {
        const respuestas = Object.entries(ticket.respuestas ?? {})
            .slice(0, 5)
            .map(([key, value]) => `- **${ui.plano(key)}:** ${ui.plano(ui.truncar(value, 220))}`)
            .join('\n');
        await this.enviar('tickets',
            `## ${this.emojis.get('ticket')} Ticket abierto\n\n` +
            `${this.emojis.get('files')} **Número:** #${String(ticket.id).padStart(4, '0')} · **categoría:** \`${ticket.categoria}\` · **prioridad:** ${ticket.prioridad}\n` +
            `${this.emojis.get('user')} **Cliente:** <@${usuario.id}> · \`${usuario.tag}\` · \`${usuario.id}\`\n` +
            `${this.emojis.get('folder')} **Canal privado:** <#${ticket.canalId}> · \`${ticket.canalId}\`\n` +
            `${this.emojis.get('clock')} **Apertura:** ${ui.fecha(ticket.abiertoEn, 'F')}\n` +
            (respuestas ? `\n**Resumen del formulario**\n${respuestas}\n` : '') +
            `\n${this.pie(ticket.canalId)}`
        );
    }

    async ticketCerrado(ticket) {
        const resolution = ticket.cerradoEn && ticket.abiertoEn ? ticket.cerradoEn - ticket.abiertoEn : 0;
        const claim = ticket.reclamadoEn && ticket.abiertoEn ? ticket.reclamadoEn - ticket.abiertoEn : 0;
        await this.enviar('tickets',
            `## ${this.emojis.get('folder')} Ticket cerrado\n\n` +
            `${this.emojis.get('files')} **Número:** #${String(ticket.id).padStart(4, '0')} · **categoría:** \`${ticket.categoria}\` · **prioridad:** ${ticket.prioridad}\n` +
            `${this.emojis.get('user')} **Cliente:** <@${ticket.userId}> · \`${ticket.userId}\`\n` +
            `${this.emojis.get('hammer')} **Cerrado por:** <@${ticket.cerradoPor}> · **responsable:** ${ticket.reclamadoPor ? `<@${ticket.reclamadoPor}>` : 'sin reclamar'}\n` +
            `${this.emojis.get('clock')} **Tiempos:** primera atención ${claim ? ui.duracion(claim) : 'sin dato'} · resolución ${resolution ? ui.duracion(resolution) : 'sin dato'}\n` +
            `${this.emojis.get('people')} **Colaboración:** ${ticket.invitados?.length ?? 0} invitados · ${ticket.notas?.length ?? 0} notas · ${ticket.notificaciones?.length ?? 0} recordatorios\n` +
            (ticket.motivoCierre ? `${this.emojis.rol('info')} **Motivo:** ${ui.plano(ui.truncar(ticket.motivoCierre, 700))}\n` : `${this.emojis.rol('info')} **Motivo:** no indicado\n`) +
            `\n${this.pie(ticket.canalId)}`
        );
    }

    async ticketNotificado(ticket, staff, nota) {
        await this.enviar('tickets',
            `## ${this.emojis.get('notificacion')} Cliente notificado\n\n` +
            `${this.emojis.get('ticket')} **Ticket:** #${String(ticket.id).padStart(4, '0')} · <#${ticket.canalId}>\n` +
            `${this.emojis.get('user')} **Cliente:** <@${ticket.userId}> · \`${ticket.userId}\`\n` +
            `${this.emojis.get('hammer')} **Enviado por:** <@${staff.id}> · \`${staff.tag}\`\n` +
            `${this.emojis.get('link')} **Entrega:** DM enviado con botón directo al ticket\n` +
            (nota ? `\n**Nota incluida**\n${this.cita(nota)}\n` : '') +
            `\n${this.pie(ticket.canalId)}`
        );
    }

    async ticketAccion(ticket, { accion, actor, detalle = '' }) {
        await this.enviar('tickets',
            `## ${this.emojis.get('settings')} Gestión de ticket\n\n` +
            `${this.emojis.get('ticket')} **Ticket:** #${String(ticket.id).padStart(4, '0')} · <#${ticket.canalId}> · estado \`${ticket.estado}\`\n` +
            `${this.emojis.get('user')} **Cliente:** <@${ticket.userId}> · \`${ticket.userId}\`\n` +
            `${this.emojis.get('hammer')} **Actor:** <@${actor.id}> · \`${actor.tag}\` · \`${actor.id}\`\n` +
            `${this.emojis.get('info')} **Acción:** ${ui.plano(accion)}\n` +
            (detalle ? `${this.emojis.get('files')} **Detalle:** ${ui.plano(ui.truncar(detalle, 700))}\n` : '') +
            `\n${this.pie(ticket.canalId)}`
        );
    }

    /** Registro de una sancion aplicada por un comando del bot. */
    async sancion({ accion, emoji, objetivo, moderador, motivo, extra }) {
        await this.enviar('moderacion',
            `## ${this.emojis.get(emoji)} ${accion}\n\n` +
            `${this.emojis.get('user')} **Usuario:** <@${objetivo.id}> · \`${objetivo.tag}\` · \`${objetivo.id}\`\n` +
            `${this.emojis.get('hammer')} **Moderador:** <@${moderador.id}> · \`${moderador.tag}\` · \`${moderador.id}\`\n` +
            (extra ? `${this.emojis.rol('info')} **${extra.etiqueta}:** ${extra.valor}\n` : '') +
            `${this.emojis.get('motivo')} **Motivo:** ${ui.plano(ui.truncar(motivo, 700))}\n\n` +
            this.pie(objetivo.id)
        );
    }
}

module.exports = LogSystem;
