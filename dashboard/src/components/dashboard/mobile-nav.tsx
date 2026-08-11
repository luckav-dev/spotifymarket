'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu } from 'lucide-react';

import { NAV_SECCIONES } from './nav-items';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

export function MobileNav() {
  const pathname = usePathname();
  const [abierto, setAbierto] = useState(false);

  return (
    <Sheet open={abierto} onOpenChange={setAbierto}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Abrir navegación">
            <Menu className="size-5" />
          </Button>
        }
      />
      <SheetContent side="left" className="w-64 p-0">
        <SheetHeader className="border-b border-border">
          <SheetTitle className="flex items-center gap-2 text-left">
            <div className="relative size-8 overflow-hidden rounded-lg border border-primary/20">
              <Image src="/brand/logo.png" alt="" fill sizes="32px" className="object-cover" />
            </div>
            SpotifyMarket
          </SheetTitle>
        </SheetHeader>
        <nav className="space-y-5 p-3">
          {NAV_SECCIONES.map((seccion) => (
            <div key={seccion.etiqueta} className="space-y-1">
              <p className="px-2 text-[11px] font-medium text-muted-foreground">{seccion.etiqueta}</p>
              {seccion.items.map((item) => {
                const activo = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icono = item.icono;

                return (
                  <Link key={item.href} href={item.href} onClick={() => setAbierto(false)} className={cn('flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors', activo ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground')}>
                    <Icono className={cn('size-4', activo && 'text-primary')} />
                    {item.etiqueta}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
