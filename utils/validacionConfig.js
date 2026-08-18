'use strict';

const fs = require('node:fs');
const path = require('node:path');

const config = require('./config');

const RAIZ = path.resolve(__dirname, '..');
const ID = /^\d{17,20}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const CUSTOM_ID = /^[\w-]{1,100}$/;

function objeto(valor) {
    return Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
}

function texto(valor) {
    return typeof valor === 'string' && valor.trim().length > 0;
}

function resultado(nombre) {
    const errores = [];
    const avisos = [];
    return {
        nombre,
        errores,
        avisos,
        error(condicion, mensaje) {
            if (condicion) errores.push(mensaje);
        },
        aviso(condicion, mensaje) {
            if (condicion) avisos.push(mensaje);
        }
    };
}

function validarId(r, valor, nombre, { obligatorio = false } = {}) {
    if (!valor) {
        r.aviso(obligatorio, `${nombre} esta vacio.`);
        return;
    }
    r.error(typeof valor !== 'string' || !ID.test(valor), `${nombre} no parece un ID de Discord valido.`);
}

function validarPanel(r, panel, nombre = 'panel') {
    r.error(!objeto(panel), `${nombre} tiene que ser un objeto.`);
    if (!objeto(panel)) return;
    r.error(!texto(panel.titulo), `${nombre}.titulo es obligatorio.`);
    r.error(panel.titulo?.length > 180, `${nombre}.titulo supera 180 caracteres.`);
    r.error(panel.descripcion !== undefined && typeof panel.descripcion !== 'string', `${nombre}.descripcion tiene que ser texto.`);
}

function validarMedia(r, valor, nombre) {
    if (!valor) return;
    const origen = config.cargar('brand').assets?.[valor] ?? valor;
    if (/^https:\/\//i.test(origen)) return;

    const absoluta = path.resolve(RAIZ, String(origen));
    const assets = path.join(RAIZ, 'assets');
    const relativa = path.relative(assets, absoluta);
    r.error(relativa.startsWith('..') || path.isAbsolute(relativa), `${nombre} debe estar dentro de assets/ o ser una URL https.`);
    r.error(!fs.existsSync(absoluta), `${nombre} apunta a un archivo que no existe: ${origen}`);
    if (fs.existsSync(absoluta)) {
        r.error(fs.statSync(absoluta).size > 10 * 1024 * 1024,
            `${nombre} supera 10 MiB y no se puede adjuntar en un servidor sin un limite ampliado.`);
    }
}

function validarBot(datos, r) {
    r.error(!Array.isArray(datos.intents) || !datos.intents.length, 'intents tiene que ser una lista no vacia.');
    r.error(!objeto(datos.presencia), 'presencia tiene que ser un objeto.');
}

function validarBrand(datos, r) {
    r.error(!texto(datos.nombre), 'nombre es obligatorio.');
    r.error(!objeto(datos.assets), 'assets tiene que ser un objeto.');
    for (const [clave, valor] of Object.entries(datos.assets ?? {})) validarMedia(r, valor, `assets.${clave}`);
    for (const [clave, valor] of Object.entries(datos.enlaces ?? {})) {
        r.error(valor && !/^https:\/\//i.test(valor), `enlaces.${clave} tiene que usar https.`);
    }
}

function validarEmojis(datos, r) {
    r.error(!objeto(datos.roles), 'roles tiene que ser un objeto.');
    for (const [clave, valor] of Object.entries(datos.roles ?? {})) {
        r.error(!texto(valor), `roles.${clave} tiene que apuntar a un nombre de emoji.`);
    }
}

function validarPermissions(datos, r) {
    r.error(!objeto(datos.roles) || !Object.keys(datos.roles ?? {}).length, 'roles tiene que contener al menos un nivel de staff.');
    for (const [clave, rol] of Object.entries(datos.roles ?? {})) {
        r.error(!objeto(rol), `roles.${clave} tiene que ser un objeto.`);
        if (!objeto(rol)) continue;
        validarId(r, rol.roleId, `roles.${clave}.roleId`, { obligatorio: true });
        r.error(!Number.isFinite(rol.nivel) || rol.nivel < 0, `roles.${clave}.nivel tiene que ser un numero positivo.`);
    }
    r.error(!objeto(datos.permisos), 'permisos tiene que ser un objeto.');
    for (const [clave, nivel] of Object.entries(datos.permisos ?? {})) {
        r.error(!Number.isFinite(nivel) || nivel < 0, `permisos.${clave} tiene que ser un numero positivo.`);
    }
}

function validarTickets(datos, r) {
    validarPanel(r, datos.panel);
    validarMedia(r, datos.panel?.banner ?? datos.panel?.bannerUrl, 'panel.banner');

    const categorias = datos.categorias;
    r.error(!objeto(categorias) || !Object.keys(categorias ?? {}).length, 'categorias tiene que contener al menos una categoria.');
    r.error(Object.keys(categorias ?? {}).length > 25, 'Discord admite como maximo 25 categorias en el selector.');

    const roles = config.cargar('permissions').roles ?? {};
    const prioridades = datos.prioridades ?? {};
    r.error(!objeto(prioridades) || !Object.keys(prioridades).length, 'prioridades tiene que contener al menos una prioridad.');

    let caracteresPanel = String(datos.panel?.titulo ?? '').length
        + String(datos.panel?.subtitulo ?? '').length
        + String(datos.panel?.descripcion ?? '').length
        + String(datos.panel?.nota ?? '').length;
    for (const [clave, categoria] of Object.entries(categorias ?? {})) {
        const base = `categorias.${clave}`;
        r.error(!CUSTOM_ID.test(clave), `${base}: la clave solo puede usar letras, numeros, guion y guion bajo.`);
        r.error(!objeto(categoria), `${base} tiene que ser un objeto.`);
        if (!objeto(categoria)) continue;

        r.error(!texto(categoria.nombre) || categoria.nombre.length > 100, `${base}.nombre es obligatorio y admite hasta 100 caracteres.`);
        r.error(!texto(categoria.descripcion) || categoria.descripcion.length > 100, `${base}.descripcion es obligatoria y admite hasta 100 caracteres.`);
        caracteresPanel += String(categoria.nombre ?? '').length + String(categoria.descripcion ?? '').length + 20;
        validarId(r, categoria.categoriaId, `${base}.categoriaId`, { obligatorio: true });
        r.error(!prioridades[String(categoria.prioridadPorDefecto)], `${base}.prioridadPorDefecto no existe en prioridades.`);
        r.error(!Array.isArray(categoria.rolesPermitidos), `${base}.rolesPermitidos tiene que ser una lista.`);
        for (const rol of categoria.rolesPermitidos ?? []) {
            r.error(!roles[rol], `${base}.rolesPermitidos contiene '${rol}', que no existe en permissions.roles.`);
        }

        const formulario = categoria.formulario;
        r.error(!Array.isArray(formulario), `${base}.formulario tiene que ser una lista.`);
        r.error((formulario?.length ?? 0) > 5, `${base}.formulario supera los 5 campos que admite Discord.`);
        const ids = new Set();
        for (const [indice, campo] of (formulario ?? []).entries()) {
            const campoBase = `${base}.formulario[${indice}]`;
            r.error(!objeto(campo), `${campoBase} tiene que ser un objeto.`);
            if (!objeto(campo)) continue;
            r.error(!CUSTOM_ID.test(campo.id ?? ''), `${campoBase}.id no es valido.`);
            r.error(ids.has(campo.id), `${base}.formulario repite el id '${campo.id}'.`);
            ids.add(campo.id);
            r.error(!texto(campo.etiqueta) || campo.etiqueta.length > 45, `${campoBase}.etiqueta es obligatoria y admite hasta 45 caracteres.`);
            r.error(campo.descripcion !== undefined && (typeof campo.descripcion !== 'string' || campo.descripcion.length > 100),
                `${campoBase}.descripcion admite hasta 100 caracteres.`);
            r.error(!['short', 'paragraph'].includes(campo.estilo), `${campoBase}.estilo debe ser short o paragraph.`);
            r.error(!Number.isInteger(campo.maxLength) || campo.maxLength < 1 || campo.maxLength > 4000, `${campoBase}.maxLength no es valido.`);
        }
    }
    r.error(caracteresPanel > 3000, 'El resumen de categorias hace que el panel público supere el tamaño seguro de Discord.');

    const ajustes = datos.ajustes;
    r.error(!objeto(ajustes), 'ajustes tiene que ser un objeto.');
    if (!objeto(ajustes)) return;
    r.error(!Number.isInteger(ajustes.maxTicketsPorUsuario) || ajustes.maxTicketsPorUsuario < 1 || ajustes.maxTicketsPorUsuario > 10,
        'ajustes.maxTicketsPorUsuario tiene que estar entre 1 y 10.');
    r.error(!texto(ajustes.formatoNombre) || !ajustes.formatoNombre.includes('{numero}'),
        'ajustes.formatoNombre debe incluir {numero}.');
    validarId(r, ajustes.categoriaArchivoId, 'ajustes.categoriaArchivoId', { obligatorio: ajustes.cierre?.archivarCanal });
    validarId(r, ajustes.transcripciones?.canalId, 'ajustes.transcripciones.canalId', { obligatorio: ajustes.transcripciones?.activo });
    validarId(r, ajustes.valoraciones?.canalId, 'ajustes.valoraciones.canalId', { obligatorio: ajustes.valoraciones?.activo });
    const auto = ajustes.autocierre;
    if (auto?.activo) {
        r.error(!Number.isFinite(auto.inactividadMs) || auto.inactividadMs <= 0, 'ajustes.autocierre.inactividadMs debe ser positivo.');
        r.error(!Number.isFinite(auto.avisoMs) || auto.avisoMs <= 0 || auto.avisoMs >= auto.inactividadMs,
            'ajustes.autocierre.avisoMs debe ser positivo y menor que inactividadMs.');
        r.error(!Number.isFinite(auto.intervaloMs) || auto.intervaloMs < 30000, 'ajustes.autocierre.intervaloMs debe ser de al menos 30000 ms.');
    }
}

function validarVerify(datos, r) {
    r.error(typeof datos.activo !== 'boolean', 'activo tiene que ser true o false.');
    validarId(r, datos.canalId, 'canalId', { obligatorio: datos.activo });
    validarId(r, datos.rolId, 'rolId', { obligatorio: datos.activo });
    validarPanel(r, datos.panel);
    validarMedia(r, datos.panel?.logo, 'panel.logo');
    validarMedia(r, datos.panel?.banner, 'panel.banner');
    const caracteres = [datos.panel?.titulo, datos.panel?.subtitulo, datos.panel?.descripcion, datos.panel?.nota]
        .concat(datos.panel?.pasos ?? [], datos.panel?.beneficios ?? [])
        .reduce((total, valor) => total + String(valor ?? '').length + 10, 0);
    r.error(caracteres > 3300, 'El panel de verificacion supera el tamaño seguro de Discord.');
    r.error(!texto(datos.panel?.etiquetaBoton) || datos.panel.etiquetaBoton.length > 80,
        'panel.etiquetaBoton es obligatoria y admite hasta 80 caracteres.');
}

function validarWelcome(datos, r) {
    const bienvenida = datos.bienvenida;
    r.error(!objeto(bienvenida), 'bienvenida tiene que ser un objeto.');
    if (objeto(bienvenida)) {
        validarId(r, bienvenida.canalId, 'bienvenida.canalId', { obligatorio: bienvenida.activo });
        r.error(!texto(bienvenida.titulo) || bienvenida.titulo.length > 180,
            'bienvenida.titulo es obligatorio y admite hasta 180 caracteres.');
        r.error(!texto(bienvenida.mensaje) || bienvenida.mensaje.length > 2200,
            'bienvenida.mensaje es obligatorio y admite hasta 2200 caracteres.');
        r.error(!Number.isFinite(bienvenida.borrarTrasMs) || bienvenida.borrarTrasMs < 0,
            'bienvenida.borrarTrasMs tiene que ser un número no negativo.');
        r.error((bienvenida.botones?.length ?? 0) > 5, 'bienvenida.botones supera el maximo de 5.');
        for (const [indice, boton] of (bienvenida.botones ?? []).entries()) {
            r.error(!texto(boton.etiqueta) || boton.etiqueta.length > 80,
                `bienvenida.botones[${indice}].etiqueta es obligatoria y admite hasta 80 caracteres.`);
            r.error(!boton.canalId && !/^https:\/\/\S+$/i.test(boton.url ?? ''),
                `bienvenida.botones[${indice}] necesita canalId o una URL https.`);
            if (boton.canalId) validarId(r, boton.canalId, `bienvenida.botones[${indice}].canalId`);
        }
    }
    if (datos.tarjeta?.activa && !datos.tarjeta.usarAvatarComoFondo) {
        validarMedia(r, datos.tarjeta.fondo, 'tarjeta.fondo');
    }
    validarId(r, datos.despedida?.canalId, 'despedida.canalId', {
        obligatorio: datos.despedida?.activo && !bienvenida?.canalId
    });
    r.error(datos.despedida?.activo && !texto(datos.despedida.mensaje), 'despedida.mensaje es obligatorio cuando está activa.');
    r.error(datos.mensajePrivado?.activo && (!texto(datos.mensajePrivado.titulo) || !texto(datos.mensajePrivado.texto)),
        'mensajePrivado necesita titulo y texto cuando está activo.');
    for (const [indice, roleId] of (datos.rolesAutomaticos?.roles ?? []).entries()) {
        validarId(r, roleId, `rolesAutomaticos.roles[${indice}]`, { obligatorio: datos.rolesAutomaticos?.activo });
    }
    if (datos.hitos?.activo) {
        r.error(!Number.isInteger(datos.hitos.cada) || datos.hitos.cada < 2,
            'hitos.cada tiene que ser un entero de al menos 2.');
        validarId(r, datos.hitos.canalId, 'hitos.canalId');
        r.error(!texto(datos.hitos.mensaje), 'hitos.mensaje es obligatorio.');
    }
    r.error(!Number.isFinite(datos.tarjeta?.desenfoque) || datos.tarjeta.desenfoque < 0 || datos.tarjeta.desenfoque > 50,
        'tarjeta.desenfoque tiene que estar entre 0 y 50.');
    r.error(!Number.isFinite(datos.tarjeta?.velo) || datos.tarjeta.velo < 0 || datos.tarjeta.velo > 1,
        'tarjeta.velo tiene que estar entre 0 y 1.');
    r.error(datos.tarjeta?.etiqueta !== undefined && String(datos.tarjeta.etiqueta).length > 30,
        'tarjeta.etiqueta admite hasta 30 caracteres.');
    for (const color of ['degradadoInicio', 'degradadoFin', 'borde', 'texto', 'textoSuave', 'textoPastilla']) {
        const valor = datos.tarjeta?.[color];
        r.error(valor !== undefined && !HEX.test(valor), `tarjeta.${color} tiene que ser un color hexadecimal como #ffffff.`);
    }
}

function validarRules(datos, r) {
    validarPanel(r, datos.panel);
    validarMedia(r, datos.panel?.banner, 'panel.banner');
    const categorias = datos.categorias;
    r.error(!objeto(categorias) || !Object.keys(categorias ?? {}).length, 'categorias tiene que contener al menos una categoria.');
    r.error(Object.keys(categorias ?? {}).length > 25, 'Discord admite como maximo 25 categorias de normas.');
    let caracteresPanel = String(datos.panel?.titulo ?? '').length
        + String(datos.panel?.subtitulo ?? '').length
        + String(datos.panel?.descripcion ?? '').length
        + String(datos.panel?.nota ?? '').length;
    for (const [clave, categoria] of Object.entries(categorias ?? {})) {
        r.error(!texto(categoria.nombre) || categoria.nombre.length > 100,
            `categorias.${clave}.nombre es obligatorio y admite hasta 100 caracteres.`);
        r.error(!texto(categoria.descripcion) || categoria.descripcion.length > 100,
            `categorias.${clave}.descripcion es obligatoria y admite hasta 100 caracteres.`);
        caracteresPanel += String(categoria.nombre ?? '').length + String(categoria.descripcion ?? '').length + 20;
        r.error(!Array.isArray(categoria.secciones) || !categoria.secciones.length, `categorias.${clave}.secciones tiene que contener reglas.`);
        let caracteres = String(categoria.nombre ?? '').length + String(categoria.descripcion ?? '').length;
        let componentes = 2;
        for (const [indice, seccion] of (categoria.secciones ?? []).entries()) {
            const base = `categorias.${clave}.secciones[${indice}]`;
            r.error(!objeto(seccion), `${base} tiene que ser un objeto.`);
            if (!objeto(seccion)) continue;
            r.error(!texto(seccion.titulo), `${base}.titulo es obligatorio.`);
            r.error(!Array.isArray(seccion.contenido) || !seccion.contenido.length,
                `${base}.contenido tiene que contener al menos una norma.`);
            for (const [reglaIndice, regla] of (seccion.contenido ?? []).entries()) {
                r.error(!texto(regla), `${base}.contenido[${reglaIndice}] tiene que ser texto.`);
                caracteres += String(regla ?? '').length + 10;
            }
            caracteres += String(seccion.titulo ?? '').length + 10;
            componentes += 2;
        }
        r.error(caracteres > 3600, `categorias.${clave} supera el tamaño seguro de un mensaje de Discord.`);
        r.error(componentes > 38, `categorias.${clave} necesita demasiados componentes para un solo mensaje.`);
    }
    r.error(caracteresPanel > 3200, 'El resumen del panel de normas supera el tamaño seguro de Discord.');
    r.error(!texto(datos.panel?.placeholder) || datos.panel.placeholder.length > 150,
        'panel.placeholder es obligatorio y admite hasta 150 caracteres.');
}

function validarLogs(datos, r) {
    r.error(typeof datos.activo !== 'boolean', 'activo tiene que ser true o false.');
    r.error(!['categorias', 'unificado'].includes(datos.modo), 'modo debe ser categorias o unificado.');
    r.error(!objeto(datos.canales), 'canales tiene que ser un objeto.');
    if (datos.activo && datos.modo === 'unificado') validarId(r, datos.canales?.todos, 'canales.todos', { obligatorio: true });
    for (const [clave, valor] of Object.entries(datos.canales ?? {})) validarId(r, valor, `canales.${clave}`);
}

function validarModeracion(datos, r) {
    r.error(typeof datos.notificarPorMd !== 'boolean', 'notificarPorMd tiene que ser true o false.');
    r.error(!objeto(datos.escalado), 'escalado tiene que ser un objeto.');
    for (const [cantidad, regla] of Object.entries(datos.escalado ?? {})) {
        r.error(!/^\d+$/.test(cantidad) || Number(cantidad) < 1, `escalado.${cantidad} no usa un numero de avisos valido.`);
        r.error(!['timeout', 'kick', 'ban'].includes(regla.accion), `escalado.${cantidad}.accion no es valida.`);
        r.error(regla.accion === 'timeout' && (!Number.isFinite(regla.duracionMs) || regla.duracionMs <= 0 || regla.duracionMs > 2419200000),
            `escalado.${cantidad}.duracionMs no es valida.`);
    }
}

function validarShop(datos, r) {
    r.error(!texto(datos.moneda), 'moneda es obligatoria.');
    r.error(!texto(datos.simbolo), 'simbolo es obligatorio.');
    r.error(!Array.isArray(datos.categorias) || !datos.categorias.length, 'categorias tiene que ser una lista no vacia.');
    r.error((datos.categorias?.length ?? 0) > 24, 'El catálogo admite como máximo 24 categorías además de la opción Todos.');
    r.error(new Set(datos.categorias ?? []).size !== (datos.categorias?.length ?? 0), 'categorias contiene valores repetidos.');
    for (const [indice, categoria] of (datos.categorias ?? []).entries()) {
        r.error(!texto(categoria) || categoria.length > 100, `categorias[${indice}] tiene que ser texto de hasta 100 caracteres.`);
    }
    validarPanel(r, datos.catalogo, 'catalogo');
    validarMedia(r, datos.catalogo?.banner, 'catalogo.banner');
    const caracteres = [datos.catalogo?.titulo, datos.catalogo?.subtitulo, datos.catalogo?.descripcion, datos.catalogo?.nota]
        .concat(datos.catalogo?.ventajas ?? [], datos.categorias ?? [])
        .reduce((total, valor) => total + String(valor ?? '').length + 12, 0);
    r.error(caracteres > 3000, 'El panel del catálogo supera el tamaño seguro de Discord.');
    const categoriasTicket = config.cargar('tickets').categorias ?? {};
    r.error(!categoriasTicket[datos.compra?.categoriaTicket], 'compra.categoriaTicket no existe en config/tickets.json.');
}

function validarSellAuth(datos, r) {
    r.error(typeof datos.enabled !== 'boolean', 'enabled tiene que ser true o false.');
    r.error(!/^https:\/\/[^\s]+$/i.test(datos.apiBaseUrl ?? ''), 'apiBaseUrl tiene que ser una URL https.');
    r.aviso(datos.enabled && !/^\d+$/.test(String(process.env.SELLAUTH_SHOP_ID || datos.shopId || '')),
        'shopId esta vacio en config; puedes definirlo con SELLAUTH_SHOP_ID en el .env.');
    r.error(datos.storefrontUrl && !/^https:\/\/[^\s]+$/i.test(datos.storefrontUrl),
        'storefrontUrl tiene que ser una URL https o quedarse vacia.');
    r.error(!texto(datos.productPathTemplate)
        || !datos.productPathTemplate.includes('{storefrontUrl}')
        || !datos.productPathTemplate.includes('{path}'),
    'productPathTemplate tiene que incluir {storefrontUrl} y {path}.');

    r.error(!objeto(datos.channels), 'channels tiene que ser un objeto.');
    for (const clave of ['reviews', 'restocks', 'priceUpdates']) {
        validarId(r, datos.channels?.[clave], `channels.${clave}`);
    }

    r.error(!objeto(datos.sync), 'sync tiene que ser un objeto.');
    r.error(!Number.isFinite(datos.sync?.intervalMs) || datos.sync.intervalMs < 30000,
        'sync.intervalMs tiene que ser de al menos 30000 ms.');
    r.error(!Number.isInteger(datos.sync?.feedbackHistoryLimit)
        || datos.sync.feedbackHistoryLimit < 1
        || datos.sync.feedbackHistoryLimit > 100,
    'sync.feedbackHistoryLimit tiene que estar entre 1 y 100.');

    r.error(!objeto(datos.webhook), 'webhook tiene que ser un objeto.');
    r.error(!Number.isInteger(datos.webhook?.port) || datos.webhook.port < 1 || datos.webhook.port > 65535,
        'webhook.port no es valido.');
    r.error(!/^\/[a-z0-9/_-]+$/i.test(datos.webhook?.path ?? ''), 'webhook.path no es una ruta valida.');
    r.error(!Number.isFinite(datos.webhook?.timestampToleranceSeconds)
        || datos.webhook.timestampToleranceSeconds < 60
        || datos.webhook.timestampToleranceSeconds > 3600,
    'webhook.timestampToleranceSeconds tiene que estar entre 60 y 3600.');

    r.error(!objeto(datos.reviews), 'reviews tiene que ser un objeto.');
    r.error(!texto(datos.reviews?.title), 'reviews.title es obligatorio.');
    r.error(!texto(datos.reviews?.buttonLabel) || datos.reviews.buttonLabel.length > 80,
        'reviews.buttonLabel es obligatorio y admite hasta 80 caracteres.');
    r.error(!texto(datos.reviews?.guideTitle), 'reviews.guideTitle es obligatorio.');
    r.error(!Array.isArray(datos.reviews?.guideLines) || !datos.reviews.guideLines.length,
        'reviews.guideLines tiene que contener instrucciones.');
    r.error((datos.reviews?.guideLines ?? []).join('\n').length > 2200,
        'reviews.guideLines supera el tamaño seguro.');
    r.error(!Array.isArray(datos.reviews?.validInvoiceStatuses) || !datos.reviews.validInvoiceStatuses.length,
        'reviews.validInvoiceStatuses tiene que contener estados.');
    validarMedia(r, datos.reviews?.banner, 'reviews.banner');

    r.error(!objeto(datos.announcements), 'announcements tiene que ser un objeto.');
    for (const clave of ['restocks', 'priceChanges', 'newProducts']) {
        r.error(!objeto(datos.announcements?.[clave]), `announcements.${clave} tiene que ser un objeto.`);
    }
}

function validarStatus(datos, r) {
    r.error(typeof datos.activo !== 'boolean', 'activo tiene que ser true o false.');
    validarPanel(r, datos, 'estado');
    validarMedia(r, datos.banner, 'banner');
    r.error(!objeto(datos.estados) || !Object.keys(datos.estados ?? {}).length,
        'estados tiene que contener al menos una opción.');
    r.error(Object.keys(datos.estados ?? {}).length > 4,
        'El panel admite como máximo 4 estados para reservar el quinto botón a la nota.');
    r.error(!datos.estados?.[datos.estadoPorDefecto], 'estadoPorDefecto no existe en estados.');
    for (const [clave, estado] of Object.entries(datos.estados ?? {})) {
        r.error(!CUSTOM_ID.test(clave), `estados.${clave} no usa una clave válida.`);
        r.error(!texto(estado.nombre) || estado.nombre.length > 80, `estados.${clave}.nombre es obligatorio y admite hasta 80 caracteres.`);
        r.error(!texto(estado.descripcion), `estados.${clave}.descripcion es obligatoria.`);
        r.error(!texto(estado.emoji), `estados.${clave}.emoji es obligatorio.`);
    }
    r.error(!Number.isInteger(datos.historialMaximo) || datos.historialMaximo < 0 || datos.historialMaximo > 10,
        'historialMaximo tiene que estar entre 0 y 10.');
}

function validarSuggestions(datos, r) {
    r.error(typeof datos.activo !== 'boolean', 'activo tiene que ser true o false.');
    validarId(r, datos.canalPublicacionId, 'canalPublicacionId');
    r.error(!Number.isFinite(datos.cooldownMs) || datos.cooldownMs < 0,
        'cooldownMs tiene que ser un número positivo.');
    validarPanel(r, datos.panel);
    validarMedia(r, datos.panel?.banner, 'panel.banner');
    r.error(!texto(datos.panel?.etiquetaBoton) || datos.panel.etiquetaBoton.length > 80,
        'panel.etiquetaBoton es obligatoria y admite hasta 80 caracteres.');
    r.error(!objeto(datos.votos), 'votos tiene que ser un objeto.');
    r.error(!objeto(datos.estados) || !datos.estados?.abierta, 'estados tiene que incluir el estado abierta.');
    r.error(Object.keys(datos.estados ?? {}).length > 25, 'Discord admite como máximo 25 estados de sugerencia.');
    for (const [clave, estado] of Object.entries(datos.estados ?? {})) {
        r.error(!CUSTOM_ID.test(clave), `estados.${clave} no usa una clave válida.`);
        r.error(!texto(estado.nombre) || estado.nombre.length > 100, `estados.${clave}.nombre no es válido.`);
        r.error(!texto(estado.emoji), `estados.${clave}.emoji es obligatorio.`);
    }
}

function validarMantenimiento(datos, r) {
    r.error(!texto(datos.titulo), 'titulo es obligatorio.');
    r.error(!texto(datos.descripcion) && !texto(datos.mensajeCorto), 'hace falta descripcion o mensajeCorto.');
    validarId(r, datos.avisarEnCanalId, 'avisarEnCanalId');
    r.error(datos.excepciones && !Number.isFinite(datos.excepciones.nivelMinimoStaff),
        'excepciones.nivelMinimoStaff tiene que ser un numero.');
}

function validarAutomod(datos, r) {
    r.error(typeof datos.activo !== 'boolean', 'activo tiene que ser booleano.');
    validarId(r, datos.canalRegistroId, 'canalRegistroId');

    for (const canal of datos.ignorar?.canales ?? []) validarId(r, canal, 'ignorar.canales[]');
    for (const rol of datos.ignorar?.roles ?? []) validarId(r, rol, 'ignorar.roles[]');

    const acciones = new Set(['borrar', 'timeout', 'aviso']);
    for (const [nombre, filtro] of Object.entries(datos.filtros ?? {})) {
        r.error(!objeto(filtro), `filtros.${nombre} tiene que ser un objeto.`);
        if (!objeto(filtro)) continue;
        r.error(filtro.accion !== undefined && !acciones.has(filtro.accion),
            `filtros.${nombre}.accion tiene que ser borrar, timeout o aviso.`);
        r.error(filtro.duracionTimeoutMs !== undefined
            && (!Number.isFinite(filtro.duracionTimeoutMs) || filtro.duracionTimeoutMs > 28 * 86400000),
            `filtros.${nombre}.duracionTimeoutMs tiene que ser un numero y Discord no admite mas de 28 dias.`);
    }

    // Un patron mal escrito solo se descubriria cuando alguien lo dispara.
    for (const patron of datos.filtros?.estafas?.patrones ?? []) {
        try {
            new RegExp(patron);
        } catch (error) {
            r.error(true, `filtros.estafas.patrones contiene una expresion invalida (${patron}): ${error.message}`);
        }
    }

    const raid = datos.antiRaid ?? {};
    validarId(r, raid.canalAvisoId, 'antiRaid.canalAvisoId');
    validarId(r, raid.mencionarRolId, 'antiRaid.mencionarRolId');
    r.error(raid.entradasPorVentana !== undefined && (!Number.isFinite(raid.entradasPorVentana) || raid.entradasPorVentana < 2),
        'antiRaid.entradasPorVentana tiene que ser un numero mayor que 1.');
    r.error(raid.accion !== undefined && !['verificacion', 'expulsar'].includes(raid.accion),
        'antiRaid.accion tiene que ser verificacion o expulsar.');
}

function validarSorteos(datos, r) {
    r.error(!texto(datos.titulo), 'titulo es obligatorio.');
    r.error(!texto(datos.botonParticipar), 'botonParticipar es obligatorio.');
    r.error(datos.botonParticipar?.length > 80, 'botonParticipar supera los 80 caracteres de una etiqueta de boton.');
    r.error(!Number.isFinite(datos.maximoGanadores) || datos.maximoGanadores < 1,
        'maximoGanadores tiene que ser un numero mayor que 0.');
    r.error(!Number.isFinite(datos.duracionMaximaMs) || datos.duracionMaximaMs < 60000,
        'duracionMaximaMs tiene que ser al menos un minuto.');
}

function validarEncuestas(datos, r) {
    r.error(!texto(datos.titulo), 'titulo es obligatorio.');
    // Discord no admite mas de 25 opciones en un select.
    r.error(!Number.isFinite(datos.maximoOpciones) || datos.maximoOpciones < 2 || datos.maximoOpciones > 25,
        'maximoOpciones tiene que estar entre 2 y 25.');
    r.error(!Number.isFinite(datos.duracionMaximaMs) || datos.duracionMaximaMs < 60000,
        'duracionMaximaMs tiene que ser al menos un minuto.');
}

function validarProgramados(datos, r) {
    r.error(typeof datos.activo !== 'boolean', 'activo tiene que ser booleano.');
    r.error(!Number.isFinite(datos.maximoPorServidor) || datos.maximoPorServidor < 1,
        'maximoPorServidor tiene que ser un numero mayor que 0.');
    r.error(!Number.isFinite(datos.intervaloRevisionMs) || datos.intervaloRevisionMs < 15000,
        'intervaloRevisionMs no puede bajar de 15000 ms.');
    for (const [clave, valor] of Object.entries(datos.repeticiones ?? {})) {
        r.error(!Number.isFinite(valor) || valor < 60000, `repeticiones.${clave} tiene que ser al menos un minuto.`);
    }
}


const VALIDADORES = {
    bot: validarBot,
    brand: validarBrand,
    emojis: validarEmojis,
    permissions: validarPermissions,
    tickets: validarTickets,
    verify: validarVerify,
    welcome: validarWelcome,
    rules: validarRules,
    logs: validarLogs,
    moderacion: validarModeracion,
    shop: validarShop,
    sellauth: validarSellAuth,
    status: validarStatus,
    suggestions: validarSuggestions,
    mantenimiento: validarMantenimiento,
    automod: validarAutomod,
    sorteos: validarSorteos,
    encuestas: validarEncuestas,
    programados: validarProgramados
};

function validar(nombre, datos = config.cargar(nombre)) {
    const r = resultado(nombre);
    r.error(!objeto(datos), 'La raiz del archivo tiene que ser un objeto JSON.');
    if (objeto(datos)) VALIDADORES[nombre]?.(datos, r);
    return { nombre, errores: r.errores, avisos: r.avisos, ok: r.errores.length === 0 };
}

function validarTodo() {
    return Object.keys(VALIDADORES).map(nombre => validar(nombre));
}

module.exports = { validar, validarTodo, VALIDADORES };
