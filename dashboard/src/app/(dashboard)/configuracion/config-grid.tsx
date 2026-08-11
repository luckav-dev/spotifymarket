'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ChevronRight, Copy, ExternalLink, Search } from 'lucide-react';
import { toast } from 'sonner';

import { ARCHIVOS_CONFIG } from './archivos';
import { Card, CardContent } from '@/components/ui/card';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

const modulos = Object.entries(ARCHIVOS_CONFIG).map(([nombre, info]) => ({ nombre, etiqueta: info.etiqueta }));
type ModuloConfig = (typeof modulos)[number];

export function ConfigGrid() {
  const router = useRouter();
  const [seleccion, setSeleccion] = useState<ModuloConfig | null>(null);

  function abrir(nombre: string) {
    router.push(`/configuracion/${nombre}`);
  }

  async function copiarRuta(nombre: string) {
    await navigator.clipboard.writeText(`config/${nombre}.json`);
    toast.success('Ruta copiada');
  }

  return (
    <div className="space-y-4">
      <div className="max-w-xl">
        <Combobox
          items={modulos}
          value={seleccion}
          onValueChange={(modulo) => {
            setSeleccion(modulo);
            if (modulo) abrir(modulo.nombre);
          }}
          itemToStringLabel={(modulo) => `${modulo.etiqueta} ${modulo.nombre}`}
          itemToStringValue={(modulo) => modulo.nombre}
          isItemEqualToValue={(modulo, actual) => modulo.nombre === actual.nombre}
        >
          <ComboboxInput aria-label="Buscar módulo de configuración" placeholder="Buscar un ajuste del bot…" className="w-full" showClear />
          <ComboboxContent>
            <ComboboxEmpty>No existe ningún módulo con ese nombre.</ComboboxEmpty>
            <ComboboxList>
              {(modulo: ModuloConfig) => {
                const info = ARCHIVOS_CONFIG[modulo.nombre];
                const Icono = info.icono;
                return (
                  <ComboboxItem key={modulo.nombre} value={modulo}>
                    <Icono className="text-muted-foreground" />
                    <span className="flex-1">{info.etiqueta}</span>
                    <span className="text-xs text-muted-foreground">{modulo.nombre}.json</span>
                  </ComboboxItem>
                );
              }}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Search className="size-3" /> Busca por nombre o abre el menú contextual con clic derecho.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Object.entries(ARCHIVOS_CONFIG).map(([nombre, info]) => {
          const Icono = info.icono;
          return (
            <ContextMenu key={nombre}>
              <ContextMenuTrigger className="block h-full">
                <Link href={`/configuracion/${nombre}`} className="group block h-full">
                  <Card size="sm" className="h-full transition-colors group-hover:border-primary/30 group-hover:bg-accent/40">
                    <CardContent className="flex items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
                        <Icono className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{info.etiqueta}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{info.descripcion}</p>
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </CardContent>
                  </Card>
                </Link>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuGroup>
                  <ContextMenuLabel>{info.etiqueta}</ContextMenuLabel>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => abrir(nombre)}><ExternalLink /> Abrir editor</ContextMenuItem>
                  <ContextMenuItem onClick={() => void copiarRuta(nombre)}><Copy /> Copiar ruta JSON</ContextMenuItem>
                </ContextMenuGroup>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
    </div>
  );
}
