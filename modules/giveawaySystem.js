'use strict';

const {
    ContainerBuilder,
    TextDisplayBuilder
} = require('discord.js');

const config = require('../utils/config');
const logger = require('../utils/logger');
const ui = require('../utils/ui');
const Database = require('../utils/jsonDatabase');

const ESQUEMA = { contador: 0, sorteos: {} };

/** Con que frecuencia se comprueba si algun sorteo ha vencido. */
const INTERVALO_REVISION_MS = 30_000;
const MAX_LISTA_PARTICIPANTES = 40;

/**
 * Sorteos con requisitos comprobables.
 *
 * La parte interesante no es repartir un premio, es el filtro: un sorteo
 * abierto a todo el mundo atrae cuentas creadas para la ocasion. Los requisitos
 * (rol, antiguedad en el servidor y haber comprado) se comprueban en el momento
 * de participar y otra vez al sortear, porque entre medias la gente cambia.
 *
 * Lo publico va en ingles; los avisos al staff, en espanol.
 */
class GiveawaySystem {
    constructor(client, emojis) {
        this.client = client;
        this.emojis = emojis;
        this.db = new Database('sorteos', ESQUEMA);
        this.temporizador = null;
    }

    get config() {
        return config.cargar('sorteos');
    }

    iniciar() {
        if (!this.config.activo) return;

        const activos = Object.values(this.db.data.sorteos).filter(s => s.estado === 'activo').length;
        if (activos) logger.detalle(`${activos} sorteo(s) en curso`);

        this.temporizador = setInterval(() => {
            this.revisarVencidos().catch(error => logger.traza('sorteos', error));
        }, INTERVALO_REVISION_MS);
        this.temporizador.unref?.();
    }

    detener() {
        if (this.temporizador) clearInterval(this.temporizador);
        this.temporizador = null;
    }

    // ------------------------------------------------------------- requisitos

    /**
     * @returns {Promise<string|null>} Motivo del rechazo en ingles, o null.
     */
    async motivoRechazo(sorteo, member) {
        const req = sorteo.requisitos ?? {};

        if (req.rolId && !member.roles.cache.has(req.rolId)) {
            return `You need the <@&${req.rolId}> role to enter this giveaway.`;
        }

        if (req.antiguedadMs) {
            const dentro = Date.now() - (member.joinedTimestamp ?? Date.now());
            if (dentro < req.antiguedadMs) {
                return `You need to have been in the server for at least ${ui.duracion(req.antiguedadMs)}.`;
            }
        }

        if (req.soloClientes) {
            const clientes = this.client.sistemas?.sellauth;
            const historial = clientes?.historialDe?.(member.id);
            if (!historial?.compras) {
                return 'This giveaway is only open to customers with a completed purchase.';
            }
        }

        return null;
    }

    textoRequisitos(sorteo) {
        const req = sorteo.requisitos ?? {};
        const lineas = [];

        if (req.rolId) lineas.push(`${this.emojis.rol('rango')} Requires the <@&${req.rolId}> role`);
        if (req.antiguedadMs) lineas.push(`${this.emojis.rol('reloj')} Minimum ${ui.duracion(req.antiguedadMs)} in the server`);
        if (req.soloClientes) lineas.push(`${this.emojis.rol('comprar')} Customers only (verified purchase required)`);

        return lineas.length ? lineas.join('\n') : `${this.emojis.rol('exito')} Open to everyone`;
    }

    // ----------------------------------------------------------------- panel

    construir(sorteo) {
        const terminado = sorteo.estado !== 'activo';
        const c = new ContainerBuilder();

        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ${this.emojis.rol('sorteo')} ${this.config.titulo || 'GIVEAWAY'}\n` +
            `## ${ui.plano(sorteo.premio)}\n` +
            (sorteo.descripcion ? `> ${ui.plano(sorteo.descripcion)}` : '')
        ));

        c.addSeparatorComponents(ui.linea());
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `${this.emojis.rol('celebrar')} **Winners:** ${ui.dato(sorteo.ganadores)}\n` +
            `${this.emojis.rol('miembros')} **Entries:** ${ui.dato(sorteo.participantes.length)}\n` +
            `${this.emojis.rol('reloj')} **${terminado ? 'Ended' : 'Ends'}:** ${ui.fecha(sorteo.terminaEn, 'R')} · ${ui.fecha(sorteo.terminaEn, 'f')}\n` +
            `${this.emojis.rol('usuario')} **Hosted by:** <@${sorteo.autorId}>`
        ));

        c.addSeparatorComponents(ui.aire());
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### ${this.emojis.rol('info')} Requirements\n${this.textoRequisitos(sorteo)}`
        ));

        if (terminado) {
            c.addSeparatorComponents(ui.linea());
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                sorteo.premiados?.length
                    ? `### ${this.emojis.rol('celebrar')} Winners\n${sorteo.premiados.map(id => `- <@${id}>`).join('\n')}`
                    : `### ${this.emojis.rol('aviso')} No valid entries\n${this.config.textoFinalizado}`
            ));
        } else {
            c.addSeparatorComponents(ui.linea());
            c.addActionRowComponents(ui.fila(
                ui.boton(this.emojis, {
                    id: `sorteo:entrar:${sorteo.id}`,
                    etiqueta: this.config.botonParticipar || 'Enter giveaway',
                    estilo: 'exito',
                    emoji: 'sorteo'
                }),
                ui.boton(this.emojis, {
                    id: `sorteo:lista:${sorteo.id}`,
                    etiqueta: this.config.botonParticipantes || 'Participants',
                    estilo: 'secundario',
                    emoji: 'miembros'
                })
            ));
        }

        c.addSeparatorComponents(ui.aire());
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `-# Giveaway #${sorteo.id} · Spotify Market`
        ));

        return c;
    }

    async refrescar(sorteo) {
        const canal = await this.client.channels.fetch(sorteo.canalId).catch(() => null);
        const mensaje = canal?.isTextBased?.()
            ? await canal.messages.fetch(sorteo.mensajeId).catch(() => null)
            : null;
        if (!mensaje) return null;

        await mensaje.edit({
            components: [this.construir(sorteo)],
            flags: ui.V2,
            allowedMentions: { parse: [] }
        }).catch(() => null);
        return mensaje;
    }

    // ------------------------------------------------------------------ ciclo

    async crear(canal, { premio, descripcion, ganadores, duracionMs, requisitos, autorId }) {
        const id = String(++this.db.data.contador);

        const sorteo = {
            id,
            premio: String(premio).slice(0, 200),
            descripcion: String(descripcion ?? '').slice(0, 500),
            ganadores: Math.min(Math.max(Number(ganadores) || 1, 1), Number(this.config.maximoGanadores) || 20),
            terminaEn: Date.now() + duracionMs,
            creadoEn: Date.now(),
            autorId,
            canalId: canal.id,
            mensajeId: '',
            participantes: [],
            premiados: [],
            estado: 'activo',
            requisitos: requisitos ?? {}
        };

        const mensaje = await canal.send({
            components: [this.construir(sorteo)],
            flags: ui.V2,
            allowedMentions: { parse: [] }
        });

        sorteo.mensajeId = mensaje.id;
        this.db.data.sorteos[id] = sorteo;
        this.db.flush();

        logger.ok('sorteos', `#${id} creado en #${canal.name} · ${sorteo.ganadores} ganador(es)`);
        return sorteo;
    }

    async entrar(interaction, id) {
        const sorteo = this.db.data.sorteos[id];
        if (!sorteo || sorteo.estado !== 'activo') {
            return ui.responderEfimero(interaction, ui.error(this.emojis, 'This giveaway is no longer open.'));
        }

        if (sorteo.participantes.includes(interaction.user.id)) {
            // Volver a pulsar retira la participacion: es lo que espera todo el
            // mundo del mismo boton y evita anadir un segundo control.
            sorteo.participantes = sorteo.participantes.filter(participante => participante !== interaction.user.id);
            this.db.save();
            await this.refrescar(sorteo);
            return ui.responderEfimero(interaction, ui.info(this.emojis, 'You have withdrawn from this giveaway.'));
        }

        const rechazo = await this.motivoRechazo(sorteo, interaction.member);
        if (rechazo) return ui.responderEfimero(interaction, ui.aviso(this.emojis, rechazo));

        sorteo.participantes.push(interaction.user.id);
        this.db.save();
        await this.refrescar(sorteo);

        return ui.responderEfimero(interaction, ui.exito(this.emojis,
            `You are in. ${ui.numero(sorteo.participantes.length)} participant(s) so far.\n-# Press the button again to withdraw.`));
    }

    async lista(interaction, id) {
        const sorteo = this.db.data.sorteos[id];
        if (!sorteo) return ui.responderEfimero(interaction, ui.error(this.emojis, 'That giveaway no longer exists.'));

        const visibles = sorteo.participantes.slice(0, MAX_LISTA_PARTICIPANTES);
        const resto = sorteo.participantes.length - visibles.length;

        return ui.responderEfimero(interaction, ui.panel(this.emojis, {
            emoji: 'miembros',
            titulo: 'Participants',
            subtitulo: `${ui.numero(sorteo.participantes.length)} entry/entries for ${ui.plano(sorteo.premio)}.`,
            cuerpo: [visibles.length
                ? visibles.map(participante => `- <@${participante}>`).join('\n') + (resto > 0 ? `\n-# and ${resto} more` : '')
                : 'Nobody has entered yet.'],
            pie: 'Requirements are checked again when the winners are drawn.'
        }));
    }

    /**
     * Sorteo real.
     *
     * Se vuelven a comprobar los requisitos: entre entrar y el sorteo la gente
     * pierde roles o se va del servidor, y premiar a quien ya no cumple es la
     * forma mas rapida de que un sorteo pierda credibilidad.
     */
    async sortear(sorteo, { motivo = 'vencimiento' } = {}) {
        const canal = await this.client.channels.fetch(sorteo.canalId).catch(() => null);
        const guild = canal?.guild;

        const validos = [];
        if (guild) {
            for (const participante of sorteo.participantes) {
                const member = await guild.members.fetch(participante).catch(() => null);
                if (!member) continue;
                if (await this.motivoRechazo(sorteo, member)) continue;
                validos.push(participante);
            }
        }

        // Fisher-Yates: barajar y cortar evita el sesgo de ir sacando al azar
        // con repeticion y luego filtrar duplicados.
        for (let i = validos.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [validos[i], validos[j]] = [validos[j], validos[i]];
        }

        sorteo.premiados = validos.slice(0, sorteo.ganadores);
        sorteo.estado = 'terminado';
        sorteo.terminadoEn = Date.now();
        sorteo.terminadoPor = motivo;
        this.db.flush();

        await this.refrescar(sorteo);

        if (canal?.isTextBased?.() && sorteo.premiados.length) {
            await canal.send({
                components: [ui.panel(this.emojis, {
                    emoji: 'celebrar',
                    titulo: 'We have winners',
                    cuerpo: [
                        `**${ui.plano(sorteo.premio)}**`,
                        sorteo.premiados.map(id => `${this.emojis.rol('celebrar')} <@${id}>`).join('\n')
                    ],
                    pie: 'Open a ticket to claim your prize.'
                })],
                flags: ui.V2,
                allowedMentions: { users: sorteo.premiados }
            }).catch(() => null);
        }

        if (this.config.avisarGanadoresPorMd) {
            for (const ganadorId of sorteo.premiados) {
                const usuario = await this.client.users.fetch(ganadorId).catch(() => null);
                await usuario?.send({
                    components: [ui.panel(this.emojis, {
                        emoji: 'celebrar',
                        titulo: 'You won a giveaway',
                        cuerpo: [`You won **${ui.plano(sorteo.premio)}** at Spotify Market.`],
                        pie: 'Open a support ticket to claim it.'
                    })],
                    flags: ui.V2,
                    allowedMentions: { parse: [] }
                }).catch(() => null);
            }
        }

        logger.ok('sorteos', `#${sorteo.id} sorteado · ${sorteo.premiados.length}/${sorteo.participantes.length} elegibles`);
        return sorteo;
    }

    async revisarVencidos() {
        const ahora = Date.now();
        for (const sorteo of Object.values(this.db.data.sorteos)) {
            if (sorteo.estado !== 'activo' || sorteo.terminaEn > ahora) continue;
            await this.sortear(sorteo).catch(error =>
                logger.error('sorteos', `#${sorteo.id} no se pudo sortear: ${error.message}`));
        }
    }

    async handle(interaction, accion, datos) {
        switch (accion) {
            case 'entrar': return this.entrar(interaction, datos[0]);
            case 'lista': return this.lista(interaction, datos[0]);
            default: return undefined;
        }
    }
}

module.exports = GiveawaySystem;
