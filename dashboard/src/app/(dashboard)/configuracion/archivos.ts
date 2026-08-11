import type { LucideIcon } from 'lucide-react';
import { Activity, Bot, BookOpen, Image, Lightbulb, Smile, ShieldCheck, Ticket, UserCheck, PartyPopper, ScrollText, Gavel, ShoppingBag } from 'lucide-react';

export const ARCHIVOS_CONFIG: Record<string, { etiqueta: string; descripcion: string; icono: LucideIcon }> = {
  bot: { etiqueta: 'Bot', descripcion: 'Intents de la gateway y presencia', icono: Bot },
  brand: { etiqueta: 'Marca', descripcion: 'Nombre, recursos visuales y enlaces oficiales', icono: Image },
  emojis: { etiqueta: 'Emojis', descripcion: 'Roles semanticos a nombre de archivo', icono: Smile },
  permissions: { etiqueta: 'Permisos', descripcion: 'Roles de staff, niveles y acciones', icono: ShieldCheck },
  tickets: { etiqueta: 'Tickets', descripcion: 'Panel, categorias, formularios y ajustes', icono: Ticket },
  verify: { etiqueta: 'Verificacion', descripcion: 'Canal, rol y textos del panel', icono: UserCheck },
  welcome: { etiqueta: 'Bienvenidas', descripcion: 'Mensajes, tarjeta dinamica, roles e hitos', icono: PartyPopper },
  rules: { etiqueta: 'Normas', descripcion: 'Panel navegable y categorías editables', icono: BookOpen },
  logs: { etiqueta: 'Logs', descripcion: 'Canales por categoria, filtros y agrupacion', icono: ScrollText },
  moderacion: { etiqueta: 'Moderacion', descripcion: 'Aviso por MD y escalado de sanciones', icono: Gavel },
  shop: { etiqueta: 'Tienda', descripcion: 'Moneda, categorias y textos del catalogo', icono: ShoppingBag },
  status: { etiqueta: 'Estado', descripcion: 'Disponibilidad, nota e historial del servicio', icono: Activity },
  suggestions: { etiqueta: 'Sugerencias', descripcion: 'Panel, votos, estados y canal de publicación', icono: Lightbulb },
};
