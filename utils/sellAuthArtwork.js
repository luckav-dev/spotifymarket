'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const logger = require('./logger');
const media = require('./media');

const RAIZ = path.resolve(__dirname, '..');
const ANCHO = 1200;
const ALTO = 675;
const FUENTE_RUTA = path.join(RAIZ, 'assets', 'fuentes', 'Montserrat-Variable.ttf');
const FONDO_RUTA = path.join(RAIZ, 'assets', 'brand', 'banner.png');
const LOGO_RUTA = path.join(RAIZ, 'assets', 'brand', 'SpotifyMarket.png');

let fuenteRegistrada = false;

function prepararFuente() {
    if (fuenteRegistrada) return;
    fuenteRegistrada = true;
    try {
        if (fs.existsSync(FUENTE_RUTA)) GlobalFonts.registerFromPath(FUENTE_RUTA);
    } catch (error) {
        logger.warn('sellauth:arte', `No se pudo registrar Montserrat: ${error.message}`);
    }
}

function fuente(peso, tamano) {
    prepararFuente();
    return `${peso} ${tamano}px "Montserrat", "Segoe UI", sans-serif`;
}

async function cargarImagen(origen) {
    if (!origen) return null;
    try {
        if (/^https:\/\//i.test(origen)) {
            const controlador = new AbortController();
            const temporizador = setTimeout(() => controlador.abort(), 7000);
            temporizador.unref?.();
            const respuesta = await fetch(origen, { signal: controlador.signal });
            clearTimeout(temporizador);
            if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
            return loadImage(Buffer.from(await respuesta.arrayBuffer()));
        }
        return loadImage(origen);
    } catch (error) {
        logger.warn('sellauth:arte', `No se pudo cargar '${origen}': ${error.message}`);
        return null;
    }
}

function cubrir(ctx, imagen, x, y, ancho, alto) {
    const escala = Math.max(ancho / imagen.width, alto / imagen.height);
    const w = imagen.width * escala;
    const h = imagen.height * escala;
    ctx.drawImage(imagen, x + (ancho - w) / 2, y + (alto - h) / 2, w, h);
}

function contener(ctx, imagen, x, y, ancho, alto) {
    const escala = Math.min(ancho / imagen.width, alto / imagen.height);
    const w = imagen.width * escala;
    const h = imagen.height * escala;
    ctx.drawImage(imagen, x + (ancho - w) / 2, y + (alto - h) / 2, w, h);
}

function redondeado(ctx, x, y, ancho, alto, radio, color) {
    ctx.beginPath();
    ctx.roundRect(x, y, ancho, alto, radio);
    ctx.fillStyle = color;
    ctx.fill();
}

function lineas(ctx, texto, maxAncho, maxLineas = 3) {
    const palabras = String(texto ?? '').trim().split(/\s+/).filter(Boolean);
    const resultado = [];
    let actual = '';

    for (const palabra of palabras) {
        const candidata = actual ? `${actual} ${palabra}` : palabra;
        if (ctx.measureText(candidata).width <= maxAncho) {
            actual = candidata;
            continue;
        }
        if (actual) resultado.push(actual);
        actual = palabra;
        if (resultado.length === maxLineas - 1) break;
    }
    if (actual && resultado.length < maxLineas) resultado.push(actual);

    const consumido = resultado.join(' ').length;
    if (consumido < String(texto).trim().length && resultado.length) {
        let ultima = resultado.at(-1);
        while (ultima.length > 1 && ctx.measureText(`${ultima}...`).width > maxAncho) ultima = ultima.slice(0, -1);
        resultado[resultado.length - 1] = `${ultima.trim()}...`;
    }
    return resultado;
}

function etiqueta(ctx, texto, x, y, color) {
    ctx.font = fuente(800, 21);
    ctx.letterSpacing = '2px';
    const ancho = ctx.measureText(texto).width + 42;
    redondeado(ctx, x, y, ancho, 46, 23, color);
    ctx.fillStyle = '#07110b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(texto, x + ancho / 2, y + 24);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.letterSpacing = '0px';
}

function precio(numero, moneda = 'EUR') {
    try {
        return new Intl.NumberFormat('en-GB', {
            style: 'currency', currency: moneda,
            minimumFractionDigits: 2, maximumFractionDigits: 2
        }).format(Number(numero));
    } catch {
        return `${Number(numero).toFixed(2)} ${moneda}`;
    }
}

/**
 * Genera un arte de producto con datos vivos de SellAuth. La composicion es
 * deliberadamente estable: la imagen cambia, pero la marca y la jerarquia no.
 */
async function generarAviso({ tipo, producto, anterior = null, titulo }) {
    const canvas = createCanvas(ANCHO, ALTO);
    const ctx = canvas.getContext('2d');
    const esRestock = tipo === 'restock';
    const color = esRestock ? '#1ed760' : '#ff9f43';

    const fondo = await cargarImagen(FONDO_RUTA);
    const gradienteBase = ctx.createLinearGradient(0, 0, ANCHO, ALTO);
    gradienteBase.addColorStop(0, '#06100a');
    gradienteBase.addColorStop(1, '#111318');
    ctx.fillStyle = gradienteBase;
    ctx.fillRect(0, 0, ANCHO, ALTO);
    if (fondo) {
        ctx.save();
        ctx.globalAlpha = 0.1;
        ctx.filter = 'blur(5px)';
        cubrir(ctx, fondo, -10, -10, ANCHO + 20, ALTO + 20);
        ctx.restore();
    }

    const velo = ctx.createLinearGradient(0, 0, ANCHO, 0);
    velo.addColorStop(0, 'rgba(3, 8, 5, .98)');
    velo.addColorStop(0.58, 'rgba(4, 9, 6, .94)');
    velo.addColorStop(1, 'rgba(4, 8, 6, .78)');
    ctx.fillStyle = velo;
    ctx.fillRect(0, 0, ANCHO, ALTO);
    const brillo = ctx.createRadialGradient(930, 250, 20, 930, 250, 520);
    brillo.addColorStop(0, esRestock ? 'rgba(30,215,96,.28)' : 'rgba(255,159,67,.28)');
    brillo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = brillo;
    ctx.fillRect(0, 0, ANCHO, ALTO);

    // Columna informativa.
    etiqueta(ctx, String(titulo || (esRestock ? 'PRODUCT RESTOCKED' : 'PRICE UPDATED')).toUpperCase(), 64, 58, color);

    ctx.font = fuente(800, 54);
    ctx.fillStyle = '#ffffff';
    const nombre = lineas(ctx, producto.nombre, 580, 3);
    nombre.forEach((linea, indice) => ctx.fillText(linea, 64, 166 + indice * 62));

    const inicioDatos = 376;
    ctx.font = fuente(600, 22);
    ctx.fillStyle = '#aeb8b1';
    ctx.fillText('SERVICE', 64, inicioDatos);
    ctx.fillText(esRestock ? 'AVAILABLE STOCK' : 'CURRENT PRICE', 64, inicioDatos + 86);

    ctx.font = fuente(700, 29);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(producto.categoria || 'SellAuth catalog').slice(0, 34), 64, inicioDatos + 37);
    ctx.fillText(
        esRestock
            ? (producto.stock < 0 ? 'Available' : String(producto.stock))
            : precio(producto.precio, producto.moneda),
        64,
        inicioDatos + 123
    );

    if (esRestock) {
        ctx.font = fuente(600, 22);
        ctx.fillStyle = '#aeb8b1';
        ctx.fillText('PRICE', 322, inicioDatos + 86);
        ctx.font = fuente(700, 29);
        ctx.fillStyle = color;
        ctx.fillText(precio(producto.precio, producto.moneda), 322, inicioDatos + 123);
    } else if (anterior !== null) {
        ctx.font = fuente(600, 19);
        ctx.fillStyle = '#aeb8b1';
        ctx.fillText(`Previous ${precio(anterior, producto.moneda)}`, 64, inicioDatos + 164);
    }

    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.fillRect(64, 590, 530, 2);
    ctx.font = fuente(600, 18);
    ctx.fillStyle = '#d8ddd9';
    ctx.fillText('SPOTIFY MARKET  /  LIVE SELLAUTH CATALOG', 64, 625);

    // Tarjeta de producto.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.65)';
    ctx.shadowBlur = 38;
    redondeado(ctx, 690, 62, 446, 550, 34, 'rgba(12,15,14,.92)');
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(690, 62, 446, 550, 34);
    ctx.stroke();

    const productoImagen = await cargarImagen(producto.imagen);
    const logo = productoImagen ? null : await cargarImagen(LOGO_RUTA);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(712, 84, 402, 406, 24);
    ctx.clip();
    ctx.fillStyle = '#080b09';
    ctx.fillRect(712, 84, 402, 406);
    if (productoImagen) cubrir(ctx, productoImagen, 712, 84, 402, 406);
    else if (logo) contener(ctx, logo, 742, 105, 342, 364);
    ctx.restore();

    ctx.font = fuente(800, 24);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(producto.nombre).slice(0, 29), 716, 535);
    ctx.font = fuente(600, 18);
    ctx.fillStyle = color;
    ctx.fillText(esRestock ? 'AVAILABLE NOW' : 'PRICE UPDATED NOW', 716, 573);

    return canvas.toBuffer('image/png');
}

function nombreArchivo(tipo, producto) {
    const slug = String(producto.nombre ?? 'product')
        .normalize('NFKD')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase()
        .slice(0, 45) || 'product';
    return `spotify-market-${tipo}-${slug}.png`;
}

module.exports = { generarAviso, nombreArchivo, ANCHO, ALTO, precio, media };
