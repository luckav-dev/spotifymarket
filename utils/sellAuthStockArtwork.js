'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const logger = require('./logger');

const ROOT = path.resolve(__dirname, '..');
const FONT_PATH = path.join(ROOT, 'assets', 'fuentes', 'Montserrat-Variable.ttf');
const LOGO_PATH = path.join(ROOT, 'assets', 'brand', 'SpotifyMarket.png');
const ANCHO = 2048;
const COLUMNAS = 4;
const PRODUCTOS_POR_PAGINA = 12;
const MAX_PAGINAS_DISCORD = 10;
const RENDERER_VERSION = 'html-chromium-cdp-v7-premium-grid';

let chromiumCache;
let browserPromise = null;

// Un Chromium ocioso son ~150 MB retenidos entre renders que pueden estar
// separados por horas. Se cierra solo y se vuelve a abrir cuando haga falta.
const CIERRE_POR_INACTIVIDAD_MS = 10 * 60 * 1000;
let temporizadorInactividad = null;

function posponerCierre(cerrar) {
    if (temporizadorInactividad) clearTimeout(temporizadorInactividad);
    temporizadorInactividad = setTimeout(() => {
        temporizadorInactividad = null;
        cerrar().catch(() => null);
    }, CIERRE_POR_INACTIVIDAD_MS);
    temporizadorInactividad.unref?.();
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function esc(v) {
    return String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function money(value, currency = 'EUR') {
    try {
        return new Intl.NumberFormat('en-GB', { style: 'currency', currency: String(currency || 'EUR').toUpperCase(), minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));
    } catch {
        return `${Number(value || 0).toFixed(2)} ${String(currency || 'EUR').toUpperCase()}`;
    }
}

function dataFile(file, mime) {
    try { return fs.existsSync(file) ? `data:${mime};base64,${fs.readFileSync(file).toString('base64')}` : ''; }
    catch { return ''; }
}

function initials(name) {
    return String(name || 'SM').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase().slice(0, 2) || 'SM';
}

function gradient(product) {
    const h = crypto.createHash('sha1').update(String(product.id || product.nombre || '')).digest();
    const a = Math.round(h[0] * 360 / 255);
    const b = (a + 42 + h[1] % 64) % 360;
    return `linear-gradient(135deg,hsl(${a} 58% 42%),hsl(${b} 68% 23%))`;
}

function badge(product, low) {
    const stock = Number(product.stock);
    if (stock < 0) return { cls: 'unlimited', top: 'AVAILABLE', num: '∞', label: 'Unlimited' };
    if (stock <= low) return { cls: 'low', top: 'LOW STOCK', num: String(stock), label: 'Ready now' };
    return { cls: 'normal', top: 'AVAILABLE', num: String(stock), label: 'Ready now' };
}

function imageMarkup(product, logo) {
    const url = /^https:\/\//i.test(String(product.imagen || '')) ? esc(product.imagen) : '';
    const fallback = logo ? `<img class="fallback-logo" src="${logo}" alt="">` : `<span>${esc(initials(product.nombre))}</span>`;
    return `<div class="thumb-fallback">${fallback}</div>${url ? `<img class="remote-image" src="${url}" alt="" onerror="this.remove()">` : ''}`;
}

function productCard(product, low, logo) {
    const b = badge(product, low);
    return `<article class="product-card ${b.cls}">
      <div class="card-accent"></div>
      <div class="card-top"><span class="category-pill">${esc(product.categoria || 'Catalog')}</span><span class="availability"><i></i>${b.top}</span></div>
      <div class="product-head">
        <div class="thumb" style="--fallback:${gradient(product)}">${imageMarkup(product, logo)}</div>
        <div class="product-copy"><div class="product-name">${esc(product.nombre)}</div><div class="product-caption">Instant digital delivery</div></div>
      </div>
      <div class="divider"></div>
      <div class="product-meta">
        <div><div class="meta-label">Price</div><div class="price">${esc(money(product.precio, product.moneda))}</div></div>
        <div class="stock-block"><div class="stock-number">${esc(b.num)}</div><div class="stock-label">${b.label}</div></div>
      </div>
    </article>`;
}

function pageHeight(count) {
    const rows = Math.max(1, Math.ceil(Math.max(1, count) / COLUMNAS));
    return 498 + rows * 286 + Math.max(0, rows - 1) * 22;
}

function pageHtml(products, ctx) {
    const { all, page, pages, title, subtitle, lowStockThreshold, updatedAt, font, logo } = ctx;
    const units = all.filter(x => Number(x.stock) > 0).reduce((a, x) => a + Number(x.stock), 0);
    const infinite = all.some(x => Number(x.stock) < 0);
    const categories = new Set(all.map(x => String(x.categoria || '').trim()).filter(Boolean)).size;
    const low = all.filter(x => Number(x.stock) >= 0 && Number(x.stock) <= lowStockThreshold).length;
    const cards = products.length ? products.map(x => productCard(x, lowStockThreshold, logo)).join('') : `<div class="empty"><div class="empty-icon">↻</div><strong>Stock is being prepared</strong><span>New availability will appear here automatically.</span></div>`;
    const pageText = pages > 1 ? `Page ${page} / ${pages}` : 'Live inventory';
    const updated = new Date(updatedAt).toLocaleString('en-GB', { timeZone: 'Europe/Madrid', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const height = pageHeight(products.length);
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=${ANCHO},initial-scale=1"><style>
${font ? `@font-face{font-family:Market;src:url('${font}') format('truetype');font-weight:100 900;font-style:normal;font-display:block}` : ''}
:root{--green:#1ed760;--text:#f7faf8;--muted:#98a59e;--line:rgba(255,255,255,.085);--shadow:0 24px 60px rgba(0,0,0,.27)}*{box-sizing:border-box}html,body{margin:0;width:${ANCHO}px;height:${height}px;overflow:hidden;background:#040705}body{font-family:Market,Inter,"Segoe UI",Arial,sans-serif;color:var(--text)}
.board{width:100%;height:100%;position:relative;overflow:hidden;background:radial-gradient(circle at 92% -8%,rgba(30,215,96,.19),transparent 27%),radial-gradient(circle at -4% 104%,rgba(30,215,96,.075),transparent 26%),linear-gradient(145deg,#07100b 0%,#050806 46%,#080b09 100%)}.board:before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(115deg,rgba(255,255,255,.018),transparent 26%,transparent 74%,rgba(30,215,96,.02)),repeating-linear-gradient(90deg,rgba(255,255,255,.007) 0,rgba(255,255,255,.007) 1px,transparent 1px,transparent 64px)}
.inner{position:relative;height:100%;padding:44px 52px 30px;display:flex;flex-direction:column}.header{display:grid;grid-template-columns:minmax(0,1fr) 390px;gap:28px}.hero{padding-top:4px}.eyebrow{display:inline-flex;align-items:center;gap:11px;padding:10px 16px;border-radius:999px;border:1px solid rgba(30,215,96,.22);background:rgba(30,215,96,.09);color:#8bf7b0;font-size:15px;font-weight:820;letter-spacing:.14em;text-transform:uppercase}.eyebrow i{width:9px;height:9px;border-radius:50%;background:var(--green);box-shadow:0 0 0 7px rgba(30,215,96,.08)}
.hero-title{font-size:94px;line-height:.93;letter-spacing:-.062em;margin:17px 0 12px;font-weight:900}.hero-title span{color:var(--green)}.subtitle{font-size:21px;line-height:1.45;color:#a5b0aa;max-width:1160px}.brand{display:flex;flex-direction:column;justify-content:space-between;border:1px solid var(--line);border-radius:28px;padding:20px;background:linear-gradient(180deg,rgba(255,255,255,.042),rgba(255,255,255,.018));box-shadow:var(--shadow)}.brand-top{display:flex;align-items:center;gap:17px}.brand-logo{width:72px;height:72px;border-radius:22px;object-fit:contain;background:rgba(30,215,96,.08);padding:7px}.brand-fallback{width:72px;height:72px;border-radius:22px;display:grid;place-items:center;background:linear-gradient(135deg,#2be873,#0a8f3d);color:#041108;font-weight:950;font-size:36px}.brand small{display:block;color:#76847c;font-size:12px;font-weight:780;letter-spacing:.18em;text-transform:uppercase;margin-bottom:6px}.brand strong{font-size:29px;letter-spacing:-.035em}.brand-status{display:flex;justify-content:space-between;align-items:center;margin-top:18px;padding-top:16px;border-top:1px solid var(--line);color:#87948d;font-size:13px;font-weight:720}.online{display:flex;align-items:center;gap:9px;color:#90f7b4}.online i{width:9px;height:9px;border-radius:50%;background:var(--green);box-shadow:0 0 0 5px rgba(30,215,96,.09)}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin:26px 0}.stat{position:relative;overflow:hidden;border:1px solid var(--line);background:linear-gradient(180deg,rgba(255,255,255,.038),rgba(255,255,255,.018));border-radius:22px;padding:18px 20px;min-height:96px}.stat:after{content:"";position:absolute;width:120px;height:120px;border-radius:50%;right:-52px;top:-64px;background:rgba(30,215,96,.055)}.stat-value{font-size:46px;font-weight:900;letter-spacing:-.055em;line-height:.95;margin-bottom:9px}.stat-label{font-size:11px;color:#7d8a83;letter-spacing:.16em;text-transform:uppercase;font-weight:800}
.products{display:grid;grid-template-columns:repeat(${COLUMNAS},minmax(0,1fr));gap:22px}.product-card{position:relative;overflow:hidden;min-height:286px;border-radius:28px;padding:18px 18px 20px;border:1px solid var(--line);background:linear-gradient(180deg,rgba(14,19,16,.98),rgba(8,11,9,.99));box-shadow:var(--shadow);display:flex;flex-direction:column}.product-card:before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 100% 0,rgba(30,215,96,.075),transparent 35%);pointer-events:none}.product-card.low:before{background:radial-gradient(circle at 100% 0,rgba(255,175,77,.09),transparent 35%)}.card-accent{position:absolute;left:0;top:28px;bottom:28px;width:3px;border-radius:0 6px 6px 0;background:linear-gradient(180deg,var(--green),rgba(30,215,96,.06))}.product-card.low .card-accent{background:linear-gradient(180deg,#ffb454,rgba(255,180,84,.06))}
.card-top{position:relative;z-index:1;display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px}.category-pill{max-width:64%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:7px 10px;border-radius:999px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.07);color:#9aa69f;font-size:10px;font-weight:820;letter-spacing:.14em;text-transform:uppercase}.availability{display:flex;align-items:center;gap:7px;color:#75ee9e;font-size:10px;font-weight:850;letter-spacing:.1em;white-space:nowrap}.product-card.low .availability{color:#ffc06b}.availability i{width:7px;height:7px;border-radius:50%;background:currentColor}
.product-head{position:relative;z-index:1;display:grid;grid-template-columns:104px minmax(0,1fr);gap:18px;align-items:center}.thumb{position:relative;width:104px;height:104px;border-radius:25px;overflow:hidden;background:var(--fallback);border:1px solid rgba(255,255,255,.11);box-shadow:0 16px 28px rgba(0,0,0,.22)}.thumb-fallback,.remote-image{position:absolute;inset:0;width:100%;height:100%}.thumb-fallback{display:grid;place-items:center;font-size:28px;font-weight:900}.thumb-fallback img{width:100%;height:100%;object-fit:contain;padding:13px;background:#090d0a}.remote-image{object-fit:cover}.product-name{font-size:26px;line-height:1.1;letter-spacing:-.035em;font-weight:880;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.product-caption{margin-top:8px;color:#75827b;font-size:12px;font-weight:650}.divider{position:relative;z-index:1;height:1px;background:linear-gradient(90deg,rgba(255,255,255,.09),rgba(255,255,255,.035));margin:20px 0 17px}.product-meta{position:relative;z-index:1;margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;gap:14px}.meta-label{color:#7f8c85;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;margin-bottom:8px}.price{font-size:41px;font-weight:900;letter-spacing:-.055em;line-height:.93}.stock-block{text-align:right;min-width:88px}.stock-number{font-size:33px;line-height:.9;font-weight:900;letter-spacing:-.05em;color:#80f4a7}.low .stock-number{color:#ffc06b}.unlimited .stock-number{color:#d9e0dc}.stock-label{margin-top:8px;color:#77847d;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
.empty{grid-column:1/-1;min-height:286px;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:28px;background:rgba(255,255,255,.024);gap:10px}.empty-icon{width:56px;height:56px;display:grid;place-items:center;border-radius:18px;background:rgba(30,215,96,.09);color:#7cf2a5;font-size:28px}.empty strong{font-size:32px}.empty span{font-size:17px;color:var(--muted)}.footer{margin-top:auto;display:flex;justify-content:space-between;align-items:center;padding-top:24px;border-top:1px solid var(--line);color:#87948d;font-size:14px}.footer strong{color:#edf3ef}.live{display:flex;align-items:center;gap:11px}.live i{width:9px;height:9px;border-radius:50%;background:var(--green);box-shadow:0 0 0 5px rgba(30,215,96,.09)}.page{color:#82f4a8;font-weight:800}
</style></head><body><section class="board"><div class="inner"><header class="header"><div class="hero"><div class="eyebrow"><i></i>Live catalog</div><div class="hero-title"><span>LIVE</span> STOCK</div><div class="subtitle">${esc(subtitle || 'Current availability synchronized automatically from SellAuth.')}</div></div><div class="brand"><div class="brand-top">${logo ? `<img class="brand-logo" src="${logo}" alt="">` : `<div class="brand-fallback">SM</div>`}<div><small>Spotify Market</small><strong>${esc(title || 'Stock board')}</strong></div></div><div class="brand-status"><span>Real-time availability</span><span class="online"><i></i>ONLINE</span></div></div></header><section class="stats"><div class="stat"><div class="stat-value">${all.length}</div><div class="stat-label">Products live</div></div><div class="stat"><div class="stat-value">${infinite ? `${units}+` : units}</div><div class="stat-label">Units ready</div></div><div class="stat"><div class="stat-value">${categories}</div><div class="stat-label">Categories</div></div><div class="stat"><div class="stat-value">${low}</div><div class="stat-label">Low stock</div></div></section><main class="products">${cards}</main><footer class="footer"><div><strong>Spotify Market</strong> · Live digital inventory</div><div class="live"><i></i><span class="page">${pageText}</span><span>·</span><span>${esc(updated)}</span></div></footer></div></section></body></html>`;
}

function isExecutable(file) {
    try { if (!file) return false; fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; }
}

function puppeteerCandidates() {
    const home = process.env.HOME || os.homedir();
    const out = [];
    for (const base of [path.join(home, '.cache', 'puppeteer', 'chrome'), path.join(home, '.cache', 'puppeteer', 'chrome-headless-shell')]) {
        try { for (const version of fs.readdirSync(base)) { out.push(path.join(base, version, 'chrome-linux64', 'chrome')); out.push(path.join(base, version, 'chrome-headless-shell-linux64', 'chrome-headless-shell')); } } catch {}
    }
    return out;
}

function resolveChromium() {
    if (chromiumCache !== undefined) return chromiumCache;
    const candidates = [process.env.CHROMIUM_PATH?.trim(), process.env.PUPPETEER_EXECUTABLE_PATH?.trim(), process.env.CHROME_PATH?.trim(), '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/snap/bin/chromium', ...puppeteerCandidates()].filter(Boolean);
    for (const file of candidates) if (isExecutable(file)) return chromiumCache = file;
    for (const name of ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome']) {
        try { const file = execFileSync('which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); if (isExecutable(file)) return chromiumCache = file; } catch {}
    }
    return chromiumCache = '';
}

class CdpClient {
    constructor(url) {
        this.ws = new WebSocket(url); this.id = 0; this.pending = new Map();
        this.ready = new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = () => reject(new Error('No se pudo abrir WebSocket con Chromium.')); });
        this.ws.onmessage = event => { const msg = JSON.parse(event.data); if (!msg.id || !this.pending.has(msg.id)) return; const p = this.pending.get(msg.id); this.pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message || JSON.stringify(msg.error))) : p.resolve(msg.result); };
        this.ws.onclose = () => { for (const p of this.pending.values()) p.reject(new Error('Chromium cerro la conexion CDP.')); this.pending.clear(); };
    }
    async send(method, params = {}, sessionId = '') { await this.ready; const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); }
    close() { try { this.ws.close(); } catch {} }
}

async function startBrowser() {
    const chromium = resolveChromium();
    if (!chromium) throw new Error('No hay Chromium disponible. Instala Chromium en la VPS o define CHROMIUM_PATH.');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotify-stock-browser-'));
    const process = spawn(chromium, ['--headless', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...global.process.env, HOME: global.process.env.HOME || os.tmpdir() } });
    let stderr = '', wsUrl = '';
    process.stderr.setEncoding('utf8');
    process.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 12000) stderr = stderr.slice(-12000); const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (m) wsUrl = m[1]; });
    for (let i = 0; i < 120 && !wsUrl; i++) { if (process.exitCode !== null) break; await sleep(50); }
    if (!wsUrl) { process.kill('SIGTERM'); fs.rmSync(dir, { recursive: true, force: true }); throw new Error(`Chromium no expuso DevTools: ${stderr.trim().slice(-700) || 'sin detalle'}`); }
    const cdp = new CdpClient(wsUrl); await cdp.ready;
    const browser = { process, dir, cdp, chromium }; process.once('exit', () => { browserPromise = null; });
    logger.detalle(`Stock HTML renderer ${RENDERER_VERSION} · Chromium ${chromium}`);
    return browser;
}

async function getBrowser() {
    if (!browserPromise) browserPromise = startBrowser().catch(error => { browserPromise = null; throw error; });
    return browserPromise;
}

async function render(html, height) {
    const browser = await getBrowser(), { cdp } = browser;
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    try {
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
        await cdp.send('Page.enable', {}, sessionId);
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: ANCHO, height, deviceScaleFactor: 1, mobile: false }, sessionId);
        const { frameTree } = await cdp.send('Page.getFrameTree', {}, sessionId);
        await cdp.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html }, sessionId);
        await cdp.send('Runtime.evaluate', { expression: `Promise.all([document.fonts?.ready,Promise.race([Promise.all([...document.images].map(i=>i.complete?1:new Promise(r=>{i.onload=i.onerror=r}))),new Promise(r=>setTimeout(r,4500))])]).then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))`, awaitPromise: true, returnByValue: true }, sessionId);
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, sessionId);
        const buffer = Buffer.from(shot.data, 'base64');
        if (buffer.length < 10000) throw new Error('Chromium genero una captura demasiado pequena.');
        return buffer;
    } finally { await cdp.send('Target.closeTarget', { targetId }).catch(() => null); }
}

function chunks(list, size) {
    const pages = []; for (let i = 0; i < list.length; i += size) pages.push(list.slice(i, i + size)); return pages.length ? pages : [[]];
}

function nombreArchivoStock(page = 1, total = 1) {
    return total > 1 ? `spotify-market-live-stock-${String(page).padStart(2, '0')}.png` : 'spotify-market-live-stock.png';
}

async function generarPanelesStock(productos, opciones = {}) {
    const available = productos.filter(x => x?.visible && Number(x.stock) !== 0).sort((a, b) => String(a.categoria || '').localeCompare(String(b.categoria || '')) || String(a.nombre || '').localeCompare(String(b.nombre || '')));
    const perPage = Math.min(Math.max(Number(opciones.productsPerPage) || PRODUCTOS_POR_PAGINA, 6), 12);
    const maxPages = Math.min(Math.max(Number(opciones.maxPages) || 3, 1), MAX_PAGINAS_DISCORD);
    const visible = available.slice(0, perPage * maxPages);
    if (available.length > visible.length) logger.warn('sellauth:stock-html', `${available.length - visible.length} productos no caben en las ${maxPages} paginas configuradas.`);
    const pages = chunks(visible, perPage), updatedAt = Number(opciones.updatedAt) || Date.now();
    const font = dataFile(FONT_PATH, 'font/ttf'), logo = dataFile(LOGO_PATH, 'image/png'), results = [];
    for (let i = 0; i < pages.length; i++) {
        const html = pageHtml(pages[i], { all: visible, page: i + 1, pages: pages.length, title: opciones.title || 'Stock board', subtitle: opciones.subtitle || 'Current availability synchronized automatically from SellAuth.', lowStockThreshold: Number.isFinite(Number(opciones.lowStockThreshold)) ? Number(opciones.lowStockThreshold) : 3, updatedAt, font, logo });
        results.push({ pagina: i + 1, totalPaginas: pages.length, nombre: nombreArchivoStock(i + 1, pages.length), buffer: await render(html, pageHeight(pages[i].length)) });
    }
    // Los renders pueden separarse horas: no tiene sentido dejar un Chromium
    // ocupando memoria en medio. Se reprograma el cierre tras cada uso.
    posponerCierre(cerrar);
    return results;
}

async function cerrar() {
    if (temporizadorInactividad) {
        clearTimeout(temporizadorInactividad);
        temporizadorInactividad = null;
    }
    if (!browserPromise) return;
    try { const b = await browserPromise; b.cdp.close(); b.process.kill('SIGTERM'); await sleep(100); fs.rmSync(b.dir, { recursive: true, force: true }); } catch {} finally { browserPromise = null; }
}

function diagnostico() {
    const chromium = resolveChromium();
    return { renderer: RENDERER_VERSION, chromiumPath: chromium || '', available: Boolean(chromium) };
}

module.exports = { ANCHO, PRODUCTOS_POR_PAGINA, RENDERER_VERSION, generarPanelesStock, nombreArchivoStock, diagnostico, cerrar };
