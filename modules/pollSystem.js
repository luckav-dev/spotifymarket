'use strict';

const {
    ContainerBuilder,
    TextDisplayBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder
} = require('discord.js');

const config = require('../utils/config');
const logger = require('../utils/logger');
const ui = require('../utils/ui');
const Database = require('../utils/jsonDatabase');

const ESQUEMA = { contador: 0, encuestas: {} };
const INTERVALO_REVISION_MS = 30_000;
const ETIQUETAS = ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'estrellita'];

/**
 * Encuestas de la comunidad.
 *
 * Reutiliza la idea de voto unico por usuario que ya funcionaba en las
 * sugerencias, pero con N opciones en vez de a favor/en contra. El voto se
 * guarda por usuario y no como contador suelto: asi cambiar de opcion es restar
 * de una y sumar a otra, y no hay forma de votar dos veces.
 */
class PollSystem {
    constructor(client, emojis) {
        this.client = client;
        this.emojis = emojis;
        this.db = new Database('encuestas', ESQUEMA);
        this.temporizador = null;
        this.colas = new Map();
    }

    get config() {
        return config.cargar('encuestas');
    }

    iniciar() {
        if (!this.config.activo) return;

        this.temporizador = setInterval(() => {
            this.revisarVencidas().catch(error => logger.traza('encuestas', error));
        }, INTERVALO_REVISION_MS);
        this.temporizador.unref?.();
    }

    detener() {
        if (this.temporizador) clearInterval(this.temporizador);
        this.temporizador = null;
    }

    /**
     * Serializa las operaciones sobre una misma encuesta.
     *
     * Dos votos simultaneos leen y reescriben el mismo objeto: sin cola, el
     * segundo pisa al primero y se pierde un voto.
     */
    async encolar(id, tarea) {
        const anterior = this.colas.get(id) ?? Promise.resolve();
        const actual = anterior.catch(() => {}).then(tarea);
        this.colas.set(id, actual);
        try {
            return await actual;
        } finally {
            if (this.colas.get(id) === actual) this.colas.delete(id);
        }
    }

    recuento(encuesta) {
        const totales = encuesta.opciones.map(() => 0);
        for (const indice of Object.values(encuesta.votos)) {
            if (totales[indice] !== undefined) totales[indice] += 1;
        }
        return totales;
    }

    construir(encuesta) {
        const cerrada = encuesta.estado !== 'activa';
        const totales = this.recuento(encuesta);
        const votos = totales.reduce((n, v) => n + v, 0);
        const mostrar = cerrada || this.config.mostrarResultadosEnVivo;

        const c = new ContainerBuilder();
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ${this.emojis.rol('encuesta')} ${this.config.titulo || 'COMMUNITY POLL'}\n` +
            `## ${ui.plano(encuesta.pregunta)}\n` +
            (encuesta.descripcion ? `> ${ui.plano(encuesta.descripcion)}` : '')
        ));

        c.addSeparatorComponents(ui.linea());

        const lineas = encuesta.opciones.map((opcion, indice) => {
            const cantidad = totales[indice];
            const porcentaje = votos ? Math.round((cantidad / votos) * 100) : 0;
            const icono = this.emojis.get(ETIQUETAS[indice] ?? 'uno');
            const cabecera = `${icono ? `${icono} ` : ''}**${ui.plano(opcion)}**`;

            if (!mostrar) return cabecera;
            return `${cabecera}\n${ui.barra(cantidad, votos || 1, 14)} \`${String(porcentaje).padStart(3)}%\` · ${cantidad} vote(s)`;
        });

        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(lineas.join('\n\n')));

        c.addSeparatorComponents(ui.aire());
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `${this.emojis.rol('miembros')} **Total votes:** ${ui.dato(votos)}\n` +
            `${this.emojis.rol('reloj')} **${cerrada ? 'Closed' : 'Closes'}:** ${ui.fecha(encuesta.terminaEn, 'R')}` +
            (mostrar ? '' : `\n-# Results are revealed when the poll closes.`)
        ));

        if (!cerrada) {
            const selector = new StringSelectMenuBuilder()
                .setCustomId(`encuesta:votar:${encuesta.id}`)
                .setPlaceholder('Choose your answer')
                .addOptions(encuesta.opciones.slice(0, 25).map((opcion, indice) =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(ui.truncar(opcion, 100))
                        .setValue(String(indice))
                ));

            c.addSeparatorComponents(ui.linea());
            c.addActionRowComponents(new ActionRowBuilder().addComponents(selector));
            if (this.config.permitirCambiarVoto) {
                c.addActionRowComponents(ui.fila(ui.boton(this.emojis, {
                    id: `encuesta:retirar:${encuesta.id}`,
                    etiqueta: 'Remove my vote',
                    estilo: 'secundario',
                    emoji: 'cancelar'
                })));
            }
        } else {
            c.addSeparatorComponents(ui.linea());
            c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `${this.emojis.rol('exito')} ${this.config.textoCerrada}`
            ));
        }

        c.addSeparatorComponents(ui.aire());
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `-# Poll #${encuesta.id} · one vote per member · opened by <@${encuesta.autorId}>`
        ));

        return c;
    }

    async refrescar(encuesta) {
        const canal = await this.client.channels.fetch(encuesta.canalId).catch(() => null);
        const mensaje = canal?.isTextBased?.()
            ? await canal.messages.fetch(encuesta.mensajeId).catch(() => null)
            : null;
        if (!mensaje) return null;

        await mensaje.edit({
            components: [this.construir(encuesta)],
            flags: ui.V2,
            allowedMentions: { parse: [] }
        }).catch(() => null);
        return mensaje;
    }

    async crear(canal, { pregunta, descripcion, opciones, duracionMs, autorId }) {
        const id = String(++this.db.data.contador);

        const encuesta = {
            id,
            pregunta: String(pregunta).slice(0, 250),
            descripcion: String(descripcion ?? '').slice(0, 400),
            opciones: opciones.map(opcion => String(opcion).slice(0, 100)),
            votos: {},
            autorId,
            canalId: canal.id,
            mensajeId: '',
            creadaEn: Date.now(),
            terminaEn: Date.now() + duracionMs,
            estado: 'activa'
        };

        const mensaje = await canal.send({
            components: [this.construir(encuesta)],
            flags: ui.V2,
            allowedMentions: { parse: [] }
        });

        encuesta.mensajeId = mensaje.id;
        this.db.data.encuestas[id] = encuesta;
        this.db.flush();

        logger.ok('encuestas', `#${id} creada en #${canal.name} · ${encuesta.opciones.length} opciones`);
        return encuesta;
    }

    async votar(interaction, id) {
        return this.encolar(id, async () => {
            const encuesta = this.db.data.encuestas[id];
            if (!encuesta || encuesta.estado !== 'activa') {
                return ui.responderEfimero(interaction, ui.error(this.emojis, 'This poll is closed.'));
            }

            const eleccion = Number(interaction.values?.[0]);
            if (!Number.isInteger(eleccion) || !encuesta.opciones[eleccion]) {
                return ui.responderEfimero(interaction, ui.error(this.emojis, 'That option is no longer available.'));
            }

            const previo = encuesta.votos[interaction.user.id];
            if (previo === eleccion) {
                return ui.responderEfimero(interaction, ui.info(this.emojis,
                    `You already voted for **${ui.plano(encuesta.opciones[eleccion])}**.`));
            }
            if (previo !== undefined && !this.config.permitirCambiarVoto) {
                return ui.responderEfimero(interaction, ui.aviso(this.emojis, 'You cannot change your vote in this poll.'));
            }

            encuesta.votos[interaction.user.id] = eleccion;
            this.db.save();
            await this.refrescar(encuesta);

            return ui.responderEfimero(interaction, ui.exito(this.emojis,
                previo === undefined
                    ? `Your vote for **${ui.plano(encuesta.opciones[eleccion])}** has been counted.`
                    : `Your vote has been moved to **${ui.plano(encuesta.opciones[eleccion])}**.`));
        });
    }

    async retirar(interaction, id) {
        return this.encolar(id, async () => {
            const encuesta = this.db.data.encuestas[id];
            if (!encuesta || encuesta.estado !== 'activa') {
                return ui.responderEfimero(interaction, ui.error(this.emojis, 'This poll is closed.'));
            }
            if (encuesta.votos[interaction.user.id] === undefined) {
                return ui.responderEfimero(interaction, ui.info(this.emojis, 'You have not voted in this poll.'));
            }

            delete encuesta.votos[interaction.user.id];
            this.db.save();
            await this.refrescar(encuesta);

            return ui.responderEfimero(interaction, ui.exito(this.emojis, 'Your vote has been removed.'));
        });
    }

    async cerrar(encuesta) {
        encuesta.estado = 'cerrada';
        encuesta.cerradaEn = Date.now();
        this.db.flush();
        await this.refrescar(encuesta);

        const totales = this.recuento(encuesta);
        const maximo = Math.max(...totales, 0);
        const ganadoras = encuesta.opciones.filter((_, indice) => totales[indice] === maximo && maximo > 0);

        const canal = await this.client.channels.fetch(encuesta.canalId).catch(() => null);
        if (canal?.isTextBased?.() && maximo > 0) {
            await canal.send({
                components: [ui.panel(this.emojis, {
                    emoji: 'encuesta',
                    titulo: 'Poll results',
                    cuerpo: [
                        `**${ui.plano(encuesta.pregunta)}**`,
                        ganadoras.length > 1
                            ? `${this.emojis.rol('celebrar')} Tie between ${ganadoras.map(o => `**${ui.plano(o)}**`).join(', ')} with ${maximo} vote(s) each.`
                            : `${this.emojis.rol('celebrar')} **${ui.plano(ganadoras[0])}** wins with ${maximo} vote(s).`
                    ],
                    pie: `${Object.keys(encuesta.votos).length} member(s) voted.`
                })],
                flags: ui.V2,
                allowedMentions: { parse: [] }
            }).catch(() => null);
        }

        logger.ok('encuestas', `#${encuesta.id} cerrada · ${Object.keys(encuesta.votos).length} votos`);
        return encuesta;
    }

    async revisarVencidas() {
        const ahora = Date.now();
        for (const encuesta of Object.values(this.db.data.encuestas)) {
            if (encuesta.estado !== 'activa' || encuesta.terminaEn > ahora) continue;
            await this.cerrar(encuesta).catch(error =>
                logger.error('encuestas', `#${encuesta.id} no se pudo cerrar: ${error.message}`));
        }
    }

    async handle(interaction, accion, datos) {
        switch (accion) {
            case 'votar': return this.votar(interaction, datos[0]);
            case 'retirar': return this.retirar(interaction, datos[0]);
            default: return undefined;
        }
    }
}

module.exports = PollSystem;
