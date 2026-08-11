import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  ShoppingBag,
  Megaphone,
  LayoutTemplate,
  Settings2,
  TicketCheck,
  ShieldAlert,
  Bot,
} from 'lucide-react';

export type ItemNav = {
  href: string;
  etiqueta: string;
  icono: LucideIcon;
};

export type SeccionNav = {
  etiqueta: string;
  items: ItemNav[];
};

export const NAV_SECCIONES: SeccionNav[] = [
  {
    etiqueta: 'Operaciones',
    items: [
      { href: '/inicio', etiqueta: 'Vista general', icono: LayoutDashboard },
      { href: '/tickets', etiqueta: 'Tickets', icono: TicketCheck },
      { href: '/moderacion', etiqueta: 'Moderación', icono: ShieldAlert },
    ],
  },
  {
    etiqueta: 'Publicacion',
    items: [
      { href: '/catalogo', etiqueta: 'Catalogo', icono: ShoppingBag },
      { href: '/anuncios', etiqueta: 'Anuncios', icono: Megaphone },
      { href: '/paneles', etiqueta: 'Paneles', icono: LayoutTemplate },
    ],
  },
  {
    etiqueta: 'Sistema',
    items: [
      { href: '/bot', etiqueta: 'Central del bot', icono: Bot },
      { href: '/configuracion', etiqueta: 'Configuración', icono: Settings2 },
    ],
  },
];

export const NAV: ItemNav[] = NAV_SECCIONES.flatMap((seccion) => seccion.items);
