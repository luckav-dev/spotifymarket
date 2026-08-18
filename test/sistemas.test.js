'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GiveawaySystem = require('../modules/giveawaySystem');
const PollSystem = require('../modules/pollSystem');
const SchedulerSystem = require('../modules/schedulerSystem');
const MaintenanceSystem = require('../modules/maintenanceSystem');
const AutoModSystem = require('../modules/autoModSystem');
const ApiServer = require('../modules/apiServer');

const emojis = { get: () => '', rol: () => '' };
const client = {
    sistemas: {},
    channels: { fetch: async () => null, cache: new Map() },
    users: { fetch: async () => null },
    guilds: { cache: new Map(), fetch: async () => null }
};

function limpiar(...nombres) {
    for (const nombre of nombres) {
        const ruta = path.resolve(__dirname, '..', 'database', `${nombre}.json`);
        if (fs.existsSync(ruta)) fs.unlinkSync(ruta);
    }
}

test('el panel de un sorteo se construye y respeta los requisitos declarados', () => {
    const sistema = new GiveawaySystem(client, emojis);
    const sorteo = {
        id: '1', premio: 'Spotify Premium 12M', descripcion: '', ganadores: 2,
        terminaEn: Date.now() + 3600000, autorId: '1', canalId: '2', mensajeId: '3',
        participantes: ['a', 'b'], premiados: [], estado: 'activo',
        requisitos: { rolId: '123', antiguedadMs: 604800000, soloClientes: true }
    };

    const json = sistema.construir(sorteo).toJSON();
    assert.equal(json.accent_color, undefined);

    const texto = JSON.stringify(json);
    assert.ok(texto.includes('Spotify Premium 12M'));
    assert.ok(texto.includes('sorteo:entrar:1'), 'debe ofrecer el boton de participar mientras esta activo');

    const requisitos = sistema.textoRequisitos(sorteo);
    assert.match(requisitos, /<@&123>/);
    assert.match(requisitos, /Customers only/);
});

test('un sorteo terminado deja de aceptar participantes', () => {
    const sistema = new GiveawaySystem(client, emojis);
    const json = JSON.stringify(sistema.construir({
        id: '9', premio: 'X', ganadores: 1, terminaEn: Date.now(), autorId: '1',
        canalId: '2', mensajeId: '3', participantes: [], premiados: ['ganador'],
        estado: 'terminado', requisitos: {}
    }).toJSON());

    assert.ok(!json.includes('sorteo:entrar:9'), 'no puede quedar el boton de participar');
    assert.ok(json.includes('ganador'));
});

test('el recuento de una encuesta cuenta un voto por usuario, no por pulsacion', () => {
    const sistema = new PollSystem(client, emojis);
    const encuesta = {
        id: '1', pregunta: '?', opciones: ['a', 'b', 'c'],
        votos: { u1: 0, u2: 0, u3: 2 }, estado: 'activa',
        terminaEn: Date.now() + 1000, autorId: '1', canalId: '2', mensajeId: '3'
    };

    assert.deepEqual(sistema.recuento(encuesta), [2, 0, 1]);

    // Cambiar de opcion mueve el voto, no lo duplica.
    encuesta.votos.u1 = 1;
    assert.deepEqual(sistema.recuento(encuesta), [1, 1, 1]);
});

test('el programador rechaza un mensaje con bloques invalidos', () => {
    limpiar('programados');
    const sistema = new SchedulerSystem(client, emojis);

    assert.throws(
        () => sistema.programar({ canalId: '1', bloques: [{ tipo: 'inventado' }], enviarEn: Date.now() + 1000, autorId: '1' }),
        /no es valido/i
    );
    limpiar('programados');
});

test('el programador guarda y cancela un mensaje valido', () => {
    limpiar('programados');
    const sistema = new SchedulerSystem(client, emojis);

    const programado = sistema.programar({
        canalId: '1',
        bloques: [{ tipo: 'titulo', texto: 'Hola', nivel: 2 }, { tipo: 'texto', contenido: 'Cuerpo' }],
        enviarEn: Date.now() + 60000,
        autorId: '1',
        nombre: 'prueba'
    });

    assert.equal(programado.estado, 'pendiente');
    assert.equal(sistema.pendientes().length, 1);

    assert.equal(sistema.cancelar(programado.id).estado, 'cancelado');
    assert.equal(sistema.pendientes().length, 0);
    assert.equal(sistema.cancelar(programado.id), null, 'cancelar dos veces no puede reactivarlo');

    limpiar('programados');
});

test('el mantenimiento no bloquea al staff exento', () => {
    limpiar('mantenimiento');
    const sistema = new MaintenanceSystem(client, emojis);
    sistema.db.data.activo = true;

    const cliente = { id: '1', guild: { ownerId: 'x' }, permissions: { has: () => false }, roles: { cache: new Map() } };
    const admin = { id: '2', guild: { ownerId: '2' }, permissions: { has: () => true }, roles: { cache: new Map() } };

    assert.notEqual(sistema.bloquea(cliente), null, 'un cliente tiene que ver el aviso');
    assert.equal(sistema.bloquea(admin), null, 'el administrador tiene que poder seguir operando');

    sistema.db.data.activo = false;
    assert.equal(sistema.bloquea(cliente), null);
    limpiar('mantenimiento');
});

test('un mantenimiento con fecha vencida se considera terminado', () => {
    limpiar('mantenimiento');
    const sistema = new MaintenanceSystem(client, emojis);
    sistema.db.data.activo = true;
    sistema.db.data.hasta = Date.now() - 1000;

    assert.equal(sistema.activo(), false);
    limpiar('mantenimiento');
});

test('el detector de spam salta solo al superar el umbral en la ventana', () => {
    limpiar('automod');
    const sistema = new AutoModSystem(client, emojis);
    const filtro = { mensajes: 3, ventanaMs: 5000 };
    const mensaje = { author: { id: 'u1' } };

    assert.equal(sistema.esSpam(mensaje, filtro), false);
    assert.equal(sistema.esSpam(mensaje, filtro), false);
    assert.equal(sistema.esSpam(mensaje, filtro), true, 'el tercero dentro de la ventana es spam');
    assert.equal(sistema.esSpam(mensaje, filtro), false, 'el contador se reinicia tras actuar');

    limpiar('automod');
});

test('las diferencias de configuracion se reportan en notacion de puntos', () => {
    const cambios = ApiServer.diferencias(
        { a: 1, anidado: { x: 1, y: 2 }, lista: [1, 2] },
        { a: 1, anidado: { x: 9, y: 2 }, lista: [1, 3], nuevo: true }
    );

    assert.deepEqual(cambios.sort(), ['anidado.x', 'lista', 'nuevo']);
    assert.deepEqual(ApiServer.diferencias({ a: 1 }, { a: 1 }), [], 'sin cambios no hay nada que auditar');
});
