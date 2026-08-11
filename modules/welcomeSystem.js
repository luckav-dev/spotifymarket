'use strict';

const { AttachmentBuilder } = require('discord.js');

const config = require('../utils/config');
const logger = require('../utils/logger');
const tarjeta = require('../utils/tarjeta');
const ui = require('../utils/ui');
const Database = require('../utils/jsonDatabase');

const ESQUEMA = { ultimoHitoPorServidor: {} };

/** Bienvenidas, despedidas, tarjeta dinamica, roles automaticos e hitos. */
class WelcomeSystem {
    constructor(client, emojis) {
        this.client = client;
        this.emojis = emojis;
        this.db = new Database('welcome', ESQUEMA);
    }

    get config() {
        return config.cargar('welcome');
    }

    async iniciar() {
        const { bienvenida, despedida, rolesAutomaticos } = this.config;
        const pendientes = [];

        if (bienvenida?.activo && !bienvenida.canalId) pendientes.push('bienvenida.canalId');
        if (despedida?.activo && !despedida.canalId && !bienvenida?.canalId) pendientes.push('despedida.canalId');
        if (rolesAutomaticos?.activo && !rolesAutomaticos.roles?.length) pendientes.push('rolesAutomaticos.roles');

        if (pendientes.length) {
            logger.warn('welcome', `${pendientes.length} valores sin configurar en config/welcome.json`);
            logger.detalle(pendientes.join(', '));
        }
    }

    interpolar(texto, member) {
        return String(texto ?? '')
            .replaceAll('{usuario}', member.user.username)
            .replaceAll('{mencion}', `<@${member.id}>`)
            .replaceAll('{servidor}', member.guild.name)
            .replaceAll('{miembros}', ui.numero(member.guild.memberCount));
    }

    async canal(id) {
        if (!id) return null;
        const canal = await this.client.channels.fetch(id).catch(() => null);
        return canal?.isTextBased?.() ? canal : null;
    }

    avatarUrl(member, size = 1024) {
        return member.user.displayAvatarURL({ extension: 'png', size, forceStatic: true });
    }

    async generarTarjeta(member, despedida = false) {
        const estilo = this.config.tarjeta ?? {};
        if (!estilo.activa || (despedida && !this.config.despedida?.mostrarTarjeta)) return null;

        const avatarUrl = this.avatarUrl(member);
        const fondo = estilo.usarAvatarComoFondo ? avatarUrl : estilo.fondo;

        const buffer = await tarjeta.generar({
            nombre: member.displayName || member.user.globalName || member.user.username,
            usuario: member.user.username,
            avatarUrl,
            superior: despedida ? 'See you soon' : member.guild.name,
            inferior: despedida
                ? `${ui.numero(member.guild.memberCount)} members in the server`
                : `Member number ${ui.numero(member.guild.memberCount)}`
        }, {
            ...estilo,
            fondo,
            etiqueta: despedida ? 'SEE YOU SOON' : (estilo.etiqueta ?? 'WELCOME')
        });

        if (!buffer) return null;
        const nombre = `${despedida ? 'despedida' : 'bienvenida'}-${member.id}.png`;
        return { archivo: new AttachmentBuilder(buffer, { name: nombre }), nombre };
    }

    botones(member) {
        const botones = [];
        for (const boton of (this.config.bienvenida?.botones ?? []).slice(0, 5)) {
            const url = boton.url?.trim() || (boton.canalId
                ? `https://discord.com/channels/${member.guild.id}/${boton.canalId}`
                : '');
            if (!/^https:\/\/\S+$/i.test(url)) continue;

            botones.push(ui.boton(this.emojis, {
                url,
                etiqueta: boton.etiqueta,
                emoji: boton.emoji,
                estilo: 'enlace'
            }));
        }
        return botones.length ? ui.fila(...botones) : null;
    }

    async construirBienvenida(member, { prueba = false } = {}) {
        const cfg = this.config.bienvenida;
        const imagen = await this.generarTarjeta(member);
        const cuentaNueva = cfg.avisarCuentaNueva
            && Date.now() - member.user.createdTimestamp < cfg.avisarCuentaNuevaMs;

        const cuerpo = [
            ui.texto(this.interpolar(cfg.mensaje, member)),
            ui.campos(this.emojis, [
                { emoji: 'usuario', etiqueta: 'Member', valor: `<@${member.id}> · ${ui.dato(member.user.username)}` },
                { emoji: 'miembros', etiqueta: 'Member count', valor: ui.dato(ui.numero(member.guild.memberCount)) },
                cfg.mostrarEdadCuenta
                    ? { emoji: 'cuenta', etiqueta: 'Account created', valor: ui.fecha(member.user.createdTimestamp) }
                    : null
            ]),
            cuentaNueva
                ? ui.texto(ui.pie(`${this.emojis.rol('aviso')} New account: created less than ${ui.duracion(cfg.avisarCuentaNuevaMs)} ago.`))
                : null,
            imagen ? ui.galeria([`attachment://${imagen.nombre}`], `Welcome card for ${member.user.username}`) : null
        ];

        const fila = this.botones(member);
        const container = ui.panel(this.emojis, {
            emoji: 'bienvenida',
            titulo: this.interpolar(cfg.titulo, member),
            cuerpo,
            acciones: fila ? [fila] : [],
            pie: prueba ? 'Preview: the command author is being used as the example member.' : undefined
        });

        return {
            components: [container],
            files: imagen ? [imagen.archivo] : [],
            flags: ui.V2,
            allowedMentions: cfg.mencionar && !prueba ? { users: [member.id] } : { parse: [] }
        };
    }

    async construirDespedida(member) {
        const cfg = this.config.despedida;
        const imagen = await this.generarTarjeta(member, true);
        const roles = cfg.mostrarRoles
            ? member.roles?.cache?.filter(r => r.id !== member.guild.id).map(r => `<@&${r.id}>`).join(' ')
            : '';

        const cuerpo = [
            ui.texto(this.interpolar(cfg.mensaje, member)),
            ui.campos(this.emojis, [
                { emoji: 'usuario', etiqueta: 'User', valor: ui.dato(member.user.tag) },
                cfg.mostrarTiempoEnServidor && member.joinedTimestamp
                    ? { emoji: 'reloj', etiqueta: 'Joined', valor: ui.fecha(member.joinedTimestamp) }
                    : null,
                { emoji: 'miembros', etiqueta: 'Current members', valor: ui.dato(ui.numero(member.guild.memberCount)) }
            ]),
            roles ? ui.texto(ui.pie(`Roles: ${ui.truncar(roles, 700)}`)) : null,
            imagen ? ui.galeria([`attachment://${imagen.nombre}`], `Farewell card for ${member.user.username}`) : null
        ];

        return {
            components: [ui.panel(this.emojis, {
                emoji: 'salida',
                titulo: 'A member has left',
                cuerpo
            })],
            files: imagen ? [imagen.archivo] : [],
            flags: ui.V2,
            allowedMentions: { parse: [] }
        };
    }

    async darBienvenida(member) {
        const cfg = this.config.bienvenida;
        if (!cfg?.activo || member.user.bot) return;

        await this.asignarRoles(member);

        const destino = await this.canal(cfg.canalId);
        const mensaje = destino
            ? await destino.send(await this.construirBienvenida(member)).catch(error => {
                logger.error('welcome', `No se pudo dar la bienvenida: ${error.message}`);
                return null;
            })
            : null;

        if (mensaje && cfg.borrarTrasMs > 0) {
            const temporizador = setTimeout(() => mensaje.delete().catch(() => {}), cfg.borrarTrasMs);
            temporizador.unref?.();
        }

        await Promise.allSettled([
            this.enviarPrivado(member),
            this.comprobarHito(member)
        ]);
    }

    async despedir(member) {
        const cfg = this.config.despedida;
        if (!cfg?.activo || member.user.bot) return;

        const destino = await this.canal(cfg.canalId || this.config.bienvenida?.canalId);
        if (!destino) return;
        await destino.send(await this.construirDespedida(member)).catch(error =>
            logger.error('welcome', `No se pudo enviar la despedida: ${error.message}`)
        );
    }

    async asignarRoles(member) {
        const cfg = this.config.rolesAutomaticos;
        if (!cfg?.activo) return;

        for (const roleId of cfg.roles ?? []) {
            if (!member.guild.roles.cache.has(roleId)) continue;
            await member.roles.add(roleId, 'Rol automatico de bienvenida').catch(error =>
                logger.warn('welcome', `No se pudo asignar el rol ${roleId}: ${error.message}`)
            );
        }
    }

    async enviarPrivado(member) {
        const cfg = this.config.mensajePrivado;
        if (!cfg?.activo) return;

        const container = ui.panel(this.emojis, {
            emoji: 'bienvenida',
            titulo: this.interpolar(cfg.titulo, member),
            cuerpo: [ui.texto(this.interpolar(cfg.texto, member))]
        });
        await member.send({ components: [container], flags: ui.V2, allowedMentions: { parse: [] } }).catch(() => {});
    }

    async comprobarHito(member) {
        const cfg = this.config.hitos;
        if (!cfg?.activo || !cfg.cada || member.guild.memberCount % cfg.cada !== 0) return;
        if (this.db.data.ultimoHitoPorServidor[member.guild.id] === member.guild.memberCount) return;

        const destino = await this.canal(cfg.canalId || this.config.bienvenida?.canalId);
        if (!destino) return;

        const enviado = await destino.send({
            components: [ui.panel(this.emojis, {
                emoji: 'celebrar',
                titulo: `${ui.numero(member.guild.memberCount)} members`,
                cuerpo: [ui.texto(this.interpolar(cfg.mensaje, member))]
            })],
            flags: ui.V2,
            allowedMentions: { parse: [] }
        }).then(() => true).catch(() => false);

        if (enviado) {
            this.db.data.ultimoHitoPorServidor[member.guild.id] = member.guild.memberCount;
            this.db.save();
        }
    }

    /** Publica una vista previa desde /publish panel:welcome-preview. */
    async publicarPanel(canal, member) {
        return canal.send(await this.construirBienvenida(member, { prueba: true }));
    }
}

module.exports = WelcomeSystem;
