'use strict';

const {
    ContainerBuilder,
    TextDisplayBuilder
} = require('discord.js');

const config = require('../utils/config');
const Database = require('../utils/jsonDatabase');
const logger = require('../utils/logger');
const ui = require('../utils/ui');

const SERVICE_ORDER = ['website', 'products', 'bot', 'tickets', 'vouches'];
const PAYMENT_ORDER = ['paypal', 'bitcoin', 'litecoin'];

const DEFAULT_DEFINITIONS = {
    website: { label: 'Website', emoji: 'world', kind: 'service' },
    products: { label: 'Product Catalog', emoji: 'producto', kind: 'service' },
    bot: { label: 'Discord Bot', emoji: 'bots', kind: 'service' },
    tickets: { label: 'Ticket System', emoji: 'ticket', kind: 'service' },
    vouches: { label: 'Vouch System', emoji: 'valoracion', kind: 'service' },
    paypal: { label: 'PayPal', emoji: 'wallet', kind: 'payment', types: ['PAYPAL', 'PAYPALFF'] },
    bitcoin: { label: 'Bitcoin (BTC)', emoji: 'wallet', kind: 'payment', types: ['BTC'] },
    litecoin: { label: 'Litecoin (LTC)', emoji: 'wallet', kind: 'payment', types: ['LTC'] }
};

const ESQUEMA = {
    overrides: {},
    paneles: {},
    lastCheckedAt: 0,
    changedBy: null,
    changedAt: null
};

function normalizarLista(respuesta) {
    if (Array.isArray(respuesta)) return respuesta;
    if (Array.isArray(respuesta?.data)) return respuesta.data;
    if (Array.isArray(respuesta?.payment_methods)) return respuesta.payment_methods;
    if (Array.isArray(respuesta?.paymentMethods)) return respuesta.paymentMethods;
    return [];
}

function activoMetodo(metodo) {
    for (const key of ['is_active', 'enabled', 'active']) {
        const value = metodo?.[key];
        if (value === undefined || value === null) continue;
        if (value === false || value === 0 || value === '0') return false;
        return true;
    }
    return true;
}

class StatusSystem {
    constructor(client, emojis) {
        this.client = client;
        this.emojis = emojis;
        this.db = new Database('status', ESQUEMA);
        this.timer = null;
        this.refreshing = null;
        this.snapshotCache = null;
        this.snapshotCacheAt = 0;
    }

    get config() {
        return config.cargar('status');
    }

    definition(key) {
        const base = DEFAULT_DEFINITIONS[key] ?? { label: key, emoji: 'info', kind: 'service' };
        const custom = this.config.services?.[key] ?? this.config.payments?.[key] ?? {};
        return { ...base, ...custom };
    }

    keys() {
        return [...SERVICE_ORDER, ...PAYMENT_ORDER];
    }

    isEnabled() {
        return this.config.enabled !== false;
    }

    iniciar() {
        if (!this.isEnabled() || this.timer) return false;

        const interval = Math.max(30_000, Number(this.config.refreshIntervalMs) || 60_000);
        this.timer = setInterval(() => {
            if (!Object.keys(this.db.data.paneles).length) return;
            this.refrescarPaneles({ force: true }).catch(error =>
                logger.error('status', `Automatic status refresh failed: ${error.message}`)
            );
        }, interval);
        this.timer.unref?.();

        logger.detalle(`Service status auto-refresh enabled every ${Math.round(interval / 1000)}s.`);
        return true;
    }

    detener() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    override(key) {
        const value = this.db.data.overrides?.[key];
        return value?.mode === 'maintenance' ? value : null;
    }

    estadoConOverride(key, automatic) {
        const manual = this.override(key);
        if (!manual) return automatic;

        return {
            state: 'maintenance',
            detail: manual.note?.trim()
                ? `Manual maintenance · ${ui.plano(manual.note).replace(/\n/g, ' / ')}`
                : 'Temporarily under maintenance by the Spotify Market team.',
            source: 'manual'
        };
    }

    async comprobarWeb() {
        const rawUrl = process.env.STATUS_WEBSITE_URL?.trim()
            || this.config.website?.url?.trim()
            || config.cargar('brand').enlaces?.web?.trim()
            || config.cargar('sellauth').storefrontUrl?.trim();

        if (!rawUrl) {
            return { state: 'offline', detail: 'Website URL is not configured.', source: 'automatic' };
        }

        const timeoutMs = Math.max(1500, Number(this.config.website?.timeoutMs) || 6000);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        timeout.unref?.();
        const started = Date.now();

        try {
            const response = await fetch(rawUrl, {
                method: 'GET',
                redirect: 'follow',
                signal: controller.signal,
                headers: { 'User-Agent': 'SpotifyMarket-Status/1.0' }
            });
            const latency = Date.now() - started;
            const online = response.status >= 200 && response.status < 400;
            await response.body?.cancel().catch(() => {});

            return online
                ? { state: 'operational', detail: `Reachable · ${latency} ms`, source: 'automatic' }
                : { state: 'offline', detail: `HTTP ${response.status} · ${latency} ms`, source: 'automatic' };
        } catch {
            return { state: 'offline', detail: 'Website health check failed.', source: 'automatic' };
        } finally {
            clearTimeout(timeout);
        }
    }

    comprobarProductos() {
        const sellauth = this.client.sistemas?.sellauth;
        if (!sellauth?.estaConfigurado?.()) {
            return { state: 'offline', detail: 'SellAuth catalog connection is unavailable.', source: 'automatic' };
        }

        const initialized = Boolean(sellauth.db?.data?.productosInicializados);
        const lastSync = Number(sellauth.db?.data?.ultimaSincronizacion) || 0;
        const configuredStale = Number(this.config.productSyncStaleAfterMs);
        const syncInterval = Number(config.cargar('sellauth').sync?.intervalMs) || 90_000;
        const staleAfter = Math.max(
            180_000,
            Number.isFinite(configuredStale) && configuredStale > 0 ? configuredStale : syncInterval * 4
        );
        const fresh = initialized && lastSync > 0 && Date.now() - lastSync <= staleAfter;
        const count = sellauth.productosVisibles?.().length ?? 0;

        if (!fresh) {
            return { state: 'offline', detail: 'Product synchronization is stale or unavailable.', source: 'automatic' };
        }

        return {
            state: 'operational',
            detail: `${count} published product${count === 1 ? '' : 's'} · catalog synchronized`,
            source: 'automatic'
        };
    }

    comprobarBot() {
        const healthy = this.client.isReady() && this.client.sistemasListos === true;
        return healthy
            ? { state: 'operational', detail: 'Connected to Discord and processing interactions.', source: 'automatic' }
            : { state: 'offline', detail: 'Discord connection or bot subsystems are not ready.', source: 'automatic' };
    }

    comprobarTickets() {
        const system = this.client.sistemas?.ticket;
        const healthy = Boolean(this.client.isReady() && system?.db?.data);
        const open = healthy ? Object.keys(system.db.data.activos ?? {}).length : 0;

        return healthy
            ? { state: 'operational', detail: `${open} open ticket${open === 1 ? '' : 's'} · support system ready`, source: 'automatic' }
            : { state: 'offline', detail: 'Ticket system is unavailable.', source: 'automatic' };
    }

    async comprobarVouches() {
        const sellauth = this.client.sistemas?.sellauth;
        if (!sellauth?.estaConfigurado?.()) {
            return { state: 'offline', detail: 'SellAuth review verification is unavailable.', source: 'automatic' };
        }

        const channel = await sellauth.canalResenas?.().catch(() => null);
        if (!channel) {
            return { state: 'offline', detail: 'Vouch channel is unavailable or not configured.', source: 'automatic' };
        }

        const total = Object.keys(sellauth.db?.data?.resenas ?? {}).length;
        return {
            state: 'operational',
            detail: `${total} verified vouch${total === 1 ? '' : 'es'} tracked · verification ready`,
            source: 'automatic'
        };
    }

    async comprobarPagos() {
        const sellauth = this.client.sistemas?.sellauth;
        const result = {};

        if (!sellauth?.estaConfigurado?.()) {
            for (const key of PAYMENT_ORDER) {
                result[key] = { state: 'offline', detail: 'SellAuth payment API is unavailable.', source: 'automatic' };
            }
            return result;
        }

        let methods;
        try {
            methods = normalizarLista(await sellauth.api.listarMetodosPago());
        } catch (error) {
            logger.warn('status', `Payment method check failed: ${error.message}`);
            for (const key of PAYMENT_ORDER) {
                result[key] = { state: 'offline', detail: 'Payment method check failed.', source: 'automatic' };
            }
            return result;
        }

        for (const key of PAYMENT_ORDER) {
            const definition = this.definition(key);
            const types = new Set((definition.types ?? []).map(type => String(type).toUpperCase()));
            const matching = methods.filter(method =>
                types.has(String(method?.type ?? method?.gateway ?? '').toUpperCase())
            );
            const available = matching.some(activoMetodo);

            result[key] = available
                ? { state: 'operational', detail: 'Enabled and available at checkout.', source: 'automatic' }
                : matching.length
                    ? { state: 'offline', detail: 'Currently disabled at checkout.', source: 'automatic' }
                    : { state: 'offline', detail: 'Not currently configured at checkout.', source: 'automatic' };
        }

        return result;
    }

    async crearSnapshot({ force = false } = {}) {
        const ttl = Math.max(5_000, Number(this.config.cacheTtlMs) || 45_000);
        if (!force && this.snapshotCache && Date.now() - this.snapshotCacheAt < ttl) {
            return this.snapshotCache;
        }

        const [website, vouches, payments] = await Promise.all([
            this.comprobarWeb(),
            this.comprobarVouches(),
            this.comprobarPagos()
        ]);

        const automatic = {
            website,
            products: this.comprobarProductos(),
            bot: this.comprobarBot(),
            tickets: this.comprobarTickets(),
            vouches,
            ...payments
        };

        const services = {};
        for (const key of this.keys()) {
            services[key] = this.estadoConOverride(key, automatic[key]);
        }

        const checkedAt = Date.now();
        const snapshot = { checkedAt, services };
        this.snapshotCache = snapshot;
        this.snapshotCacheAt = checkedAt;
        this.db.data.lastCheckedAt = checkedAt;
        this.db.save();
        return snapshot;
    }

    statusMeta(state, kind = 'service') {
        if (state === 'maintenance') {
            return {
                label: 'MAINTENANCE',
                emoji: this.emojis.get('update') || this.emojis.rol('cargando')
            };
        }
        if (state === 'operational') {
            return {
                label: kind === 'payment' ? 'AVAILABLE' : 'ONLINE',
                emoji: this.emojis.get('success') || this.emojis.rol('exito')
            };
        }
        return {
            label: kind === 'payment' ? 'UNAVAILABLE' : 'OFFLINE',
            emoji: this.emojis.get('error') || this.emojis.rol('error')
        };
    }

    serviceEmoji(definition) {
        return this.emojis.rol(definition.emoji) || this.emojis.get(definition.emoji);
    }

    line(key, status) {
        const definition = this.definition(key);
        const state = this.statusMeta(status.state, definition.kind);
        const icon = this.serviceEmoji(definition);
        return `${icon} **${definition.label}**  ${state.emoji} \`${state.label}\`\n` +
            `-# ${status.detail}`;
    }

    summary(snapshot) {
        const states = Object.values(snapshot.services).map(item => item.state);
        const offline = states.filter(state => state === 'offline').length;
        const maintenance = states.filter(state => state === 'maintenance').length;

        if (offline) {
            return {
                emoji: this.emojis.get('error') || this.emojis.rol('error'),
                title: 'Service disruption detected',
                detail: `${offline} component${offline === 1 ? '' : 's'} currently unavailable.`
            };
        }
        if (maintenance) {
            return {
                emoji: this.emojis.get('update') || this.emojis.rol('cargando'),
                title: 'Maintenance in progress',
                detail: `${maintenance} component${maintenance === 1 ? '' : 's'} temporarily under maintenance.`
            };
        }
        return {
            emoji: this.emojis.get('success') || this.emojis.rol('exito'),
            title: 'All systems operational',
            detail: 'Store services and configured payment methods are available.'
        };
    }

    construirPanel(snapshot) {
        const cfg = this.config;
        const summary = this.summary(snapshot);
        const interval = Math.max(30_000, Number(cfg.refreshIntervalMs) || 60_000);

        const core = SERVICE_ORDER
            .map(key => this.line(key, snapshot.services[key]))
            .join('\n\n');
        const payments = PAYMENT_ORDER
            .map(key => this.line(key, snapshot.services[key]))
            .join('\n\n');

        const c = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `## ${this.emojis.get('world') || this.emojis.rol('world')} ${cfg.title || 'Spotify Market · Service Status'}\n` +
                `> ${cfg.description || 'Live availability for our storefront, customer systems and payment methods.'}`
            ))
            .addSeparatorComponents(ui.linea())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### ${this.emojis.get('bots') || this.emojis.rol('info')} Core Services\n${core}`
            ))
            .addSeparatorComponents(ui.linea())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### ${this.emojis.get('wallet') || this.emojis.rol('wallet')} Payment Methods\n${payments}`
            ))
            .addSeparatorComponents(ui.linea())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `${summary.emoji} **${summary.title}**\n` +
                `> ${summary.detail}\n` +
                `-# Live checks every ${Math.round(interval / 1000)}s · Last checked ${ui.fecha(snapshot.checkedAt, 'R')}`
            ));

        return {
            components: [c],
            flags: ui.V2,
            allowedMentions: { parse: [] }
        };
    }

    async publicarPanel(channel) {
        const snapshot = await this.crearSnapshot({ force: true });
        const previousId = this.db.data.paneles[channel.id];

        if (previousId) {
            const previous = await channel.messages.fetch(previousId).catch(() => null);
            if (previous) {
                await previous.edit({ ...this.construirPanel(snapshot), attachments: [] });
                return previous;
            }
        }

        const message = await channel.send(this.construirPanel(snapshot));
        this.db.data.paneles[channel.id] = message.id;
        this.db.save();
        return message;
    }

    async refrescarPaneles({ force = false } = {}) {
        if (this.refreshing) return this.refreshing;

        this.refreshing = (async () => {
            const entries = Object.entries({ ...this.db.data.paneles });
            if (!entries.length) return 0;

            const snapshot = await this.crearSnapshot({ force });
            let updated = 0;

            for (const [channelId, messageId] of entries) {
                const channel = await this.client.channels.fetch(channelId).catch(() => null);
                const message = channel?.isTextBased?.()
                    ? await channel.messages.fetch(messageId).catch(() => null)
                    : null;

                if (!message) {
                    delete this.db.data.paneles[channelId];
                    this.db.save();
                    continue;
                }

                try {
                    await message.edit({ ...this.construirPanel(snapshot), attachments: [] });
                    updated += 1;
                } catch (error) {
                    logger.error('status', `Could not refresh status panel in ${channelId}: ${error.message}`);
                }
            }

            return updated;
        })();

        try {
            return await this.refreshing;
        } finally {
            this.refreshing = null;
        }
    }

    async setOverride(key, mode, userId, note = '') {
        if (!this.keys().includes(key)) return null;
        if (!['automatic', 'maintenance'].includes(mode)) return null;

        if (mode === 'automatic') {
            delete this.db.data.overrides[key];
        } else {
            this.db.data.overrides[key] = {
                mode: 'maintenance',
                note: String(note || '').trim().slice(0, 180),
                userId,
                changedAt: Date.now()
            };
        }

        this.db.data.changedBy = userId;
        this.db.data.changedAt = Date.now();
        this.db.flush();
        this.snapshotCache = null;
        this.snapshotCacheAt = 0;

        await this.refrescarPaneles({ force: true });
        return this.definition(key);
    }

    async resetOverrides(userId) {
        this.db.data.overrides = {};
        this.db.data.changedBy = userId;
        this.db.data.changedAt = Date.now();
        this.db.flush();
        this.snapshotCache = null;
        this.snapshotCacheAt = 0;
        await this.refrescarPaneles({ force: true });
    }

    construirConfigPanel() {
        const lines = this.keys().map(key => {
            const definition = this.definition(key);
            const manual = this.override(key);
            const icon = this.serviceEmoji(definition);
            const mode = manual ? '`MAINTENANCE`' : '`AUTOMATIC`';
            const note = manual?.note ? ` · ${ui.plano(manual.note)}` : '';
            return `${icon} **${definition.label}** · ${mode}${note}`;
        }).join('\n');

        return new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `## ${this.emojis.get('update') || this.emojis.rol('actualizar')} Status Configuration\n` +
                '> Automatic mode uses live health checks. Maintenance mode always overrides the automatic result.'
            ))
            .addSeparatorComponents(ui.linea())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines))
            .addSeparatorComponents(ui.linea())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                '-# Use `/config-status set` to change one component, or `/config-status reset` to return everything to automatic checks.'
            ));
    }
}

module.exports = StatusSystem;
module.exports.SERVICE_ORDER = SERVICE_ORDER;
module.exports.PAYMENT_ORDER = PAYMENT_ORDER;
module.exports.DEFAULT_DEFINITIONS = DEFAULT_DEFINITIONS;
