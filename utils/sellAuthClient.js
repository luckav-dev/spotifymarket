'use strict';

const SELLAUTH_API_BASE = 'https://api.sellauth.com/v1';
const MARKET_API_BASE = 'https://spotifymarket.xyz/api/bot';
const MAX_REINTENTOS = 2;

class SellAuthError extends Error {
    constructor(message, { status = 0, body = null, retryAfterMs = 0 } = {}) {
        super(message);
        this.name = 'SellAuthError';
        this.status = status;
        this.body = body;
        this.retryAfterMs = retryAfterMs;
    }
}

function esperar(ms) {
    return new Promise(resolve => {
        const temporizador = setTimeout(resolve, ms);
        temporizador.unref?.();
    });
}

function objetoConsulta(query = {}) {
    const params = new URLSearchParams();
    for (const [clave, valor] of Object.entries(query)) {
        if (valor === undefined || valor === null || valor === '') continue;
        if (Array.isArray(valor)) {
            for (const item of valor) params.append(`${clave}[]`, String(item));
        } else {
            params.set(clave, String(valor));
        }
    }
    return params;
}

function retryAfterMsDe(respuesta, datos) {
    const cabecera = String(respuesta.headers.get('retry-after') ?? '').trim();
    if (cabecera) {
        const segundos = Number(cabecera);
        if (Number.isFinite(segundos) && segundos >= 0) return Math.ceil(segundos * 1000);
        const fecha = Date.parse(cabecera);
        if (Number.isFinite(fecha)) return Math.max(0, fecha - Date.now());
    }

    const mensaje = String(datos?.message ?? datos?.error ?? '');
    const minutos = mensaje.match(/after\s+(\d+)\s+minute/i);
    if (minutos) return Number(minutos[1]) * 60 * 1000;
    const segundos = mensaje.match(/after\s+(\d+)\s+second/i);
    if (segundos) return Number(segundos[1]) * 1000;
    return 0;
}

class SellAuthClient {
    constructor({ apiKey, shopId, baseUrl = SELLAUTH_API_BASE, timeoutMs = 12000 } = {}) {
        const marketSecret = String(process.env.SPOTIFY_MARKET_API_SECRET ?? '').trim();
        this.mode = marketSecret ? 'market' : 'sellauth';
        this.apiKey = marketSecret || String(apiKey ?? '').trim();
        this.shopId = String(shopId ?? '').trim();
        this.baseUrl = this.mode === 'market'
            ? String(process.env.SPOTIFY_MARKET_API_URL || MARKET_API_BASE).replace(/\/+$/, '')
            : String(baseUrl || SELLAUTH_API_BASE).replace(/\/+$/, '');
        this.timeoutMs = timeoutMs;
    }

    configurado() {
        if (this.mode === 'market') return Boolean(this.apiKey && /^https:\/\//i.test(this.baseUrl));
        return Boolean(this.apiKey && /^\d+$/.test(this.shopId));
    }

    async request(pathname, { method = 'GET', query, body, intento = 0 } = {}) {
        if (!this.apiKey) {
            throw new SellAuthError(this.mode === 'market'
                ? 'Falta SPOTIFY_MARKET_API_SECRET en el entorno.'
                : 'Falta SELLAUTH_API_KEY en el entorno.');
        }
        if (this.mode === 'sellauth' && !/^\d+$/.test(this.shopId)) {
            throw new SellAuthError('Falta un SELLAUTH_SHOP_ID valido.');
        }

        const url = new URL(`${this.baseUrl}/${String(pathname).replace(/^\/+/, '')}`);
        for (const [clave, valor] of objetoConsulta(query)) url.searchParams.append(clave, valor);

        const controlador = new AbortController();
        const temporizador = setTimeout(() => controlador.abort(), this.timeoutMs);
        temporizador.unref?.();

        let respuesta;
        try {
            respuesta = await fetch(url, {
                method,
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    Accept: 'application/json',
                    ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
                },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: controlador.signal
            });
        } catch (error) {
            clearTimeout(temporizador);
            if (error.name === 'AbortError') {
                throw new SellAuthError(`${this.mode === 'market' ? 'Spotify Market API' : 'SellAuth'} no respondio en ${this.timeoutMs} ms.`);
            }
            throw new SellAuthError(`No se pudo conectar con ${this.mode === 'market' ? 'Spotify Market API' : 'SellAuth'}: ${error.message}`);
        }
        clearTimeout(temporizador);

        const texto = await respuesta.text();
        let datos = null;
        if (texto) {
            try { datos = JSON.parse(texto); } catch { datos = texto; }
        }

        if (!respuesta.ok) {
            const retryAfterMs = retryAfterMsDe(respuesta, datos);
            const detalle = datos?.message ?? datos?.error ?? `HTTP ${respuesta.status}`;
            const origen = this.mode === 'market' ? 'Spotify Market API' : 'SellAuth';

            if (respuesta.status === 429) {
                throw new SellAuthError(`${origen} rechazo la solicitud: ${detalle}`, {
                    status: respuesta.status,
                    body: datos,
                    retryAfterMs: Math.max(retryAfterMs, 60 * 1000)
                });
            }

            if (respuesta.status >= 500 && intento < MAX_REINTENTOS) {
                await esperar(Math.min(750 * (2 ** intento), 5000));
                return this.request(pathname, { method, query, body, intento: intento + 1 });
            }

            throw new SellAuthError(`${origen} rechazo la solicitud: ${detalle}`, {
                status: respuesta.status,
                body: datos,
                retryAfterMs
            });
        }

        return datos;
    }

    ruta(recurso = '') {
        if (this.mode === 'market') return recurso || 'shop';
        return `shops/${this.shopId}/${recurso}`.replace(/\/$/, '');
    }

    async paginar(recurso, query = {}, { maxPaginas = 50 } = {}) {
        const acumulado = [];
        let pagina = Math.max(1, Number(query.page) || 1);

        for (let i = 0; i < maxPaginas; i += 1) {
            const respuesta = await this.request(this.ruta(recurso), {
                query: { ...query, page: pagina, perPage: Math.min(Number(query.perPage) || 100, 100) }
            });
            const datos = Array.isArray(respuesta) ? respuesta : respuesta?.data ?? [];
            acumulado.push(...datos);

            const ultima = Number(respuesta?.last_page ?? respuesta?.lastPage ?? pagina);
            if (pagina >= ultima || !datos.length) break;
            pagina += 1;
        }

        return acumulado;
    }

    listarProductos(query = {}) { return this.request(this.ruta('products'), { query }); }
    todosLosProductos() {
        return this.paginar('products', { perPage: 100, orderColumn: 'id', orderDirection: 'asc' });
    }
    obtenerProducto(productId) { return this.request(this.ruta(`products/${encodeURIComponent(productId)}`)); }
    listarFacturas(query = {}) { return this.request(this.ruta('invoices'), { query }); }
    obtenerFactura(invoiceId) { return this.request(this.ruta(`invoices/${encodeURIComponent(invoiceId)}`)); }
    listarResenas(query = {}) { return this.request(this.ruta('feedbacks'), { query }); }
    obtenerResena(feedbackId) { return this.request(this.ruta(`feedbacks/${encodeURIComponent(feedbackId)}`)); }
    estadisticasResenas(query = {}) { return this.request(this.ruta('feedbacks/stats'), { query }); }
    obtenerTienda() { return this.request(this.ruta()); }

    async crearEnlaceFactura(invoiceId) {
        if (this.mode !== 'market') return '';
        const datos = await this.request(`order-link/${encodeURIComponent(invoiceId)}`);
        return /^https:\/\//i.test(String(datos?.url ?? '')) ? String(datos.url) : '';
    }
}

module.exports = { SellAuthClient, SellAuthError, objetoConsulta };
