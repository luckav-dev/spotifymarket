import 'server-only';

import type { JsonObjeto } from './json';

/**
 * Cliente de la API del bot.
 *
 * Solo se puede importar desde el servidor: el token vive en el entorno y no
 * puede acabar en el bundle del navegador. De ahi el 'server-only' de arriba,
 * que rompe la compilacion si alguien lo importa desde un componente cliente.
 */

const BASE = process.env.BOT_API_URL ?? 'http://127.0.0.1:8787';
const TOKEN = process.env.BOT_API_TOKEN ?? '';

export class ErrorApi extends Error {
  constructor(
    mensaje: string,
    readonly estado: number,
    readonly problemas: string[] = [],
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
  }
}

type Opciones = {
  metodo?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  cuerpo?: unknown;
  /** Segundos de cache. Por defecto no se cachea: son datos vivos. */
  revalidar?: number;
};

async function pedir<T>(ruta: string, opciones: Opciones = {}): Promise<T> {
  const { metodo = 'GET', cuerpo, revalidar } = opciones;

  if (!TOKEN) {
    throw new ErrorApi('Falta BOT_API_TOKEN en el entorno del dashboard.', 500);
  }

  let respuesta: Response;

  try {
    respuesta = await fetch(`${BASE}${ruta}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      ...(revalidar === undefined
        ? { cache: 'no-store' as const }
        : { next: { revalidate: revalidar } }),
    });
  } catch {
    // El fallo mas comun de largo: el bot no esta arrancado. Merece un mensaje
    // propio en vez de un "fetch failed" que no dice nada.
    throw new ErrorApi(
      `No se puede conectar con el bot en ${BASE}. Comprueba que esta arrancado y que DASHBOARD_TOKEN coincide.`,
      503,
    );
  }

  const datos = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok) {
    throw new ErrorApi(
      datos?.error ?? `La API respondio ${respuesta.status}`,
      respuesta.status,
      datos?.problemas ?? [],
    );
  }

  return datos as T;
}

// --- Tipos -----------------------------------------------------------------

export type Estado = {
  bot: {
    tag: string | null;
    id: string | null;
    servidores: number;
    comandos: number;
    latenciaMs: number;
    enPieDesdeMs: number | null;
  };
  tickets: {
    abiertos: number;
    cerrados: number;
    valoraciones: number;
    valoracionMedia: number | null;
  };
  catalogo: { total: number; visibles: number; fuente?: 'local' | 'sellauth'; ultimaSincronizacion?: number | null };
  emojis: number;
  configuracion: { errores: number; avisos: number };
};

export type Acceso = {
  permitido: boolean;
  nivel: number;
  esDueno: boolean;
  nivelMinimo?: number;
  nombre?: string;
  motivo: string | null;
};

export type Recursos = {
  servidor: { id: string; nombre: string; miembros: number };
  canalesTexto: { id: string; nombre: string; categoriaId: string | null }[];
  categorias: { id: string; nombre: string }[];
  roles: { id: string; nombre: string; posicion: number }[];
};

export type Producto = {
  id: string;
  nombre: string;
  descripcion: string;
  precio: number;
  stock: number;
  categoria: string;
  imagen: string;
  visible: boolean;
  moneda?: string;
  checkoutUrl?: string;
};

export type TicketDashboard = {
  id: number;
  canalId: string;
  userId: string;
  avatarUrl: string | null;
  categoria: string;
  prioridad: number;
  respuestas: Record<string, string>;
  abiertoEn: number;
  ultimaActividad: number;
  reclamadoPor: string | null;
  estado: string;
  cerradoEn: number | null;
  cerradoPor: string | null;
  motivoCierre: string | null;
  valoracion: number | null;
};

export type ValoracionTicket = {
  ticketId: number;
  userId: string;
  atendidoPor: string | null;
  estrellas: number;
  fecha: number;
};

export type AvisoModeracion = {
  id: string;
  userId: string;
  motivo: string;
  moderadorId: string;
  fecha: number;
  activo: boolean;
};

export type Bloque =
  | { tipo: 'titulo'; texto: string; nivel?: number }
  | { tipo: 'texto'; contenido: string }
  | { tipo: 'separador'; linea?: boolean; espaciado?: 'pequeno' | 'grande' }
  | { tipo: 'imagenes'; urls: string[] }
  | { tipo: 'seccion'; texto: string; boton?: BotonBloque; miniatura?: string }
  | { tipo: 'botones'; botones: BotonBloque[] };

export type BotonBloque = {
  etiqueta: string;
  estilo?: 'primario' | 'secundario' | 'exito' | 'peligro' | 'enlace';
  url?: string;
  customId?: string;
  emoji?: string;
};

// --- Llamadas ---------------------------------------------------------------

export const api = {
  estado: () => pedir<Estado>('/api/estado'),

  acceso: (userId: string) => pedir<Acceso>(`/api/acceso/${userId}`),

  recursos: () => pedir<Recursos>('/api/recursos'),

  tickets: () => pedir<{ activos: TicketDashboard[]; archivados: TicketDashboard[]; valoraciones: ValoracionTicket[] }>('/api/tickets'),

  moderacion: () => pedir<{ avisos: AvisoModeracion[]; activos: number; usuarios: number }>('/api/moderacion'),

  listaConfigs: () => pedir<{ archivos: string[] }>('/api/config'),

  leerConfig: (nombre: string) =>
    pedir<{ nombre: string; datos: JsonObjeto }>(`/api/config/${nombre}`),

  guardarConfig: (nombre: string, datos: JsonObjeto) =>
    pedir<{ nombre: string; avisos: string[] }>(`/api/config/${nombre}`, { metodo: 'PUT', cuerpo: { datos } }),

  emojis: () => pedir<{ emojis: Record<string, string> }>('/api/emojis'),

  productos: () => pedir<{ productos: Producto[]; fuente: 'local' | 'sellauth' }>('/api/productos'),

  crearProducto: (producto: Omit<Producto, 'id' | 'visible'>) =>
    pedir<{ producto: Producto }>('/api/productos', { metodo: 'POST', cuerpo: producto }),

  editarProducto: (id: string, cambios: Partial<Producto>) =>
    pedir<{ producto: Producto }>(`/api/productos/${id}`, { metodo: 'PUT', cuerpo: cambios }),

  borrarProducto: (id: string) =>
    pedir<{ producto: Producto }>(`/api/productos/${id}`, { metodo: 'DELETE' }),

  validarAnuncio: (bloques: Bloque[]) =>
    pedir<{ ok: boolean; problemas: string[] }>('/api/anuncio/validar', {
      metodo: 'POST',
      cuerpo: { bloques },
    }),

  enviarAnuncio: (canalId: string, bloques: Bloque[], mencion?: string) =>
    pedir<{ mensajeId: string; url: string }>('/api/anuncio', {
      metodo: 'POST',
      cuerpo: { canalId, bloques, mencion },
    }),

  publicarPanel: (tipo: string, canalId: string) =>
    pedir<{ mensajeId: string; url: string }>(`/api/paneles/${tipo}`, {
      metodo: 'POST',
      cuerpo: { canalId },
    }),

  control: (accion: 'presencia' | 'comandos' | 'emojis') =>
    pedir<Record<string, unknown>>(`/api/control/${accion}`, { metodo: 'POST' }),

};
