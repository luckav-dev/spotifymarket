'use strict';

/** Consola estructurada sin dependencias y legible también en archivos de log. */
const COLOR_ACTIVO = !process.env.NO_COLOR && process.env.TERM !== 'dumb' && Boolean(process.stdout.isTTY);
const A = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    gris: '\x1b[90m', rojo: '\x1b[31m', verde: '\x1b[32m',
    amarillo: '\x1b[33m', cian: '\x1b[36m', magenta: '\x1b[35m'
};

function c(codigo, texto) {
    return COLOR_ACTIVO ? `${codigo}${texto}${A.reset}` : String(texto);
}

const ANCHO = 72;
const ANCHO_AMBITO = 14;
let inicio = Date.now();
let modo = 'arranque';

const NIVELES = {
    ok: { etiqueta: 'OK', color: A.verde, flujo: 'out' },
    info: { etiqueta: 'INFO', color: A.cian, flujo: 'out' },
    warn: { etiqueta: 'WARN', color: A.amarillo, flujo: 'err' },
    error: { etiqueta: 'ERROR', color: A.rojo, flujo: 'err' },
    debug: { etiqueta: 'DEBUG', color: A.magenta, flujo: 'out' }
};

function hora() {
    return new Date().toLocaleTimeString('es-ES', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    });
}

function emitir(flujo, linea = '') {
    (flujo === 'err' ? process.stderr : process.stdout).write(`${linea}\n`);
}

function borde(caracter = '-') {
    return `  +${caracter.repeat(ANCHO - 2)}+`;
}

function filaCaja(texto = '') {
    const limpio = String(texto).slice(0, ANCHO - 6);
    return `  | ${limpio.padEnd(ANCHO - 5)}|`;
}

function columnaMensaje() {
    return 2 + (modo === 'arranque' ? 0 : 10) + 7 + ANCHO_AMBITO;
}

function lineaNivel(nivel, ambito, mensaje) {
    const n = NIVELES[nivel];
    const tiempo = modo === 'arranque' ? '' : `${c(A.gris, hora())}  `;
    const etiqueta = c(n.color, n.etiqueta.padEnd(5));
    const modulo = c(A.gris, String(ambito).slice(0, ANCHO_AMBITO - 1).padEnd(ANCHO_AMBITO));
    return `  ${tiempo}${etiqueta}  ${modulo}${mensaje}`;
}

const logger = {
    cabecera(titulo, version, subtitulo) {
        inicio = Date.now();
        modo = 'arranque';
        const nombre = String(titulo)
            .replace(/[-_]+/g, ' ')
            .replace(/\b\w/g, letra => letra.toUpperCase());
        emitir('out');
        emitir('out', c(A.verde, borde('=')));
        emitir('out', filaCaja(`${nombre}  v${version}`));
        emitir('out', filaCaja(subtitulo));
        emitir('out', c(A.verde, borde('=')));
        emitir('out', `  ${c(A.bold, 'INICIO')}  ${c(A.gris, 'Validando servicios y recursos de Discord')}`);
        emitir('out');
    },

    paso(ambito, mensaje) {
        emitir('out', lineaNivel('ok', ambito, mensaje));
    },

    detalle(texto) {
        emitir('out', `${' '.repeat(columnaMensaje())}${c(A.gris, `- ${texto}`)}`);
    },

    resumen(filas) {
        const anchoClave = Math.max(10, ...filas.map(([clave]) => String(clave).length));
        emitir('out');
        emitir('out', c(A.gris, borde('-')));
        emitir('out', filaCaja('RESUMEN OPERATIVO'));
        emitir('out', c(A.gris, borde('-')));
        for (const [clave, valor] of filas) {
            emitir('out', filaCaja(`${String(clave).toUpperCase().padEnd(anchoClave)}  ${valor}`));
        }
        emitir('out', c(A.gris, borde('-')));
    },

    listo(texto = 'Bot operativo') {
        const ms = Date.now() - inicio;
        const tiempo = ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
        emitir('out', filaCaja(`${texto} · arranque ${tiempo}`));
        emitir('out', c(A.verde, borde('=')));
        emitir('out');
        modo = 'ejecucion';
    },

    aire() {
        emitir('out');
    },

    traza(ambito, error) {
        logger.error(ambito, error?.message ?? String(error));
        if (!error?.stack) return;
        for (const linea of error.stack.split('\n').slice(1, 7)) {
            emitir('err', `${' '.repeat(columnaMensaje())}${c(A.gris, linea.trim())}`);
        }
    },

    c,
    A
};

for (const [nivel, datos] of Object.entries(NIVELES)) {
    logger[nivel] = (ambito, mensaje) => {
        if (nivel === 'debug' && !process.env.DEBUG) return;
        emitir(datos.flujo, lineaNivel(nivel, ambito, mensaje));
    };
}

module.exports = logger;
