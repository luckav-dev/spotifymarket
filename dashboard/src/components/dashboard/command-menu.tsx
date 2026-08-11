'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';

import { NAV_SECCIONES } from './nav-items';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';

export function CommandMenu() {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    function escuchar(evento: KeyboardEvent) {
      if ((evento.metaKey || evento.ctrlKey) && evento.key.toLowerCase() === 'k') {
        evento.preventDefault();
        setAbierto((actual) => !actual);
      }
    }

    window.addEventListener('keydown', escuchar);
    return () => window.removeEventListener('keydown', escuchar);
  }, []);

  function irA(ruta: string) {
    setAbierto(false);
    router.push(ruta);
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setAbierto(true)}>
        <Search className="size-3.5" />
        <span className="hidden sm:inline">Buscar</span>
        <kbd className="hidden rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground lg:inline">Ctrl K</kbd>
      </Button>
      <CommandDialog open={abierto} onOpenChange={setAbierto} title="Navegación rápida" description="Busca una sección del dashboard">
        <Command>
          <CommandInput placeholder="Buscar tickets, catálogo, configuración..." />
          <CommandList>
            <CommandEmpty>No se encontraron secciones.</CommandEmpty>
            {NAV_SECCIONES.map((seccion) => (
              <CommandGroup key={seccion.etiqueta} heading={seccion.etiqueta}>
                {seccion.items.map((item) => {
                  const Icono = item.icono;
                  return (
                    <CommandItem key={item.href} value={`${item.etiqueta} ${item.href}`} onSelect={() => irA(item.href)}>
                      <Icono className="size-4 text-muted-foreground" />
                      <span>{item.etiqueta}</span>
                      <CommandShortcut>Ir</CommandShortcut>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
