'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const logger = require('./logger');

/**
 * Dibuja la tarjeta de bienvenida y de despedida.
 *
 * Es lo unico del bot que produce pixeles en vez de Components V2, y existe
 * por una razon concreta: sin accent color, un container no puede dar el
 * golpe de vista que da una tarjeta con el avatar dentro. El resto del
 * mensaje sigue siendo V2; la imagen solo es el encabezado.
 *
 * Todo lo ajustable vive en config/welcome.json. Aqui no hay ni un color ni
 * un texto literal que no sea un valor por defecto.
 */

const ANCHO = 1000;
const ALTO = 360;
const RAIZ = path.resolve(__dirname, '..');

/** Fuentes por orden de preferencia. La primera que exista, gana. */
const PILA_FUENTES = [
    'Montserrat',
    'Inter',
    'Poppins',
    'Segoe UI Variable',
    'Segoe UI',
    'Bahnschrift',
    'Trebuchet MS',
    'Verdana',
    'DejaVu Sans',
    'Liberation Sans',
    'Arial',
    'sans-serif'
];

const DIR_FUENTES = path.join(RAIZ, 'assets', 'fuentes');

let fuente = null;

/**
 * Elige la fuente una sola vez.
 *
 * Primero registra lo que haya en assets/fuentes/, para que un despliegue en
 * Linux -donde no existe Segoe UI- pueda traerse la suya sin tocar codigo.
 * Solo despues cae a la pila del sistema.
 */
function elegirFuente() {
    if (fuente) return fuente;

    if (fs.existsSync(DIR_FUENTES)) {
        for (const archivo of fs.readdirSync(DIR_FUENTES)) {
            if (!/\.(ttf|otf|ttc)$/i.test(archivo)) continue;
            try {
                GlobalFonts.registerFromPath(path.join(DIR_FUENTES, archivo));
            } catch (error) {
                logger.warn('tarjeta', `No se pudo registrar la fuente ${archivo}: ${error.message}`);
            }
        }
    }

    const disponibles = new Set(GlobalFonts.families.map(f => f.family));
    const propias = fs.existsSync(DIR_FUENTES)
        ? GlobalFonts.families.map(f => f.family).filter(f => !PILA_FUENTES.includes(f))
        : [];

    fuente = [...propias, ...PILA_FUENTES].find(f => disponibles.has(f)) ?? 'sans-serif';
    return fuente;
}

function fuenteDe(peso, tamano) {
    return `${peso} ${tamano}px "${elegirFuente()}"`;
}

// ------------------------------------------------------------------ dibujado

/** Recorta al circulo indicado todo lo que se dibuje dentro del callback. */
function enCirculo(ctx, x, y, radio, dibujar) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radio, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    dibujar();
    ctx.restore();
}

/**
 * Dibuja una imagen cubriendo el area sin deformarla, recortando el sobrante.
 * Equivale al background-size: cover de CSS.
 */
function cubrir(ctx, imagen, x, y, ancho, alto) {
    const escala = Math.max(ancho / imagen.width, alto / imagen.height);
    const w = imagen.width * escala;
    const h = imagen.height * escala;
    ctx.drawImage(imagen, x + (ancho - w) / 2, y + (alto - h) / 2, w, h);
}

/**
 * Reduce el cuerpo hasta que el texto quepa, y si aun asi no cabe lo corta.
 * Un nombre de Discord puede tener 32 caracteres anchos: sin esto, se sale
 * de la tarjeta.
 */
function textoAjustado(ctx, texto, maxAncho, peso, tamanoInicial, tamanoMinimo) {
    let tamano = tamanoInicial;

    while (tamano > tamanoMinimo) {
        ctx.font = fuenteDe(peso, tamano);
        if (ctx.measureText(texto).width <= maxAncho) return { texto, tamano };
        tamano -= 2;
    }

    ctx.font = fuenteDe(peso, tamano);
    let recortado = texto;
    while (recortado.length > 1 && ctx.measureText(`${recortado}…`).width > maxAncho) {
        recortado = recortado.slice(0, -1);
    }

    return { texto: recortado.length < texto.length ? `${recortado}…` : texto, tamano };
}

/** Carga una imagen de una URL https o de una ruta del disco. Null si falla. */
async function cargar(origen) {
    if (!origen) return null;

    try {
        if (/^https?:\/\//i.test(origen)) {
            const respuesta = await fetch(origen);
            if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
            return await loadImage(Buffer.from(await respuesta.arrayBuffer()));
        }

        const ruta = path.isAbsolute(origen) ? origen : path.join(RAIZ, origen);
        if (!fs.existsSync(ruta)) throw new Error('no existe');
        return await loadImage(ruta);
    } catch (error) {
        logger.warn('tarjeta', `No se pudo cargar la imagen '${origen}': ${error.message}`);
        return null;
    }
}

/** Pinta el fondo: imagen si la hay, degradado si no, y siempre un velo encima. */
async function fondo(ctx, estilo) {
    const imagen = await cargar(estilo.fondo);

    if (imagen) {
        cubrir(ctx, imagen, 0, 0, ANCHO, ALTO);
        if (estilo.desenfoque) {
            // Redibujar con filtro sale mas barato que pasar un blur manual
            // pixel a pixel sobre un lienzo de 1000x360.
            ctx.save();
            ctx.filter = `blur(${estilo.desenfoque}px)`;
            cubrir(ctx, imagen, 0, 0, ANCHO, ALTO);
            ctx.restore();
        }
    } else {
        const grad = ctx.createLinearGradient(0, 0, ANCHO, ALTO);
        grad.addColorStop(0, estilo.degradadoInicio);
        grad.addColorStop(1, estilo.degradadoFin);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, ANCHO, ALTO);
    }

    // Velo: garantiza contraste del texto sea cual sea la imagen de fondo.
    const velo = ctx.createLinearGradient(0, 0, ANCHO, 0);
    velo.addColorStop(0, `rgba(0,0,0,${estilo.velo})`);
    velo.addColorStop(1, `rgba(0,0,0,${Math.max(estilo.velo - 0.25, 0)})`);
    ctx.fillStyle = velo;
    ctx.fillRect(0, 0, ANCHO, ALTO);
}

/** Rejilla de puntos tenue: evita que un degradado plano parezca un error. */
function textura(ctx, color) {
    ctx.save();
    ctx.fillStyle = color;
    for (let y = 18; y < ALTO; y += 26) {
        for (let x = 18; x < ANCHO; x += 26) {
            ctx.beginPath();
            ctx.arc(x, y, 1, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.restore();
}

/** Avatar circular con anillo y sombra. */
function avatar(ctx, imagen, cx, cy, radio, estilo) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 28;
    ctx.beginPath();
    ctx.arc(cx, cy, radio, 0, Math.PI * 2);
    ctx.fillStyle = estilo.borde;
    ctx.fill();
    ctx.restore();

    if (imagen) {
        enCirculo(ctx, cx, cy, radio - 6, () => {
            cubrir(ctx, imagen, cx - radio + 6, cy - radio + 6, (radio - 6) * 2, (radio - 6) * 2);
        });
    }

    ctx.save();
    ctx.strokeStyle = estilo.borde;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, radio - 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
}

/** Pastilla con texto. Para la etiqueta de la esquina. */
function pastilla(ctx, texto, x, y, estilo) {
    ctx.font = fuenteDe(800, 20);
    ctx.letterSpacing = '2px';

    const ancho = ctx.measureText(texto).width + 36;
    const alto = 40;
    const izq = x - ancho;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(izq, y - alto, ancho, alto, 20);
    ctx.fillStyle = estilo.borde;
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = estilo.textoPastilla;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(texto, izq + ancho / 2, y - alto / 2 + 1);

    ctx.letterSpacing = '0px';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
}

// -------------------------------------------------------------------- publico

const ESTILO_POR_DEFECTO = {
    fondo: '',
    desenfoque: 0,
    degradadoInicio: '#1e1b4b',
    degradadoFin: '#0f0f14',
    velo: 0.55,
    borde: '#ffffff',
    texto: '#ffffff',
    textoSuave: '#c9c6d4',
    textoPastilla: '#ffffff',
    etiqueta: 'BIENVENIDO'
};

/**
 * Genera la tarjeta como PNG.
 *
 * Devuelve null si algo falla en vez de lanzar: una tarjeta que no sale no
 * puede impedir que el miembro reciba su mensaje de bienvenida.
 *
 * @param {{ nombre: string, usuario: string, avatarUrl: string,
 *           superior?: string, inferior?: string }} datos
 * @param {object} [estilo]  Sobrescribe ESTILO_POR_DEFECTO.
 * @returns {Promise<Buffer|null>}
 */
async function generar(datos, estilo = {}) {
    const e = { ...ESTILO_POR_DEFECTO, ...estilo };

    try {
        const lienzo = createCanvas(ANCHO, ALTO);
        const ctx = lienzo.getContext('2d');

        await fondo(ctx, e);
        textura(ctx, 'rgba(255,255,255,0.045)');

        const radio = 108;
        const cx = 160;
        const cy = ALTO / 2;
        avatar(ctx, await cargar(datos.avatarUrl), cx, cy, radio, e);

        const x = cx + radio + 52;
        const maxAncho = ANCHO - x - 56;

        // Linea superior: contexto en pequeno, para que el nombre no compita.
        if (datos.superior) {
            ctx.font = fuenteDe(800, 21);
            ctx.letterSpacing = '4px';
            ctx.fillStyle = e.borde;
            ctx.fillText(datos.superior.toUpperCase(), x, cy - 62);
            ctx.letterSpacing = '0px';
        }

        const nombre = textoAjustado(ctx, datos.nombre, maxAncho, 800, 56, 30);
        ctx.font = fuenteDe(800, nombre.tamano);
        ctx.fillStyle = e.texto;
        ctx.fillText(nombre.texto, x, cy - 6);

        if (datos.usuario) {
            const usuario = textoAjustado(ctx, `@${datos.usuario}`, maxAncho, 500, 26, 18);
            ctx.font = fuenteDe(500, usuario.tamano);
            ctx.fillStyle = e.textoSuave;
            ctx.fillText(usuario.texto, x, cy + 30);
        }

        if (datos.inferior) {
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.18)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, cy + 52);
            ctx.lineTo(x + Math.min(maxAncho, 360), cy + 52);
            ctx.stroke();
            ctx.restore();

            const inferior = textoAjustado(ctx, datos.inferior, maxAncho, 600, 23, 16);
            ctx.font = fuenteDe(600, inferior.tamano);
            ctx.fillStyle = e.textoSuave;
            ctx.fillText(inferior.texto, x, cy + 84);
        }

        if (e.etiqueta) pastilla(ctx, e.etiqueta, ANCHO - 40, ALTO - 28, e);

        return lienzo.toBuffer('image/png');
    } catch (error) {
        logger.error('tarjeta', `No se pudo generar la tarjeta: ${error.message}`);
        return null;
    }
}

module.exports = { generar, ANCHO, ALTO, ESTILO_POR_DEFECTO };
