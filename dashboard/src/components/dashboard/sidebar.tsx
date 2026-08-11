'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bot, Circle } from 'lucide-react';

import { NAV_SECCIONES } from './nav-items';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';

export function BarraLateral() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-14 justify-center border-b">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip="SpotifyMarket"
              render={<Link href="/inicio" onClick={() => setOpenMobile(false)} />}
              className="h-10"
            >
              <div className="relative size-8 shrink-0 overflow-hidden rounded-lg border bg-muted">
                <Image src="/brand/logo.png" alt="SpotifyMarket" fill sizes="32px" className="object-cover" />
              </div>
              <div className="min-w-0 leading-tight">
                <span className="block truncate text-sm font-semibold">SpotifyMarket</span>
                <span className="block truncate text-[11px] text-muted-foreground">Bot dashboard</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAV_SECCIONES.map((seccion) => (
          <SidebarGroup key={seccion.etiqueta}>
            <SidebarGroupLabel>{seccion.etiqueta}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {seccion.items.map((item) => {
                  const activo = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const Icono = item.icono;

                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={activo}
                        tooltip={item.etiqueta}
                        aria-current={activo ? 'page' : undefined}
                        render={<Link href={item.href} onClick={() => setOpenMobile(false)} />}
                      >
                        <Icono className={activo ? 'text-primary' : undefined} />
                        <span>{item.etiqueta}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="API protegida" className="text-xs text-muted-foreground">
              <Bot />
              <span>API protegida</span>
              <Circle className="ml-auto size-2 fill-primary text-primary" />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
