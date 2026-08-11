'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Crown, LogOut } from 'lucide-react';

import type { Sesion } from '@/lib/sesion';
import { NAV } from './nav-items';
import { CommandMenu } from './command-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';

const ETIQUETAS_CONFIG: Record<string, string> = {
  bot: 'Bot', brand: 'Marca', emojis: 'Emojis', permissions: 'Permisos', tickets: 'Tickets',
  verify: 'Verificación', welcome: 'Bienvenidas', rules: 'Normas', logs: 'Logs',
  moderacion: 'Moderación', shop: 'Tienda', status: 'Estado', suggestions: 'Sugerencias',
};

function itemActual(pathname: string) {
  return [...NAV].reverse().find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
}

export function Cabecera({ sesion }: { sesion: Sesion }) {
  const pathname = usePathname();
  const actual = itemActual(pathname);
  const segmentoConfig = pathname.startsWith('/configuracion/') ? pathname.split('/')[2] : null;
  const iniciales = sesion.nombre.slice(0, 2).toUpperCase();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-3 md:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger aria-label="Abrir o cerrar navegación" />
        <Separator orientation="vertical" className="mr-1 h-4" />
        <Breadcrumb className="hidden sm:block">
          <BreadcrumbList className="text-xs">
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href="/inicio" />}>Dashboard</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {segmentoConfig ? (
                <BreadcrumbLink render={<Link href="/configuracion" />}>Configuración</BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{actual?.etiqueta ?? 'Control'}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
            {segmentoConfig ? (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem><BreadcrumbPage>{ETIQUETAS_CONFIG[segmentoConfig] ?? segmentoConfig}</BreadcrumbPage></BreadcrumbItem>
              </>
            ) : null}
          </BreadcrumbList>
        </Breadcrumb>
        <span className="truncate text-sm font-medium sm:hidden">{segmentoConfig ? ETIQUETAS_CONFIG[segmentoConfig] ?? segmentoConfig : actual?.etiqueta ?? 'Control'}</span>
      </div>

      <div className="flex items-center gap-2">
        <CommandMenu />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" className="h-auto gap-2 p-1">
                <span className="hidden max-w-32 truncate text-xs text-muted-foreground lg:inline">{sesion.nombre}</span>
                <Avatar className="size-7">
                  <AvatarImage src={sesion.avatar ?? undefined} alt={sesion.nombre} />
                  <AvatarFallback>{iniciales}</AvatarFallback>
                </Avatar>
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="space-y-1">
              <span className="block truncate">{sesion.nombre}</span>
              <span className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                {sesion.esDueno ? <><Crown className="size-3" /> Dueño del servidor</> : <Badge variant="secondary">Nivel {sesion.nivel}</Badge>}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              render={
                <form action="/auth/salir" method="POST" className="w-full">
                  <Button type="submit" variant="ghost" className="h-auto w-full justify-start p-0 hover:bg-transparent">
                    <LogOut className="size-4" /> Cerrar sesión
                  </Button>
                </form>
              }
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
