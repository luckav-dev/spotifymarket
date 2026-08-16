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
const ANCHO = 2400;
const PRODUCTOS_POR_PAGINA = 60;
const RENDERER_VERSION = 'html-chromium-cdp-v10-single-board-clean';

let chromiumCache;
let browserPromise = null;
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
    return `linear-gradient(135deg,hsl(${a} 60% 44%),hsl(${b} 70% 24%))`;
}

function badge(product, low) {
    const stock = Number(product.stock);
    if (stock < 0) return { cls: 'unlimited', top: 'AVAILABLE', num: '∞', label: 'Unlimited' };
    if (stock <= low) return { cls: 'low', top: 'LOW STOCK', num: String(stock), label: 'Ready now' };
    return { cls: 'normal', top: 'AVAILABLE', num: String(stock), label: 'Ready now' };
}

function imageMarkup(product, logo) {
    const url = /^https:\/\//i.test(String(product.imagen || '')) ? esc(product.imagen) : '';
    const fallback = logo ? `<img src="${logo}" alt="">` : `<span>${esc(initials(product.nombre))}</span>`;
    return `<div class="thumb-fallback">${fallback}</div>${url ? `<img class="remote-image" src="${url}" alt="" onerror="this.remove()">` : ''}`;
}

function layoutFor(count) {
    const total = Math.max(1, Number(count) || 1);
    if (total <= 12) return { width: 2048, columns: 4, gap: 22, cardHeight: 286, paddingX: 52, paddingTop: 42, paddingBottom: 28, thumb: 108, hero: 94, subtitle: 21, title: 27, price: 41, stock: 34, radius: 28, cardPadding: 18, topReserve: 430, compact: false, stat: 48, footer: 14 };
    if (total <= 24) return { width: 2200, columns: 5, gap: 18, cardHeight: 238, paddingX: 42, paddingTop: 34, paddingBottom: 26, thumb: 88, hero: 82, subtitle: 18, title: 21, price: 33, stock: 27, radius: 24, cardPadding: 16, topReserve: 382, compact: false, stat: 41, footer: 13 };
    if (total <= 42) return { width: 2400, columns: 6, gap: 16, cardHeight: 210, paddingX: 36, paddingTop: 30, paddingBottom: 24, thumb: 72, hero: 70, subtitle: 17, title: 18, price: 28, stock: 23, radius: 22, cardPadding: 15, topReserve: 350, compact: true, stat: 35, footer: 13 };
    if (total <= 60) return { width: 2400, columns: 6, gap: 14, cardHeight: 188, paddingX: 32, paddingTop: 26, paddingBottom: 22, thumb: 62, hero: 62, subtitle: 15, title: 16, price: 24, stock: 20, radius: 20, cardPadding: 13, topReserve: 326, compact: true, stat: 30, footer: 12 };
    return { width: 2600, columns: 7, gap: 12, cardHeight: 176, paddingX: 28, paddingTop: 22, paddingBottom: 20, thumb: 56, hero: 56, subtitle: 14, title: 15, price: 22, stock: 18, radius: 18, cardPadding: 12, topReserve: 312, compact: true, stat: 28, footer: 12 };
}

function pageHeight(count, layout) {
    const rows = Math.max(1, Math.ceil(Math.max(1, count) / layout.columns));
    const productsHeight = rows * layout.cardHeight + Math.max(0, rows - 1) * layout.gap;
    return layout.topReserve + productsHeight + (layout.compact ? 96 : 118) + 36;
}

function productCard(product, low, logo, layout) {
    const b = badge(product, low);
    return `<article class="product-card ${b.cls}">
      <div class="card-glow"></div><div class="card-accent"></div>
      <div class="card-top"><span class="category-pill">${esc(product.categoria || 'Catalog')}</span><span class="availability"><i></i>${b.top}</span></div>
      <div class="product-head"><div class="thumb" style="--fallback:${gradient(product)}">${imageMarkup(product, logo)}</div><div class="product-copy"><div class="product-name">${esc(product.nombre)}</div>${layout.compact ? '' : '<div class="product-caption">Instant digital delivery</div>'}</div></div>
      <div class="divider"></div>
      <div class="product-meta"><div>${layout.compact ? '' : '<div class="meta-label">Price</div>'}<div class="price">${esc(money(product.precio, product.moneda))}</div></div><div class="stock-block"><div class="stock-number">${esc(b.num)}</div><div class="stock-label">${b.label}</div></div></div>
    </article>`;
}

function pageHtml(products, ctx) {
    const { all, subtitle, lowStockThreshold, updatedAt, font, logo, layout } = ctx;
    const units = all.filter(x => Number(x.stock) > 0).reduce((a, x) => a + Number(x.stock), 0);
    const infinite = all.some(x => Number(x.stock) < 0);
    const categories = new Set(all.map(x => String(x.categoria || '').trim()).filter(Boolean)).size;
    const low = all.filter(x => Number(x.stock) >= 0 && Number(x.stock) <= lowStockThreshold).length;
    const updated = new Date(updatedAt).toLocaleString('en-GB', { timeZone: 'Europe/Madrid', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const cards = products.length ? products.map(x => productCard(x, lowStockThreshold, logo, layout)).join('') : '<div class="empty">No products available</div>';
    const height = pageHeight(products.length, layout);
    const compact = layout.compact;
    const brandWidth = compact ? 250 : 290;

    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=${layout.width},initial-scale=1"><style>
${font ? `@font-face{font-family:Market;src:url('${font}') format('truetype');font-weight:100 900;font-style:normal;font-display:block}` : ''}
:root{--green:#1ed760;--text:#f7faf8;--muted:#95a29b;--line:rgba(255,255,255,.075);--shadow:0 24px 58px rgba(0,0,0,.30)}*{box-sizing:border-box}html,body{margin:0;width:${layout.width}px;height:${height}px;overflow:hidden;background:#040705}body{font-family:Market,Inter,"Segoe UI",Arial,sans-serif;color:var(--text)}
.board{position:relative;width:100%;height:100%;overflow:hidden;background:radial-gradient(circle at 95% 0,rgba(30,215,96,.16),transparent 22%),radial-gradient(circle at 0 100%,rgba(30,215,96,.07),transparent 24%),linear-gradient(145deg,#050906,#040706 42%,#060a08)}.board:before{content:"";position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(90deg,rgba(255,255,255,.005) 0,rgba(255,255,255,.005) 1px,transparent 1px,transparent 74px)}
.inner{position:relative;height:100%;padding:${layout.paddingTop}px ${layout.paddingX}px ${layout.paddingBottom}px;display:flex;flex-direction:column}.top{display:grid;grid-template-columns:minmax(0,1fr) ${brandWidth}px;gap:${compact ? 18 : 24}px;align-items:start}.eyebrow{display:inline-flex;align-items:center;gap:9px;padding:${compact ? '7px 11px' : '9px 14px'};border-radius:999px;border:1px solid rgba(30,215,96,.18);background:rgba(30,215,96,.075);color:#91f8b6;font-size:${compact ? 10 : 13}px;font-weight:850;letter-spacing:.16em;text-transform:uppercase}.eyebrow i{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 6px rgba(30,215,96,.07)}
.hero-title{font-size:${layout.hero}px;line-height:.91;letter-spacing:-.065em;margin:${compact ? '11px 0 7px' : '15px 0 10px'};font-weight:950}.hero-title span{color:var(--green)}.subtitle{max-width:1180px;font-size:${layout.subtitle}px;line-height:1.42;color:#a2afa9}.hero-meta{display:flex;gap:10px;margin-top:${compact ? 12 : 16}px}.hero-pill{padding:${compact ? '7px 10px' : '9px 12px'};border-radius:14px;border:1px solid var(--line);background:rgba(255,255,255,.024);color:#c9d2cd;font-size:${compact ? 10 : 11}px;font-weight:750}.hero-pill b{color:#fff}
.brand-card{position:relative;display:flex;align-items:center;border:1px solid var(--line);border-radius:${compact ? 20 : 24}px;padding:${compact ? '13px 15px' : '15px 17px'};background:linear-gradient(180deg,rgba(16,25,20,.82),rgba(8,12,10,.92));box-shadow:var(--shadow);overflow:hidden}.brand-card:before{content:"";position:absolute;right:-42px;top:-54px;width:150px;height:150px;border-radius:50%;background:radial-gradient(circle,rgba(30,215,96,.12),transparent 72%)}.brand-top{position:relative;z-index:1;display:flex;align-items:center;gap:${compact ? 11 : 13}px}.brand-logo,.brand-fallback{width:${compact ? 52 : 60}px;height:${compact ? 52 : 60}px;border-radius:${compact ? 15 : 18}px}.brand-logo{object-fit:contain;background:rgba(30,215,96,.06);padding:6px;border:1px solid rgba(255,255,255,.04)}.brand-fallback{display:grid;place-items:center;background:linear-gradient(135deg,#2be873,#0a8f3d);color:#041108;font-size:${compact ? 25 : 29}px;font-weight:950}.brand-copy small{display:block;color:#7b8881;font-size:${compact ? 9 : 10}px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;margin-bottom:4px}.brand-copy strong{display:block;font-size:${compact ? 20 : 23}px;line-height:1.02;letter-spacing:-.04em}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:${compact ? 12 : 16}px;margin:${compact ? '17px 0 18px' : '23px 0 22px'}.stat{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:${compact ? 18 : 22}px;padding:${compact ? '12px 15px' : '16px 19px'};min-height:${compact ? 74 : 92}px;background:linear-gradient(180deg,rgba(255,255,255,.034),rgba(255,255,255,.014))}.stat:after{content:"";position:absolute;right:-34px;top:-52px;width:112px;height:112px;border-radius:50%;background:radial-gradient(circle,rgba(30,215,96,.09),transparent 72%)}.stat-value{position:relative;font-size:${layout.stat}px;font-weight:950;line-height:.94;letter-spacing:-.06em;margin-bottom:7px}.stat-label{position:relative;font-size:${compact ? 9 : 10}px;color:#7f8c85;letter-spacing:.18em;text-transform:uppercase;font-weight:820}
.products{display:grid;grid-template-columns:repeat(${layout.columns},minmax(0,1fr));gap:${layout.gap}px;align-content:start}.product-card{position:relative;overflow:hidden;display:flex;flex-direction:column;height:${layout.cardHeight}px;padding:${layout.cardPadding}px;border-radius:${layout.radius}px;border:1px solid rgba(255,255,255,.055);background:linear-gradient(180deg,rgba(10,15,12,.96),rgba(5,8,7,.98));box-shadow:0 15px 34px rgba(0,0,0,.22)}.card-glow{position:absolute;inset:0;background:radial-gradient(circle at 100% 0,rgba(30,215,96,.075),transparent 35%)}.low .card-glow{background:radial-gradient(circle at 100% 0,rgba(255,188,92,.10),transparent 35%)}.card-accent{position:absolute;left:0;top:${compact ? 18 : 22}px;bottom:${compact ? 18 : 22}px;width:3px;border-radius:0 7px 7px 0;background:linear-gradient(180deg,var(--green),rgba(30,215,96,.06))}.low .card-accent{background:linear-gradient(180deg,#ffbf6d,rgba(255,191,109,.06))}
.card-top{position:relative;z-index:1;display:flex;justify-content:space-between;align-items:center;gap:9px;margin-bottom:${compact ? 11 : 14}px}.category-pill{max-width:66%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:${compact ? '5px 8px' : '6px 9px'};border-radius:999px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);color:#94a29c;font-size:${compact ? 8 : 9}px;font-weight:820;letter-spacing:.15em;text-transform:uppercase}.availability{display:inline-flex;align-items:center;gap:6px;color:#84f5ac;font-size:${compact ? 8 : 9}px;font-weight:900;letter-spacing:.11em;white-space:nowrap}.availability i{width:6px;height:6px;border-radius:50%;background:currentColor}.low .availability{color:#ffc36e}
.product-head{position:relative;z-index:1;display:grid;grid-template-columns:${layout.thumb}px minmax(0,1fr);gap:${compact ? 12 : 14}px;align-items:center}.thumb{position:relative;width:${layout.thumb}px;height:${layout.thumb}px;border-radius:${Math.max(14, Math.round(layout.radius * .82))}px;overflow:hidden;background:var(--fallback);border:1px solid rgba(255,255,255,.10);box-shadow:0 13px 26px rgba(0,0,0,.22)}.thumb-fallback,.remote-image{position:absolute;inset:0;width:100%;height:100%}.thumb-fallback{display:grid;place-items:center;font-size:24px;font-weight:900}.thumb-fallback img{width:100%;height:100%;object-fit:contain;padding:${compact ? 8 : 11}px;background:#090d0a}.remote-image{object-fit:cover}.product-copy{min-width:0}.product-name{font-size:${layout.title}px;line-height:1.08;letter-spacing:-.035em;font-weight:900;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.product-caption{margin-top:6px;color:#74807a;font-size:11px;font-weight:650}.divider{position:relative;z-index:1;height:1px;margin:${compact ? '12px 0 10px' : '15px 0 13px'};background:linear-gradient(90deg,rgba(255,255,255,.09),rgba(255,255,255,.02))}.product-meta{position:relative;z-index:1;display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin-top:auto}.meta-label{color:#7b8881;font-size:9px;font-weight:820;letter-spacing:.18em;text-transform:uppercase;margin-bottom:6px}.price{font-size:${layout.price}px;font-weight:950;letter-spacing:-.055em;line-height:.92;white-space:nowrap}.stock-block{text-align:right;min-width:68px}.stock-number{font-size:${layout.stock}px;line-height:.88;font-weight:950;letter-spacing:-.05em;color:#86f8af}.low .stock-number{color:#ffc36e}.unlimited .stock-number{color:#eef3f0}.stock-label{margin-top:5px;color:#76827d;font-size:${compact ? 8 : 9}px;font-weight:840;letter-spacing:.11em;text-transform:uppercase}
.empty{grid-column:1/-1;min-height:${layout.cardHeight}px;display:grid;place-items:center;border:1px solid var(--line);border-radius:${layout.radius}px;color:var(--muted)}.footer{display:flex;justify-content:space-between;align-items:center;gap:16px;padding-top:${compact ? 16 : 18}px;margin-top:${compact ? 16 : 18}px;border-top:1px solid rgba(255,255,255,.055);font-size:${layout.footer}px;color:#88968f}.footer strong{color:#eef3f0}.footer-left,.footer-right{display:flex;align-items:center;gap:10px}.footer-dot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 0 5px rgba(30,215,96,.06)}.footer-chip{display:inline-flex;align-items:center;gap:7px;padding:7px 10px;border-radius:999px;background:rgba(255,255,255,.027);border:1px solid rgba(255,255,255,.045);color:#d7dfda;font-weight:780}
</style></head><body><section class="board"><div class="inner"><section class="top"><div class="hero"><div class="eyebrow"><i></i>Live catalog</div><div class="hero-title"><span>LIVE</span> STOCK</div><div class="subtitle">${esc(subtitle || 'Current availability synchronized automatically from SellAuth.')}</div><div class="hero-meta"><div class="hero-pill">Synced with <b>SellAuth</b></div><div class="hero-pill"><b>${all.length}</b> products on one board</div></div></div><aside class="brand-card"><div class="brand-top">${logo ? `<img class="brand-logo" src="${logo}" alt="">` : `<div class="brand-fallback">SM</div>`}<div class="brand-copy"><small>Spotify Market</small><strong>Spotify Market</strong></div></div></aside></section><section class="stats"><div class="stat"><div class="stat-value">${all.length}</div><div class="stat-label">Products live</div></div><div class="stat"><div class="stat-value">${infinite ? `${units}+` : units}</div><div class="stat-label">Units ready</div></div><div class="stat"><div class="stat-value">${categories}</div><div class="stat-label">Categories</div></div><div class="stat"><div class="stat-value">${low}</div><div class="stat-label">Low stock</div></div></section><main class="products">${cards}</main><footer class="footer"><div class="footer-left"><span class="footer-dot"></span><span><strong>Spotify Market</strong> · Live digital inventory</span></div><div class="footer-right"><span class="footer-chip">All ${all.length} products</span><span>${esc(updated)}</span></div></footer></div></section></body></html>`;
}

function isExecutable(file) {
    try { if (!file) return false; fs.accessSync(file, fs.constants.X_OK); return true; }
    catch { return false; }
}

function puppeteerCandidates() {
    const home = process.env.HOME || os.homedir();
    const out = [];
    for (const base of [path.join(home, '.cache', 'puppeteer', 'chrome'), path.join(home, '.cache', 'puppeteer', 'chrome-headless-shell')]) {
        try {
            for (const version of fs.readdirSync(base)) {
                out.push(path.join(base, version, 'chrome-linux64', 'chrome'));
                out.push(path.join(base, version, 'chrome-headless-shell-linux64', 'chrome-headless-shell'));
            }
        } catch {}
    }
    return out;
}

function resolveChromium() {
    if (chromiumCache !== undefined) return chromiumCache;
    const candidates = [process.env.CHROMIUM_PATH?.trim(), process.env.PUPPETEER_EXECUTABLE_PATH?.trim(), process.env.CHROME_PATH?.trim(), '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', ...puppeteerCandidates()].filter(Boolean);
    for (const file of candidates) if (isExecutable(file)) return chromiumCache = file;
    for (const name of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']) {
        try {
            const file = execFileSync('which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
            if (isExecutable(file)) return chromiumCache = file;
        } catch {}
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
    if (!chromium) throw new Error('No hay Chromium disponible. Instala Chrome/Chromium en la VPS o define CHROMIUM_PATH.');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotify-stock-browser-'));
    const process = spawn(chromium, ['--headless', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...global.process.env, HOME: global.process.env.HOME || os.tmpdir() } });
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

async function render(html, width, height) {
    const browser = await getBrowser(), { cdp } = browser;
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    try {
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
        await cdp.send('Page.enable', {}, sessionId);
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
        const { frameTree } = await cdp.send('Page.getFrameTree', {}, sessionId);
        await cdp.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html }, sessionId);
        await cdp.send('Runtime.evaluate', { expression: `Promise.all([document.fonts?.ready,Promise.race([Promise.all([...document.images].map(i=>i.complete?1:new Promise(r=>{i.onload=i.onerror=r}))),new Promise(r=>setTimeout(r,4500))])]).then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))`, awaitPromise: true, returnByValue: true }, sessionId);
        const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, fromSurface: true, captureBeyondViewport: false }, sessionId);
        const buffer = Buffer.from(shot.data, 'base64');
        if (buffer.length < 10000) throw new Error('Chromium genero una captura demasiado pequena.');
        return buffer;
    } finally { await cdp.send('Target.closeTarget', { targetId }).catch(() => null); }
}

function nombreArchivoStock() { return 'spotify-market-live-stock.jpg'; }

async function generarPanelesStock(productos, opciones = {}) {
    const available = productos.filter(x => x?.visible && Number(x.stock) !== 0).sort((a, b) => String(a.categoria || '').localeCompare(String(b.categoria || '')) || String(a.nombre || '').localeCompare(String(b.nombre || '')));
    const updatedAt = Number(opciones.updatedAt) || Date.now();
    const lowStockThreshold = Number.isFinite(Number(opciones.lowStockThreshold)) ? Number(opciones.lowStockThreshold) : 3;
    const layout = layoutFor(available.length);
    const font = dataFile(FONT_PATH, 'font/ttf'), logo = dataFile(LOGO_PATH, 'image/png');
    const html = pageHtml(available, { all: available, subtitle: opciones.subtitle || 'Current availability synchronized automatically from SellAuth.', lowStockThreshold, updatedAt, font, logo, layout });
    const height = pageHeight(available.length, layout), nombre = nombreArchivoStock();
    logger.detalle(`Stock single-board clean: ${available.length} productos · ${layout.columns} columnas · ${layout.width}x${height}`);
    return [{ pagina: 1, totalPaginas: 1, nombre, buffer: await render(html, layout.width, height) }];
}

async function cerrar() {
    if (!browserPromise) return;
    try { const b = await browserPromise; b.cdp.close(); b.process.kill('SIGTERM'); await sleep(100); fs.rmSync(b.dir, { recursive: true, force: true }); }
    catch {} finally { browserPromise = null; }
}

function diagnostico() {
    const chromium = resolveChromium();
    return { renderer: RENDERER_VERSION, chromiumPath: chromium || '', available: Boolean(chromium) };
}

module.exports = { ANCHO, PRODUCTOS_POR_PAGINA, RENDERER_VERSION, generarPanelesStock, nombreArchivoStock, diagnostico, cerrar };
