'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Eye, Gavel, ShieldCheck, UserRound } from 'lucide-react';

import type { AvisoModeracion } from '@/lib/api';
import { DataTable, SortableHeader } from '@/components/dashboard/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

export function ExploradorModeracion({ avisos }: { avisos: AvisoModeracion[] }) {
  const [seleccionado, setSeleccionado] = useState<AvisoModeracion | null>(null);
  const columns = useMemo<ColumnDef<AvisoModeracion>[]>(() => [
    {
      accessorKey: 'userId',
      header: 'Usuario',
      cell: ({ row }) => <span className="flex items-center gap-2 font-mono text-xs"><UserRound className="size-3.5 text-muted-foreground" /> {row.original.userId}</span>,
    },
    {
      accessorKey: 'motivo',
      header: 'Motivo',
      cell: ({ row }) => <p className="max-w-xl truncate text-sm text-muted-foreground">{row.original.motivo}</p>,
    },
    {
      accessorKey: 'moderadorId',
      header: 'Moderador',
      cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.moderadorId}</span>,
    },
    {
      accessorKey: 'fecha',
      header: ({ column }) => <SortableHeader column={column}>Fecha</SortableHeader>,
      cell: ({ row }) => <span className="whitespace-nowrap text-xs text-muted-foreground">{fecha(row.original.fecha)}</span>,
    },
    {
      id: 'estado',
      accessorFn: (aviso) => aviso.activo ? 'activo' : 'retirado',
      header: 'Estado',
      cell: ({ row }) => <Badge variant={row.original.activo ? 'default' : 'outline'} className="font-normal">{row.original.activo ? 'Activo' : 'Retirado'}</Badge>,
    },
    {
      id: 'buscar',
      accessorFn: (aviso) => `${aviso.id} ${aviso.userId} ${aviso.moderadorId} ${aviso.motivo}`,
      enableHiding: false,
    },
    {
      id: 'acciones',
      enableHiding: false,
      cell: ({ row }) => <Button variant="ghost" size="sm" onClick={() => setSeleccionado(row.original)}><Eye className="size-3.5" /> Ver</Button>,
    },
  ], []);

  return (
    <>
      <DataTable
        columns={columns}
        data={avisos}
        searchColumn="buscar"
        hiddenColumns={['buscar']}
        searchPlaceholder="Buscar usuario, moderador o motivo…"
        filters={[{ columnId: 'estado', label: 'Estado', options: [{ label: 'Activo', value: 'activo' }, { label: 'Retirado', value: 'retirado' }] }]}
        emptyMessage="No hay avisos para los filtros seleccionados."
      />
      <Sheet open={Boolean(seleccionado)} onOpenChange={(abierto) => { if (!abierto) setSeleccionado(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-lg!">
          {seleccionado ? <ModerationDetail aviso={seleccionado} /> : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function ModerationDetail({ aviso }: { aviso: AvisoModeracion }) {
  return (
    <>
      <SheetHeader className="border-b pr-12">
        <Badge variant={aviso.activo ? 'default' : 'outline'} className="mb-2 w-fit">{aviso.activo ? 'Sanción activa' : 'Sanción retirada'}</Badge>
        <SheetTitle>Aviso de moderación</SheetTitle>
        <SheetDescription className="font-mono">{aviso.id}</SheetDescription>
      </SheetHeader>
      <div className="space-y-5 p-4">
        <div className="grid grid-cols-2 gap-4">
          <Detail icon={UserRound} label="Usuario" value={aviso.userId} />
          <Detail icon={ShieldCheck} label="Moderador" value={aviso.moderadorId} />
        </div>
        <Separator />
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium"><Gavel className="size-4 text-muted-foreground" /> Motivo</div>
          <p className="rounded-lg border bg-muted/20 p-4 text-sm leading-6">{aviso.motivo}</p>
        </div>
        <Separator />
        <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Fecha del aviso</span><span>{fecha(aviso.fecha)}</span></div>
      </div>
    </>
  );
}

function Detail({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: string }) {
  return <div><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="size-3.5" /> {label}</p><p className="mt-1 break-all font-mono text-xs">{value}</p></div>;
}

function fecha(valor: number) {
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(valor);
}
