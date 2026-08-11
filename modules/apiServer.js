'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { ChannelType } = require('discord.js');

const logger = require('../utils/logger');
const config = require('../utils/config');
const permisos = require('../utils/permisos');
const constructor = require('../utils/constructorV2');
const validacionConfig = require('../utils/validacionConfig');
const { aplicarPresencia } = require('../utils/presencia');

/**
 * API local que consume el dashboard.
 *
 * Escucha solo en la interfaz de loopback y exige un token: el dashboard la
 * llama desde su servidor, nunca desde el navegador, asi el token no llega al
 * cliente y no hace falta CORS.
 *
 * Toda escritura de configuracion pasa por aqui, no por el disco: el bot
 * cachea los config en memoria y editar el archivo por debajo dejaria las dos
 * vistas descoordinadas.
 */

const PUERTO_POR_DEFECTO = 8787;
const HOST_POR_DEFECTO = '127.0.0.1';
const MAX_CUERPO_BYTES = 512 * 1024;

/** Solo estos archivos se pueden leer y escribir. Cierra el paso a ../ */
const CONFIGS = new Set([
    'bot', 'brand', 'emojis', 'permissions', 'tickets', 'verify', 'welcome', 'rules', 'logs', 'moderacion', 'shop',
    'status', 'suggestions'
]);

class ApiServer {
    constructor(client, emojis) {
        this.client = client;
        this.emojis = emojis;
        this.servidor = null;

        this.token = process.env.DASHBOARD_TOKEN?.trim() ?? '';
        this.puerto = Number(process.env.DASHBOARD_API_PORT) || PUERTO_POR_DEFECTO;
        this.host = process.env.DASHBOARD_API_HOST?.trim() || HOST_POR_DEFECTO;

    }

    iniciar() {
        if (!this.token) {
            logger.warn('api', 'Sin DASHBOARD_TOKEN en el .env: la API no arranca.');
            logger.detalle('el dashboard no podra conectarse hasta que lo definas');
            return false;
        }

        if (this.token.length < 32) {
            logger.warn('api', 'DASHBOARD_TOKEN es corto: usa al menos 32 caracteres aleatorios.');
        }

        this.servidor = http.createServer((peticion, respuesta) => {
            this.atender(peticion, respuesta).catch(error => {
                logger.traza('api', error);
                if (!respuesta.headersSent) this.responder(respuesta, 500, { error: 'Error interno' });
                else respuesta.end();
            });
        });
        this.servidor.requestTimeout = 15000;
        this.servidor.headersTimeout = 10000;
        this.servidor.keepAliveTimeout = 5000;

        this.servidor.listen(this.puerto, this.host, () => {
            logger.paso('api', `escuchando en ${this.host}:${this.puerto}`);
        });

        this.servidor.on('error', error => {
            logger.error('api', error.code === 'EADDRINUSE'
                ? `El puerto ${this.puerto} ya esta ocupado.`
                : error.message);
        });

        return true;
    }

    detener() {
        this.servidor?.close();
    }

    // ------------------------------------------------------------ utilidades

    responder(respuesta, codigo, datos) {
        const cuerpo = JSON.stringify(datos);
        respuesta.writeHead(codigo, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(cuerpo),
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff'
        });
        respuesta.end(cuerpo);
    }

    /** Comparacion en tiempo constante: un === filtra la longitud del token. */
    autorizado(peticion) {
        const cabecera = peticion.headers.authorization ?? '';
        const recibido = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : '';

        const a = Buffer.from(recibido);
        const b = Buffer.from(this.token);

        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
    }

    leerCuerpo(peticion) {
        return new Promise((resolver, rechazar) => {
            const trozos = [];
            let total = 0;

            peticion.on('data', trozo => {
                total += trozo.length;
                if (total > MAX_CUERPO_BYTES) {
                    rechazar(new Error('El cuerpo de la peticion es demasiado grande'));
                    peticion.destroy();
                    return;
                }
                trozos.push(trozo);
            });

            peticion.on('end', () => {
                if (!trozos.length) return resolver({});
                try {
                    resolver(JSON.parse(Buffer.concat(trozos).toString('utf8')));
                } catch {
                    rechazar(new Error('El cuerpo no es JSON valido'));
                }
            });

            peticion.on('error', rechazar);
        });
    }

    // -------------------------------------------------------------- enrutado

    async atender(peticion, respuesta) {
        if (!['GET', 'POST', 'PUT', 'DELETE'].includes(peticion.method)) {
            return this.responder(respuesta, 405, { error: 'Metodo no permitido' });
        }
        if (!this.autorizado(peticion)) {
            return this.responder(respuesta, 401, { error: 'No autorizado' });
        }

        const url = new URL(peticion.url, `http://${this.host}`);
        const partes = url.pathname.split('/').filter(Boolean);

        if (partes[0] !== 'api') {
            return this.responder(respuesta, 404, { error: 'Ruta desconocida' });
        }

        const [, recurso, parametro] = partes;
        const metodo = peticion.method;

        let cuerpo = {};
        if (metodo === 'POST' || metodo === 'PUT') {
            try {
                cuerpo = await this.leerCuerpo(peticion);
            } catch (error) {
                return this.responder(respuesta, 400, { error: error.message });
            }
        }

        switch (`${metodo} ${recurso}`) {
            case 'GET estado':
                return this.responder(respuesta, 200, this.estado());

            case 'GET config':
                return parametro
                    ? this.leerConfig(respuesta, parametro)
                    : this.responder(respuesta, 200, { archivos: [...CONFIGS] });

            case 'PUT config':
                return this.escribirConfig(respuesta, parametro, cuerpo);

            case 'GET acceso':
                return this.acceso(respuesta, parametro);

            case 'GET recursos':
                return this.recursos(respuesta);

            case 'GET tickets':
                return this.responder(respuesta, 200, this.tickets());

            case 'GET moderacion':
                return this.responder(respuesta, 200, this.moderacion());

            case 'GET emojis':
                return this.responder(respuesta, 200, { emojis: this.emojis.all() });

            case 'GET productos':
                return this.responder(respuesta, 200, {
                    productos: Object.values(this.client.sistemas.shop.db.data.productos)
                });

            case 'POST productos':
                return this.crearProducto(respuesta, cuerpo);

            case 'PUT productos':
                return this.editarProducto(respuesta, parametro, cuerpo);

            case 'DELETE productos':
                return this.borrarProducto(respuesta, parametro);

            case 'POST anuncio':
                return parametro === 'validar'
                    ? this.validarAnuncio(respuesta, cuerpo)
                    : this.enviarAnuncio(respuesta, cuerpo);

            case 'POST paneles':
                return this.publicarPanel(respuesta, parametro, cuerpo);

            case 'POST control':
                return this.control(respuesta, parametro);

            default:
                return this.responder(respuesta, 404, { error: 'Ruta desconocida' });
        }
    }

    // --------------------------------------------------------------- estado

    estado() {
        const tickets = this.client.sistemas.ticket.db.data;
        const productos = this.client.sistemas.shop.db.data.productos;
        const revisiones = validacionConfig.validarTodo();

        return {
            bot: {
                tag: this.client.user?.tag ?? null,
                id: this.client.user?.id ?? null,
                servidores: this.client.guilds.cache.size,
                comandos: this.client.commands.size,
                latenciaMs: Math.round(this.client.ws.ping),
                enPieDesdeMs: this.client.uptime
            },
            tickets: {
                abiertos: Object.keys(tickets.activos).length,
                cerrados: Object.keys(tickets.archivados).length,
                valoraciones: tickets.valoraciones.length,
                valoracionMedia: tickets.valoraciones.length
                    ? Number((tickets.valoraciones.reduce((n, v) => n + v.estrellas, 0) / tickets.valoraciones.length).toFixed(2))
                    : null
            },
            catalogo: {
                total: Object.keys(productos).length,
                visibles: Object.values(productos).filter(p => p.visible).length
            },
            emojis: Object.keys(this.emojis.all()).length,
            configuracion: {
                errores: revisiones.reduce((total, revision) => total + revision.errores.length, 0),
                avisos: revisiones.reduce((total, revision) => total + revision.avisos.length, 0)
            }
        };
    }

    tickets() {
        const datos = this.client.sistemas.ticket.db.data;
        const normalizar = ticket => ({
            id: ticket.id,
            canalId: ticket.canalId,
            userId: ticket.userId,
            avatarUrl: ticket.avatarUrl ?? null,
            categoria: ticket.categoria,
            prioridad: ticket.prioridad,
            respuestas: ticket.respuestas ?? {},
            abiertoEn: ticket.abiertoEn,
            ultimaActividad: ticket.ultimaActividad,
            reclamadoPor: ticket.reclamadoPor ?? null,
            estado: ticket.estado,
            cerradoEn: ticket.cerradoEn ?? null,
            cerradoPor: ticket.cerradoPor ?? null,
            motivoCierre: ticket.motivoCierre ?? null,
            valoracion: ticket.valoracion ?? null
        });

        return {
            activos: Object.values(datos.activos).map(normalizar).sort((a, b) => b.abiertoEn - a.abiertoEn),
            archivados: Object.values(datos.archivados).map(normalizar).sort((a, b) => (b.cerradoEn ?? 0) - (a.cerradoEn ?? 0)),
            valoraciones: [...datos.valoraciones].sort((a, b) => b.fecha - a.fecha)
        };
    }

    moderacion() {
        const avisosPorUsuario = this.client.sistemas.mod.db.data.avisos;
        const avisos = Object.entries(avisosPorUsuario)
            .flatMap(([userId, lista]) => lista.map(aviso => ({ userId, ...aviso })))
            .sort((a, b) => b.fecha - a.fecha);

        return {
            avisos,
            activos: avisos.filter(aviso => aviso.activo).length,
            usuarios: Object.keys(avisosPorUsuario).length
        };
    }

    // --------------------------------------------------------------- config

    leerConfig(respuesta, nombre) {
        if (!CONFIGS.has(nombre)) {
            return this.responder(respuesta, 404, { error: `'${nombre}' no es un archivo de configuracion` });
        }
        return this.responder(respuesta, 200, { nombre, datos: config.cargar(nombre) });
    }

    escribirConfig(respuesta, nombre, cuerpo) {
        if (!CONFIGS.has(nombre)) {
            return this.responder(respuesta, 404, { error: `'${nombre}' no es un archivo de configuracion` });
        }

        const datos = cuerpo?.datos;
        if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
            return this.responder(respuesta, 400, { error: 'Se esperaba { datos: { ... } }' });
        }

        const revision = validacionConfig.validar(nombre, datos);
        if (!revision.ok) {
            return this.responder(respuesta, 400, {
                error: 'La configuracion contiene valores invalidos.',
                problemas: revision.errores,
                avisos: revision.avisos
            });
        }

        // Guardar refresca la cache, asi que los sistemas ven el cambio en la
        // siguiente lectura sin reiniciar nada.
        config.guardar(nombre, datos);
        logger.info('api', `config/${nombre}.json actualizado desde el dashboard`);

        if (nombre === 'bot') aplicarPresencia(this.client);

        return this.responder(respuesta, 200, { nombre, datos, avisos: revision.avisos });
    }

    // --------------------------------------------------------------- control

    async control(respuesta, accion) {
        if (accion === 'presencia') {
            return this.responder(respuesta, 200, aplicarPresencia(this.client));
        }

        if (accion === 'comandos') {
            try {
                const total = await this.client.desplegarComandos();
                logger.info('api', `${total} comandos sincronizados desde el dashboard`);
                return this.responder(respuesta, 200, { accion, total });
            } catch (error) {
                return this.responder(respuesta, 502, { error: `Discord rechazo la sincronizacion: ${error.message}` });
            }
        }

        if (accion === 'emojis') {
            try {
                const resultado = await this.emojis.sync();
                logger.info('api', 'Emojis sincronizados desde el dashboard');
                return this.responder(respuesta, 200, { accion, ...resultado });
            } catch (error) {
                return this.responder(respuesta, 502, { error: `No se pudieron sincronizar los emojis: ${error.message}` });
            }
        }

        return this.responder(respuesta, 404, { error: 'Accion de control desconocida' });
    }

    // --------------------------------------------------------------- acceso

    /**
     * Nivel de staff de un usuario, para que el dashboard decida si le deja
     * entrar.
     *
     * Lo resuelve el bot y no el dashboard: aqui ya estan la cache de miembros
     * y permissions.json, asi la regla vive en un solo sitio y el dashboard se
     * ahorra pedir el scope guilds.members.read en el OAuth.
     */
    async acceso(respuesta, userId) {
        if (!userId) return this.responder(respuesta, 400, { error: 'Falta el id de usuario' });

        const guild = this.guildObjetivo();
        if (!guild) return this.responder(respuesta, 503, { error: 'El bot no esta en ningun servidor' });

        const miembro = await guild.members.fetch(userId).catch(() => null);
        if (!miembro) {
            return this.responder(respuesta, 200, {
                permitido: false, nivel: 0, esDueno: false, motivo: 'No esta en el servidor'
            });
        }

        const nivel = permisos.nivelDe(miembro);
        const esDueno = guild.ownerId === userId;
        const nivelMinimo = Number(process.env.DASHBOARD_NIVEL_MINIMO) || 5;

        return this.responder(respuesta, 200, {
            permitido: esDueno || nivel >= nivelMinimo,
            nivel,
            esDueno,
            nivelMinimo,
            nombre: miembro.displayName,
            motivo: null
        });
    }

    // ------------------------------------------------------------- recursos

    async recursos(respuesta) {
        const guild = this.guildObjetivo();
        if (!guild) {
            return this.responder(respuesta, 503, { error: 'El bot no esta en ningun servidor' });
        }

        const canales = guild.channels.cache;

        return this.responder(respuesta, 200, {
            servidor: { id: guild.id, nombre: guild.name, miembros: guild.memberCount },
            canalesTexto: canales
                .filter(c => c.type === ChannelType.GuildText)
                .map(c => ({ id: c.id, nombre: c.name, categoriaId: c.parentId }))
                .sort((a, b) => a.nombre.localeCompare(b.nombre)),
            categorias: canales
                .filter(c => c.type === ChannelType.GuildCategory)
                .map(c => ({ id: c.id, nombre: c.name }))
                .sort((a, b) => a.nombre.localeCompare(b.nombre)),
            roles: guild.roles.cache
                .filter(r => r.id !== guild.id)
                .map(r => ({ id: r.id, nombre: r.name, posicion: r.position }))
                .sort((a, b) => b.posicion - a.posicion)
        });
    }

    // ------------------------------------------------------------ productos

    async crearProducto(respuesta, cuerpo) {
        const problemas = ApiServer.validarProducto(cuerpo);
        if (problemas.length) return this.responder(respuesta, 400, { error: problemas.join(' ') });
        if (!config.cargar('shop').categorias.includes(cuerpo.categoria)) {
            return this.responder(respuesta, 400, { error: 'La categoria no existe en config/shop.json' });
        }

        const producto = await this.client.sistemas.shop.anadir(cuerpo);
        return this.responder(respuesta, 201, { producto });
    }

    async editarProducto(respuesta, id, cuerpo) {
        const actual = this.client.sistemas.shop.db.data.productos[id];
        if (!actual) return this.responder(respuesta, 404, { error: 'Producto no encontrado' });

        const combinado = { ...actual, ...cuerpo };
        const problemas = ApiServer.validarProducto(combinado);
        if (problemas.length) return this.responder(respuesta, 400, { error: problemas.join(' ') });
        if (!config.cargar('shop').categorias.includes(combinado.categoria)) {
            return this.responder(respuesta, 400, { error: 'La categoria no existe en config/shop.json' });
        }

        const producto = await this.client.sistemas.shop.editar(id, cuerpo);
        return this.responder(respuesta, 200, { producto });
    }

    async borrarProducto(respuesta, id) {
        const producto = await this.client.sistemas.shop.eliminar(id);
        return producto
            ? this.responder(respuesta, 200, { producto })
            : this.responder(respuesta, 404, { error: 'Producto no encontrado' });
    }

    static validarProducto(p) {
        const problemas = [];

        if (!p?.nombre?.trim()) problemas.push('Falta el nombre.');
        else if (p.nombre.trim().length > 80) problemas.push('El nombre supera 80 caracteres.');
        if (!p?.descripcion?.trim()) problemas.push('Falta la descripcion.');
        else if (p.descripcion.trim().length > 800) problemas.push('La descripcion supera 800 caracteres.');
        if (typeof p?.precio !== 'number' || !Number.isFinite(p.precio) || p.precio < 0) {
            problemas.push('El precio tiene que ser un numero positivo.');
        }
        if (!Number.isInteger(p?.stock) || p.stock < -1) {
            problemas.push('El stock tiene que ser un entero, o -1 para sin limite.');
        }
        if (!p?.categoria?.trim()) problemas.push('Falta la categoria.');
        if (p?.imagen && !/^https:\/\/\S+$/i.test(p.imagen)) problemas.push('La imagen tiene que ser una URL https.');

        return problemas;
    }

    // -------------------------------------------------------------- anuncios

    validarAnuncio(respuesta, cuerpo) {
        const problemas = constructor.validar(cuerpo?.bloques);
        return this.responder(respuesta, 200, { ok: problemas.length === 0, problemas });
    }

    async enviarAnuncio(respuesta, cuerpo) {
        const { canalId, bloques, mencion } = cuerpo ?? {};

        if (!canalId) return this.responder(respuesta, 400, { error: 'Falta canalId' });

        const preparado = constructor.preparar(bloques, this.emojis);
        if (!preparado.ok) {
            return this.responder(respuesta, 400, { error: 'El anuncio no es valido', problemas: preparado.problemas });
        }

        const canal = await this.client.channels.fetch(canalId).catch(() => null);
        if (!canal?.isTextBased?.()) return this.responder(respuesta, 404, { error: 'Canal de texto no encontrado' });

        // Las menciones se activan solo si se piden explicitamente: un anuncio
        // que arrastre un @everyone sin querer no tiene vuelta atras.
        const allowedMentions = mencion === 'everyone'
            ? { parse: ['everyone'] }
            : mencion === 'roles'
                ? { parse: ['roles'] }
                : { parse: [] };

        try {
            const mensaje = await canal.send({ ...preparado.carga, allowedMentions });
            logger.info('api', `Anuncio enviado a #${canal.name}`);

            return this.responder(respuesta, 200, {
                mensajeId: mensaje.id,
                url: mensaje.url
            });
        } catch (error) {
            return this.responder(respuesta, 502, { error: `Discord rechazo el envio: ${error.message}` });
        }
    }

    // --------------------------------------------------------------- paneles

    async publicarPanel(respuesta, tipo, cuerpo) {
        const sistemas = {
            tickets: 'ticket',
            verificacion: 'verify',
            catalogo: 'shop',
            normas: 'rules',
            estado: 'status',
            sugerencias: 'suggest'
        };
        const sistema = this.client.sistemas[sistemas[tipo]];

        if (!sistema) return this.responder(respuesta, 404, { error: `Panel '${tipo}' desconocido` });
        if (!cuerpo?.canalId) return this.responder(respuesta, 400, { error: 'Falta canalId' });

        const canal = await this.client.channels.fetch(cuerpo.canalId).catch(() => null);
        if (!canal?.isTextBased?.()) return this.responder(respuesta, 404, { error: 'Canal de texto no encontrado' });

        const mensaje = await sistema.publicarPanel(canal);
        return this.responder(respuesta, 200, { mensajeId: mensaje.id, url: mensaje.url });
    }

    guildObjetivo() {
        const configurado = process.env.GUILD_ID?.trim();
        return configurado
            ? this.client.guilds.cache.get(configurado) ?? null
            : this.client.guilds.cache.first() ?? null;
    }

}

module.exports = ApiServer;
