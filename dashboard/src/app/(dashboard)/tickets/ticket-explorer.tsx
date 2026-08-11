'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Clock3, Eye, MessageSquareText, Star, Tag, UserRound } from 'lucide-react';

import type { TicketDashboard } from '@/lib/api';
import { DataTable, SortableHeader } from '@/components/dashboard/data-table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function ExploradorTickets({ activos, archivados }: { activos: TicketDashboard[]; archivados: TicketDashboard[] }) {
  const [seleccionado, setSeleccionado] = useState<TicketDashboard | null>(null);
  const categorias = useMemo(() => [...new Set([...activos, ...archivados].map((ticket) => ticket.categoria))].sort(), [activos, archivados]);

  const columns = useMemo<ColumnDef<TicketDashboard>[]>(() => [
    {
      accessorKey: 'id',
      header: ({ column }) => <SortableHeader column={column}>Ticket</SortableHeader>,
      cell: ({ row }) => <span className="font-mono text-xs">#{String(row.original.id).padStart(4, '0')}</span>,
    },
    {
      accessorKey: 'userId',
      header: 'Usuario',
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5">
          <Avatar className="size-7"><AvatarImage src={row.original.avatarUrl ?? undefined} /><AvatarFallback><UserRound className="size-3.5" /></AvatarFallback></Avatar>
          <span className="max-w-40 truncate font-mono text-xs">{row.original.userId}</span>
        </div>
      ),
    },
    {
      accessorKey: 'categoria',
      header: 'Categoría',
      cell: ({ row }) => <Badge variant="secondary" className="font-normal"><Tag className="size-3" /> {row.original.categoria}</Badge>,
    },
    {
      id: 'prioridad',
      accessorFn: (ticket) => prioridad(ticket.prioridad),
      header: 'Prioridad',
      cell: ({ row }) => <PriorityBadge value={row.original.prioridad} />,
    },
    {
      accessorKey: 'reclamadoPor',
      header: 'Responsable',
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.reclamadoPor ?? 'Sin reclamar'}</span>,
    },
    {
      accessorKey: 'ultimaActividad',
      header: ({ column }) => <SortableHeader column={column}>Actividad</SortableHeader>,
      cell: ({ row }) => <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"><Clock3 className="size-3.5" /> {fecha(row.original.ultimaActividad)}</span>,
    },
    {
      id: 'buscar',
      accessorFn: (ticket) => `${ticket.id} ${ticket.userId} ${ticket.categoria} ${ticket.reclamadoPor ?? ''} ${Object.values(ticket.respuestas).join(' ')}`,
      enableHiding: false,
    },
    {
      id: 'acciones',
      enableHiding: false,
      cell: ({ row }) => <Button variant="ghost" size="sm" onClick={() => setSeleccionado(row.original)}><Eye className="size-3.5" /> Ver</Button>,
    },
  ], []);

  const filters = [
    { columnId: 'categoria', label: 'Categoría', options: categorias.map((categoria) => ({ label: categoria, value: categoria })) },
    { columnId: 'prioridad', label: 'Prioridad', options: [1, 2, 3].map((valor) => ({ label: prioridad(valor), value: prioridad(valor) })) },
  ];

  return (
    <>
      <Tabs defaultValue="activos">
        <TabsList>
          <TabsTrigger value="activos">Activos <Badge variant="secondary">{activos.length}</Badge></TabsTrigger>
          <TabsTrigger value="archivados">Archivados <Badge variant="secondary">{archivados.length}</Badge></TabsTrigger>
        </TabsList>
        <TabsContent value="activos" className="mt-4">
          <DataTable key="activos" columns={columns} data={activos} searchColumn="buscar" hiddenColumns={['buscar']} searchPlaceholder="Buscar ID, usuario o respuesta…" filters={filters} emptyMessage="No hay tickets activos para estos filtros." />
        </TabsContent>
        <TabsContent value="archivados" className="mt-4">
          <DataTable key="archivados" columns={columns} data={archivados} searchColumn="buscar" hiddenColumns={['buscar']} searchPlaceholder="Buscar en el historial…" filters={filters} emptyMessage="No hay tickets archivados para estos filtros." />
        </TabsContent>
      </Tabs>

      <Sheet open={Boolean(seleccionado)} onOpenChange={(abierto) => { if (!abierto) setSeleccionado(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-xl!">
          {seleccionado ? <TicketDetail ticket={seleccionado} /> : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function TicketDetail({ ticket }: { ticket: TicketDashboard }) {
  return (
    <>
      <SheetHeader className="border-b pr-12">
        <Badge variant="outline" className="mb-2 w-fit font-mono">Ticket #{String(ticket.id).padStart(4, '0')}</Badge>
        <SheetTitle>{ticket.categoria}</SheetTitle>
        <SheetDescription>Abierto por {ticket.userId} · {fecha(ticket.abiertoEn)}</SheetDescription>
      </SheetHeader>
      <div className="dashboard-scroll flex-1 space-y-5 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-3">
          <Detail label="Estado" value={ticket.estado} />
          <Detail label="Prioridad" value={prioridad(ticket.prioridad)} />
          <Detail label="Responsable" value={ticket.reclamadoPor ?? 'Sin reclamar'} />
          <Detail label="Última actividad" value={fecha(ticket.ultimaActividad)} />
        </div>
        <Separator />
        <div>
          <div className="mb-3 flex items-center gap-2"><MessageSquareText className="size-4 text-muted-foreground" /><h3 className="text-sm font-medium">Respuestas del formulario</h3></div>
          <div className="space-y-3">
            {Object.entries(ticket.respuestas).map(([clave, valor]) => <Detail key={clave} label={clave} value={valor} full />)}
          </div>
        </div>
        {ticket.motivoCierre ? <><Separator /><Detail label="Motivo de cierre" value={ticket.motivoCierre} full /></> : null}
        {ticket.valoracion ? (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
            <Star className="size-4 fill-primary text-primary" /> {ticket.valoracion} de 5
          </div>
        ) : null}
      </div>
    </>
  );
}

function Detail({ label, value, full = false }: { label: string; value: string; full?: boolean }) {
  return <div className={full ? 'rounded-lg border p-3' : ''}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm">{value}</p></div>;
}

function PriorityBadge({ value }: { value: number }) {
  return <Badge variant={value >= 3 ? 'destructive' : value === 2 ? 'secondary' : 'outline'} className="font-normal">{prioridad(value)}</Badge>;
}

function fecha(valor: number) {
  return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(valor);
}

function prioridad(valor: number) {
  return ({ 1: 'Baja', 2: 'Media', 3: 'Alta' } as Record<number, string>)[valor] ?? String(valor);
}
