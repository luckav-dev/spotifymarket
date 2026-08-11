'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Package } from 'lucide-react';

import type { Producto } from '@/lib/api';
import { formatearPrecio } from '@/lib/format';
import { DataTable, SortableHeader } from '@/components/dashboard/data-table';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { AccionesFila } from './product-row-actions';

export function CatalogTable({ productos, categorias }: { productos: Producto[]; categorias: string[] }) {
  const columns: ColumnDef<Producto>[] = [
    {
      accessorKey: 'nombre',
      header: ({ column }) => <SortableHeader column={column}>Producto</SortableHeader>,
      cell: ({ row }) => (
        <div className="max-w-md">
          <p className="font-medium">{row.original.nombre}</p>
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{row.original.descripcion}</p>
        </div>
      ),
    },
    {
      accessorKey: 'categoria',
      header: ({ column }) => <SortableHeader column={column}>Categoría</SortableHeader>,
      cell: ({ row }) => <Badge variant="secondary" className="font-normal">{row.original.categoria}</Badge>,
    },
    {
      accessorKey: 'precio',
      header: ({ column }) => <SortableHeader column={column}>Precio</SortableHeader>,
      cell: ({ row }) => <span className="font-mono text-xs">{formatearPrecio(row.original.precio)}</span>,
    },
    {
      accessorKey: 'stock',
      header: ({ column }) => <SortableHeader column={column}>Stock</SortableHeader>,
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.stock === -1 ? 'Bajo pedido' : row.original.stock}</span>,
    },
    {
      id: 'estado',
      accessorFn: (producto) => producto.visible ? 'visible' : 'oculto',
      header: 'Estado',
      cell: ({ row }) => (
        <Badge variant={row.original.visible ? 'default' : 'outline'} className="font-normal">
          {row.original.visible ? 'Visible' : 'Oculto'}
        </Badge>
      ),
    },
    {
      id: 'acciones',
      enableHiding: false,
      header: () => <span className="sr-only">Acciones</span>,
      cell: ({ row }) => <AccionesFila producto={row.original} categorias={categorias} />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={productos}
      searchColumn="nombre"
      searchPlaceholder="Buscar producto…"
      emptyMessage="No hay productos para los filtros seleccionados."
      filters={[
        { columnId: 'categoria', label: 'Categoría', options: categorias.map((categoria) => ({ label: categoria, value: categoria })) },
        { columnId: 'estado', label: 'Estado', options: [{ label: 'Visible', value: 'visible' }, { label: 'Oculto', value: 'oculto' }] },
      ]}
    />
  );
}

export function CatalogEmpty() {
  return (
    <Empty className="min-h-72 border">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Package /></EmptyMedia>
        <EmptyTitle>El catálogo está vacío</EmptyTitle>
        <EmptyDescription>Añade el primer producto para publicarlo.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
