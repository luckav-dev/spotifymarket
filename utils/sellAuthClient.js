'use strict';

const API_BASE = 'https://api.sellauth.com/v1';
const MAX_RETRIES = 2;

class SellAuthError extends Error {
    constructor(message, { status = 0, body = null, retryAfterMs = 0 } = {}) {
        super(message);
        this.name = 'SellAuthError';
        this.status = status;
        this.body = body;
        this.retryAfterMs = retryAfterMs;
    }
}

function wait(ms) {
    return new Promise(resolve => {
        const timer = setTimeout(resolve, ms);
        timer.unref?.();
    });
}

function queryObject(query = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') continue;
        if (Array.isArray(value)) {
            for (const item of value) params.append(`${key}[]`, String(item));
        } else {
            params.set(key, String(value));
        }
    }
    return params;
}

class SellAuthClient {
    constructor({ apiKey, shopId, baseUrl = API_BASE, timeoutMs = 9000 } = {}) {
        this.apiKey = String(apiKey ?? '').trim();
        this.shopId = String(shopId ?? '').trim();
        this.baseUrl = String(baseUrl || API_BASE).replace(/\/+$/, '');
        this.timeoutMs = timeoutMs;
    }

    configurado() {
        return Boolean(this.apiKey && /^\d+$/.test(this.shopId));
    }

    async request(pathname, { method = 'GET', query, body, attempt = 0, intento } = {}) {
        // Keep backwards compatibility with older internal calls that may pass "intento".
        if (Number.isInteger(intento) && !attempt) attempt = intento;

        if (!this.apiKey) throw new SellAuthError('SELLAUTH_API_KEY is missing from the environment.');
        if (!/^\d+$/.test(this.shopId)) throw new SellAuthError('A valid SELLAUTH_SHOP_ID is missing.');

        const url = new URL(`${this.baseUrl}/${String(pathname).replace(/^\/+/, '')}`);
        for (const [key, value] of queryObject(query)) url.searchParams.append(key, value);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        timer.unref?.();

        let response;
        try {
            response = await fetch(url, {
                method,
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    Accept: 'application/json',
                    ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
                },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: controller.signal
            });
        } catch (error) {
            clearTimeout(timer);
            if (error.name === 'AbortError') {
                throw new SellAuthError(`SellAuth did not respond within ${this.timeoutMs} ms.`);
            }
            throw new SellAuthError(`Could not connect to SellAuth: ${error.message}`);
        }
        clearTimeout(timer);

        const text = await response.text();
        let data = null;
        if (text) {
            try {
                data = JSON.parse(text);
            } catch {
                data = text;
            }
        }

        if (!response.ok) {
            const retryAfter = Number(response.headers.get('retry-after'));
            const retryAfterMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 0;
            const retryable = response.status === 429 || response.status >= 500;

            if (retryable && attempt < MAX_RETRIES) {
                await wait(Math.min(Math.max(retryAfterMs, 750 * (2 ** attempt)), 5000));
                return this.request(pathname, {
                    method,
                    query,
                    body,
                    attempt: attempt + 1
                });
            }

            const detail = data?.message ?? data?.error ?? `HTTP ${response.status}`;
            throw new SellAuthError(`SellAuth rejected the request: ${detail}`, {
                status: response.status,
                body: data,
                retryAfterMs
            });
        }

        return data;
    }

    ruta(resource = '') {
        return `shops/${this.shopId}/${resource}`.replace(/\/$/, '');
    }

    async paginar(resource, query = {}, { maxPaginas = 50 } = {}) {
        const accumulated = [];
        let page = Math.max(1, Number(query.page) || 1);

        for (let i = 0; i < maxPaginas; i += 1) {
            const response = await this.request(this.ruta(resource), {
                query: {
                    ...query,
                    page,
                    perPage: Math.min(Number(query.perPage) || 100, 100)
                }
            });
            const data = Array.isArray(response) ? response : response?.data ?? [];
            accumulated.push(...data);

            const last = Number(response?.last_page ?? response?.lastPage ?? page);
            if (page >= last || !data.length) break;
            page += 1;
        }

        return accumulated;
    }

    listarProductos(query = {}) {
        return this.request(this.ruta('products'), { query });
    }

    todosLosProductos() {
        return this.paginar('products', {
            perPage: 100,
            orderColumn: 'id',
            orderDirection: 'asc'
        });
    }

    obtenerProducto(productId) {
        return this.request(this.ruta(`products/${encodeURIComponent(productId)}`));
    }

    listarFacturas(query = {}) {
        return this.request(this.ruta('invoices'), { query });
    }

    obtenerFactura(invoiceId) {
        return this.request(this.ruta(`invoices/${encodeURIComponent(invoiceId)}`));
    }

    listarResenas(query = {}) {
        return this.request(this.ruta('feedbacks'), { query });
    }

    obtenerResena(feedbackId) {
        return this.request(this.ruta(`feedbacks/${encodeURIComponent(feedbackId)}`));
    }

    estadisticasResenas(query = {}) {
        return this.request(this.ruta('feedbacks/stats'), { query });
    }

    listarMetodosPago() {
        return this.request(this.ruta('payment-methods'));
    }

    obtenerTienda() {
        return this.request(this.ruta());
    }
}

module.exports = {
    SellAuthClient,
    SellAuthError,
    objetoConsulta: queryObject,
    queryObject
};
