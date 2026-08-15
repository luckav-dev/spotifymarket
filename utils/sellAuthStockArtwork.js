'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');

const logger = require('./logger');

const RAIZ = path.resolve(__dirname, '..');
const FUENTE_RUTA = path.join(RAIZ, 'assets', 'fuentes', 'Montserrat-Variable.ttf');
const LOGO_RUTA = path.join(RAIZ, 'assets', 'brand', 'SpotifyMarket.png');
const ANCHO = 2048;
const COLUMNAS = 4;
const PRODUCTOS_POR_PAGINA = 12;
const MAX_PAGINAS_DISCORD = 10;
const MAX_IMAGEN_BYTES = 6 * 1024 * 1024;
const RENDERER_VERSION = 'html-chromium-cdp-v6-wide-layout';

let recursosPromise = null;
let chromiumCache = undefined;
let browserPromise = null;

const dormir = ms => new Promise(resolve => setTimeout(resolve, ms));

function escaparHtml(valor) {
    return String(valor ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function dinero(valor, moneda = 'EUR') {
    try {
        return new Intl.NumberFormat('en-GB', {
            style: 'currency',
            currency: String(moneda || 'EUR').toUpperCase(),
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(Number(valor || 0));
    } catch {
        return `${Number(valor || 0).toFixed(2)} ${String(moneda || 'EUR').toUpperCase()}`;
    }
}

function aDataUrl(buffer, mime) {
    return buffer ? `data:${mime};base64,${buffer.toString('base64')}` : '';
}

function dataUrlLocal(ruta, mime) {
    try {
        if (!fs.existsSync(ruta)) return '';
        return aDataUrl(fs.readFileSync(ruta), mime);
    } catch (error) {
        logger.warn('sellauth:stock-html', `No se pudo leer ${path.basename(ruta)}: ${error.message}`);
        return '';
    }
}

function recursosLocales() {
    if (!recursosPromise) {
        recursosPromise = Promise.resolve({
            font: dataUrlLocal(FUENTE_RUTA, 'font/ttf'),
            logo: dataUrlLocal(LOGO_RUTA, 'image/png')
        });
    }
    return recursosPromise;
}

async function descargarImagen(url) {
    if (!/^https:\/\//i.test(String(url || ''))) return '';
    const controlador = new AbortController();
    const timeout = setTimeout(() => controlador.abort(), 7000);
    timeout.unref?.();
    try {
        const respuesta = await fetch(url, {
            signal: controlador.signal,
            headers: { 'User-Agent': 'SpotifyMarketStockBoard/2.0' }
        });
        if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
        const tipo = String(respuesta.headers.get('content-type') || 'image/png').split(';')[0];
        if (!tipo.startsWith('image/')) throw new Error(`tipo ${tipo}`);
        const declarado = Number(respuesta.headers.get('content-length') || 0);
        if (declarado > MAX_IMAGEN_BYTES) throw new Error('imagen demasiado grande');
        const buffer = Buffer.from(await respuesta.arrayBuffer());
        if (buffer.length > MAX_IMAGEN_BYTES) throw new Error('imagen demasiado grande');
        return aDataUrl(buffer, tipo);
    } catch (error) {
        logger.detalle(`Miniatura omitida (${String(url).slice(0, 80)}): ${error.message}`);
        return '';
    } finally {
        clearTimeout(timeout);
    }
}

async function hidratarImagenes(productos, concurrencia = 6) {
    const salida = productos.map(producto => ({ ...producto, imagenData: '' }));
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrencia, Math.max(1, salida.length)) }, async () => {
        while (cursor < salida.length) {
            const indice = cursor++;
            salida[indice].imagenData = await descargarImagen(salida[indice].imagen);
        }
    });
    await Promise.all(workers);
    return salida;
}

function iniciales(nombre) {
    return String(nombre || 'SM').split(/\s+/).filter(Boolean).slice(0, 2)
        .map(parte => parte[0]).join('').toUpperCase().slice(0, 2) || 'SM';
}

function gradienteProducto(producto) {
    const hash = crypto.createHash('sha1').update(String(producto.id || producto.nombre || '')).digest();
    const h1 = Math.round((hash[0] * 360) / 255);
    const h2 = (h1 + 35 + (hash[1] % 70)) % 360;
    return `linear-gradient(135deg,hsl(${h1} 62% 40%),hsl(${h2} 72% 24%))`;
}

function stockBadge(producto, umbral) {
    const stock = Number(producto.stock);
    if (stock < 0) return { clase: 'unlimited', texto: 'Unlimited' };
    if (stock <= umbral) return { clase: 'low', texto: `${stock} left` };
    return { clase: 'normal', texto: `${stock} in stock` };
}

function tarjeta(producto, umbral, logo) {
    const badge = stockBadge(producto, umbral);
    const categoria = String(producto.categoria || 'Catalog').trim() || 'Catalog';
    const imagen = producto.imagenData
        ? `<img src="${producto.imagenData}" alt="" />`
        : logo
            ? `<img class="fallback-logo" src="${logo}" alt="" />`
            : `<span>${escaparHtml(iniciales(producto.nombre))}</span>`;

    return `<article class="product-card">
        <div class="product-head">
            <div class="thumb" style="--fallback:${gradienteProducto(producto)}">${imagen}</div>
            <div class="product-copy">
                <div class="category">${escaparHtml(categoria)}</div>
                <div class="product-name">${escaparHtml(producto.nombre)}</div>
            </div>
        </div>
        <div class="divider"></div>
        <div class="product-meta">
            <div>
                <div class="meta-label">Price</div>
                <div class="price">${escaparHtml(dinero(producto.precio, producto.moneda))}</div>
            </div>
            <div class="stock-badge ${badge.clase}"><span class="badge-dot"></span>${escaparHtml(badge.texto)}</div>
        </div>
    </article>`;
}

function alturaPagina(cantidad) {
    const filas = Math.max(1, Math.ceil(Math.max(1, cantidad) / COLUMNAS));
    return 46 + 182 + 26 + 118 + 26 + (filas * 264) + (Math.max(0, filas - 1) * 22) + 30 + 62;
}

function htmlPagina(productosPagina, contexto) {
    const { todos, pagina, totalPaginas, title, subtitle, lowStockThreshold, updatedAt, font, logo } = contexto;
    const unidades = todos.filter(p => Number(p.stock) > 0).reduce((total, p) => total + Number(p.stock), 0);
    const infinitos = todos.some(p => Number(p.stock) < 0);
    const categorias = new Set(todos.map(p => String(p.categoria || '').trim()).filter(Boolean)).size;
    const cards = productosPagina.length
        ? productosPagina.map(p => tarjeta(p, lowStockThreshold, logo)).join('')
        : `<div class="empty"><strong>Stock is being prepared</strong><span>New availability will appear here automatically.</span></div>`;
    const paginaTexto = totalPaginas > 1 ? `Page ${pagina} / ${totalPaginas}` : 'Live inventory';
    const actualizado = new Date(updatedAt).toLocaleString('en-GB', {
        timeZone: 'Europe/Madrid',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    const alto = alturaPagina(productosPagina.length);

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${ANCHO},initial-scale=1">
<style>
${font ? `@font-face{font-family:Market;src:url('${font}') format('truetype');font-weight:100 900;font-style:normal;font-display:block}` : ''}
:root{--green:#1ed760;--green-2:#12b84d;--text:#f6f8f7;--muted:#a0ada6;--line:rgba(255,255,255,.09);--panel:rgba(8,12,10,.76);--panel-2:rgba(255,255,255,.028);--shadow:0 24px 48px rgba(0,0,0,.24)}
*{box-sizing:border-box}html,body{margin:0;padding:0;width:${ANCHO}px;height:${alto}px;overflow:hidden;background:#040705}body{font-family:Market,Inter,"Segoe UI",Arial,sans-serif;color:var(--text)}
.stock-board{width:${ANCHO}px;height:${alto}px;position:relative;overflow:hidden;background:
radial-gradient(circle at 100% 0,rgba(30,215,96,.16),transparent 28%),
radial-gradient(circle at 0 100%,rgba(30,215,96,.08),transparent 26%),
linear-gradient(145deg,#06110b 0%,#050806 44%,#0a0d0b 100%)}
.stock-board:before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(115deg,rgba(255,255,255,.018),transparent 28%,transparent 72%,rgba(30,215,96,.024))}
.inner{position:relative;height:100%;padding:42px 48px 28px;display:flex;flex-direction:column}
.header{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:30px;align-items:start}
.eyebrow{display:inline-flex;align-items:center;gap:10px;padding:11px 17px;border-radius:999px;border:1px solid rgba(30,215,96,.24);background:rgba(30,215,96,.10);color:#85f6ad;font-size:16px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.eyebrow-dot{width:10px;height:10px;border-radius:50%;background:var(--green);box-shadow:0 0 0 8px rgba(30,215,96,.08)}
.hero-title{font-size:96px;line-height:.94;letter-spacing:-.06em;margin:18px 0 12px;font-weight:900}.hero-title .green{color:var(--green)}
.subtitle{font-size:22px;line-height:1.45;color:var(--muted);max-width:1040px}
.brand{display:flex;align-items:center;gap:18px;padding:18px 20px;border:1px solid var(--line);border-radius:26px;background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.02));min-height:106px;justify-self:end;width:100%;box-shadow:var(--shadow)}
.brand-logo{width:74px;height:74px;border-radius:22px;object-fit:contain;background:rgba(30,215,96,.09);padding:7px}.brand-fallback{width:74px;height:74px;border-radius:22px;display:grid;place-items:center;background:linear-gradient(135deg,#2be873,#0a8f3d);color:#041108;font-weight:950;font-size:38px}.brand small{display:block;color:#7d8a83;font-size:13px;font-weight:750;letter-spacing:.18em;text-transform:uppercase;margin-bottom:6px}.brand strong{font-size:28px;letter-spacing:-.03em}
.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin:28px 0 26px}.stat{border:1px solid var(--line);background:linear-gradient(180deg,rgba(255,255,255,.038),rgba(255,255,255,.02));border-radius:22px;padding:22px 24px;min-height:102px;box-shadow:var(--shadow)}.stat-value{font-size:54px;font-weight:900;letter-spacing:-.06em;line-height:.95;margin-bottom:10px}.stat-label{font-size:13px;color:#85928b;letter-spacing:.18em;text-transform:uppercase;font-weight:800}
.products{display:grid;grid-template-columns:repeat(${COLUMNAS},minmax(0,1fr));gap:22px}.product-card{min-height:264px;border-radius:28px;padding:18px 18px 20px;border:1px solid var(--line);background:radial-gradient(circle at 100% 0,rgba(30,215,96,.09),transparent 34%),linear-gradient(180deg,rgba(12,17,14,.98),rgba(7,10,8,.99));box-shadow:var(--shadow);display:flex;flex-direction:column;justify-content:space-between}.product-head{display:grid;grid-template-columns:96px minmax(0,1fr);gap:18px;align-items:start}.thumb{width:96px;height:96px;border-radius:24px;overflow:hidden;display:grid;place-items:center;background:var(--fallback);border:1px solid rgba(255,255,255,.12);font-size:28px;font-weight:900}.thumb img{width:100%;height:100%;object-fit:cover}.thumb img.fallback-logo{object-fit:contain;padding:12px;background:#090d0a}.category{color:#8e9b94;font-size:12px;line-height:1.2;font-weight:800;letter-spacing:.18em;text-transform:uppercase;margin:7px 0 10px}.product-name{font-size:24px;line-height:1.13;letter-spacing:-.03em;font-weight:850;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.divider{height:1px;background:var(--line);margin:18px 0 16px}.product-meta{display:flex;justify-content:space-between;align-items:flex-end;gap:14px}.meta-label{color:#86938d;font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;margin-bottom:9px}.price{font-size:40px;font-weight:900;letter-spacing:-.05em;line-height:.92}.stock-badge{display:inline-flex;align-items:center;gap:9px;border-radius:999px;padding:12px 15px;font-size:13px;font-weight:850;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}.badge-dot{width:8px;height:8px;border-radius:50%;background:currentColor}.stock-badge.normal{color:#7ef6a8;background:rgba(30,215,96,.11);border:1px solid rgba(30,215,96,.24)}.stock-badge.low{color:#ffc370;background:rgba(255,173,77,.10);border:1px solid rgba(255,173,77,.28)}.stock-badge.unlimited{color:#d9e0dc;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13)}
.empty{grid-column:1/-1;min-height:260px;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:28px;background:rgba(255,255,255,.025);gap:12px}.empty strong{font-size:34px}.empty span{font-size:18px;color:var(--muted)}
.footer{margin-top:auto;display:flex;justify-content:space-between;align-items:center;gap:20px;padding-top:26px;border-top:1px solid var(--line);color:#8d9992;font-size:16px}.footer strong{color:#edf3ef}.live{display:flex;align-items:center;gap:12px}.live-dot{width:11px;height:11px;border-radius:50%;background:var(--green);box-shadow:0 0 0 6px rgba(30,215,96,.10)}.page{color:#7cf2a5;font-weight:800}
</style>
</head>
<body>
<section class="stock-board"><div class="inner">
<header class="header">
    <div>
        <div class="eyebrow"><span class="eyebrow-dot"></span>Live catalog</div>
        <div class="hero-title"><span class="green">LIVE</span> STOCK</div>
        <div class="subtitle">${escaparHtml(subtitle || 'Current availability synchronized automatically from SellAuth.')}</div>
    </div>
    <div class="brand">${logo ? `<img class="brand-logo" src="${logo}" alt="">` : `<div class="brand-fallback">SM</div>`}<div><small>Spotify Market</small><strong>${escaparHtml(title || 'Stock board')}</strong></div></div>
</header>
<div class="stats">
    <div class="stat"><div class="stat-value">${todos.length}</div><div class="stat-label">Products live</div></div>
    <div class="stat"><div class="stat-value">${infinitos ? `${unidades}+` : unidades}</div><div class="stat-label">Units ready</div></div>
    <div class="stat"><div class="stat-value">${categorias}</div><div class="stat-label">Categories</div></div>
</div>
<main class="products">${cards}</main>
<footer class="footer">
    <div><strong>Spotify Market</strong> / SellAuth live stock board</div>
    <div class="live"><span class="live-dot"></span><span class="page">${paginaTexto}</span><span>·</span><span>${escaparHtml(actualizado)}</span></div>
</footer>
</div></section>
</body>
</html>`;
}

function esEjecutable(ruta) {
    if (!ruta) return false;
    try {
        fs.accessSync(ruta, fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

function candidatosCachePuppeteer() {
    const home = process.env.HOME || os.homedir();
    const bases = [
        path.join(home, '.cache', 'puppeteer', 'chrome'),
        path.join(home, '.cache', 'puppeteer', 'chrome-headless-shell')
    ];
    const encontrados = [];
    for (const base of bases) {
        try {
            for (const version of fs.readdirSync(base)) {
                encontrados.push(path.join(base, version, 'chrome-linux64', 'chrome'));
                encontrados.push(path.join(base, version, 'chrome-headless-shell-linux64', 'chrome-headless-shell'));
            }
        } catch { /* No existe esa cache. */ }
    }
    return encontrados;
}

function resolverChromium() {
    if (chromiumCache !== undefined) return chromiumCache;
    const candidatos = [
        process.env.CHROMIUM_PATH?.trim(),
        process.env.PUPPETEER_EXECUTABLE_PATH?.trim(),
        process.env.CHROME_PATH?.trim(),
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/snap/bin/chromium',
        ...candidatosCachePuppeteer()
    ].filter(Boolean);
    for (const candidato of candidatos) {
        if (esEjecutable(candidato)) {
            chromiumCache = candidato;
            return chromiumCache;
        }
    }
    for (const nombre of ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome']) {
        try {
            const salida = execFileSync('which', [nombre], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
            if (salida && esEjecutable(salida)) {
                chromiumCache = salida;
                return chromiumCache;
            }
        } catch { /* Sigue buscando. */ }
    }
    chromiumCache = '';
    return chromiumCache;
}

class CdpClient {
    constructor(url) {
        this.ws = new WebSocket(url);
        this.id = 0;
        this.pending = new Map();
        this.ready = new Promise((resolve, reject) => {
            this.ws.onopen = resolve;
            this.ws.onerror = () => reject(new Error('No se pudo abrir WebSocket con Chromium.'));
        });
        this.ws.onmessage = evento => {
            const mensaje = JSON.parse(evento.data);
            if (!mensaje.id || !this.pending.has(mensaje.id)) return;
            const pendiente = this.pending.get(mensaje.id);
            this.pending.delete(mensaje.id);
            if (mensaje.error) pendiente.reject(new Error(mensaje.error.message || JSON.stringify(mensaje.error)));
            else pendiente.resolve(mensaje.result);
        };
        this.ws.onclose = () => {
            for (const pendiente of this.pending.values()) pendiente.reject(new Error('Chromium cerro la conexion CDP.'));
            this.pending.clear();
        };
    }

    async send(method, params = {}, sessionId = '') {
        await this.ready;
        const id = ++this.id;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        });
    }

    close() {
        try {
            this.ws.close();
        } catch { /* Ya cerrado. */ }
    }
}

async function iniciarBrowser() {
    const chromium = resolverChromium();
    if (!chromium) throw new Error('No hay Chromium disponible. Instala Chromium en la VPS o define CHROMIUM_PATH.');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotify-stock-browser-'));
    const proceso = spawn(chromium, [
        '--headless', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
        '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank'
    ], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, HOME: process.env.HOME || os.tmpdir() } });

    let stderr = '';
    let wsUrl = '';
    proceso.stderr.setEncoding('utf8');
    proceso.stderr.on('data', parte => {
        stderr += parte;
        if (stderr.length > 12000) stderr = stderr.slice(-12000);
        const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) wsUrl = match[1];
    });

    for (let i = 0; i < 120 && !wsUrl; i += 1) {
        if (proceso.exitCode !== null) break;
        await dormir(50);
    }
    if (!wsUrl) {
        proceso.kill('SIGTERM');
        fs.rmSync(dir, { recursive: true, force: true });
        throw new Error(`Chromium no expuso DevTools: ${stderr.trim().slice(-700) || 'sin detalle'}`);
    }

    const cdp = new CdpClient(wsUrl);
    await cdp.ready;
    const browser = { proceso, dir, cdp, chromium };
    proceso.once('exit', () => {
        if (browserPromise) browserPromise = null;
    });
    logger.detalle(`Stock HTML renderer ${RENDERER_VERSION} · Chromium ${chromium}`);
    return browser;
}

async function obtenerBrowser() {
    if (!browserPromise) {
        browserPromise = iniciarBrowser().catch(error => {
            browserPromise = null;
            throw error;
        });
    }
    return browserPromise;
}

async function renderizar(html, alto) {
    const browser = await obtenerBrowser();
    const { cdp } = browser;
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    try {
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
        await cdp.send('Page.enable', {}, sessionId);
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: ANCHO,
            height: alto,
            deviceScaleFactor: 1,
            mobile: false
        }, sessionId);
        const { frameTree } = await cdp.send('Page.getFrameTree', {}, sessionId);
        await cdp.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html }, sessionId);
        await cdp.send('Runtime.evaluate', {
            expression: `Promise.resolve(document.fonts?.ready).then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))`,
            awaitPromise: true,
            returnByValue: true
        }, sessionId);
        const captura = await cdp.send('Page.captureScreenshot', {
            format: 'png',
            fromSurface: true,
            captureBeyondViewport: false
        }, sessionId);
        const buffer = Buffer.from(captura.data, 'base64');
        if (buffer.length < 10000) throw new Error('Chromium genero una captura demasiado pequena.');
        return buffer;
    } finally {
        await cdp.send('Target.closeTarget', { targetId }).catch(() => null);
    }
}

function dividir(lista, tamano) {
    const paginas = [];
    for (let i = 0; i < lista.length; i += tamano) paginas.push(lista.slice(i, i + tamano));
    return paginas.length ? paginas : [[]];
}

function nombreArchivoStock(pagina = 1, total = 1) {
    return total > 1 ? `spotify-market-live-stock-${String(pagina).padStart(2, '0')}.png` : 'spotify-market-live-stock.png';
}

async function generarPanelesStock(productos, opciones = {}) {
    const disponibles = productos
        .filter(producto => producto?.visible && Number(producto.stock) !== 0)
        .sort((a, b) => String(a.categoria || '').localeCompare(String(b.categoria || '')) || String(a.nombre || '').localeCompare(String(b.nombre || '')));
    const porPagina = Math.min(Math.max(Number(opciones.productsPerPage) || PRODUCTOS_POR_PAGINA, 6), 12);
    const maxPaginas = Math.min(Math.max(Number(opciones.maxPages) || 3, 1), MAX_PAGINAS_DISCORD);
    const limite = porPagina * maxPaginas;
    const visibles = disponibles.slice(0, limite);
    if (disponibles.length > limite) logger.warn('sellauth:stock-html', `${disponibles.length - limite} productos no caben en las ${maxPaginas} paginas configuradas.`);
    const [recursos, hidratados] = await Promise.all([recursosLocales(), hidratarImagenes(visibles)]);
    const paginas = dividir(hidratados, porPagina);
    const updatedAt = Number(opciones.updatedAt) || Date.now();
    const totalPaginas = paginas.length;
    const resultados = [];
    for (let i = 0; i < paginas.length; i += 1) {
        const html = htmlPagina(paginas[i], {
            todos: hidratados,
            pagina: i + 1,
            totalPaginas,
            title: opciones.title || 'Stock board',
            subtitle: opciones.subtitle || 'Current availability synchronized automatically from SellAuth.',
            lowStockThreshold: Number.isFinite(Number(opciones.lowStockThreshold)) ? Number(opciones.lowStockThreshold) : 3,
            updatedAt,
            ...recursos
        });
        resultados.push({
            pagina: i + 1,
            totalPaginas,
            nombre: nombreArchivoStock(i + 1, totalPaginas),
            buffer: await renderizar(html, alturaPagina(paginas[i].length))
        });
    }
    return resultados;
}

async function cerrar() {
    if (!browserPromise) return;
    try {
        const browser = await browserPromise;
        browser.cdp.close();
        browser.proceso.kill('SIGTERM');
        await dormir(100);
        fs.rmSync(browser.dir, { recursive: true, force: true });
    } catch { /* El navegador ya estaba cerrado. */ }
    finally { browserPromise = null; }
}

function diagnostico() {
    const chromium = resolverChromium();
    return {
        renderer: RENDERER_VERSION,
        chromiumPath: chromium || '',
        available: Boolean(chromium)
    };
}

module.exports = {
    ANCHO,
    PRODUCTOS_POR_PAGINA,
    RENDERER_VERSION,
    generarPanelesStock,
    nombreArchivoStock,
    diagnostico,
    cerrar
};
