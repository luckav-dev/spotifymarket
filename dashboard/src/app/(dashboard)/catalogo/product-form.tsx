'use client';

import { useState, useTransition } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, PackagePlus, Pencil, Plus, Save } from 'lucide-react';
import { z } from 'zod';
import { toast } from 'sonner';

import type { Producto } from '@/lib/api';
import { crearProductoAction, editarProductoAction, estadoInicial } from './actions';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const productoSchema = z.object({
  nombre: z.string().trim().min(2, 'Escribe al menos 2 caracteres.').max(80, 'Máximo 80 caracteres.'),
  descripcion: z.string().trim().min(10, 'Describe el producto con al menos 10 caracteres.').max(800, 'Máximo 800 caracteres.'),
  precio: z.string().trim().refine((valor) => {
    const numero = Number(valor.replace(',', '.'));
    return Number.isFinite(numero) && numero >= 0;
  }, 'Introduce un precio válido.'),
  stock: z.string().trim().refine((valor) => {
    if (['bajo pedido', 'ilimitado', 'sin limite', 'sin límite', '-1'].includes(valor.toLowerCase())) return true;
    const numero = Number(valor);
    return Number.isInteger(numero) && numero >= 0;
  }, 'Usa un número entero o “bajo pedido”.'),
  categoria: z.string().trim().min(1, 'Selecciona una categoría.'),
  imagen: z.string().trim().refine((valor) => !valor || /^https:\/\//i.test(valor), 'La imagen debe usar una URL https.'),
});

type ProductoForm = z.infer<typeof productoSchema>;

function valoresIniciales(producto?: Producto): ProductoForm {
  return {
    nombre: producto?.nombre ?? '',
    descripcion: producto?.descripcion ?? '',
    precio: producto ? String(producto.precio) : '',
    stock: producto ? (producto.stock === -1 ? 'bajo pedido' : String(producto.stock)) : '',
    categoria: producto?.categoria ?? '',
    imagen: producto?.imagen ?? '',
  };
}

function FormularioProducto({ producto, categorias, onGuardado }: { producto?: Producto; categorias: string[]; onGuardado: () => void }) {
  const [pendiente, iniciar] = useTransition();
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<ProductoForm>({
    resolver: zodResolver(productoSchema),
    defaultValues: valoresIniciales(producto),
    mode: 'onBlur',
  });

  const guardar = handleSubmit((valores) => {
    iniciar(async () => {
      const datos = new FormData();
      Object.entries(valores).forEach(([clave, valor]) => datos.set(clave, valor));
      const accion = producto ? editarProductoAction.bind(null, producto.id) : crearProductoAction;
      const resultado = await accion(estadoInicial, datos);

      if (!resultado.ok) {
        toast.error(resultado.error ?? 'No se pudo guardar el producto.');
        return;
      }

      toast.success(producto ? 'Producto actualizado' : 'Producto añadido');
      reset(valores);
      onGuardado();
    });
  });

  return (
    <form onSubmit={guardar} className="flex min-h-0 flex-1 flex-col">
      <div className="dashboard-scroll flex-1 overflow-y-auto px-4 pb-6">
        <FieldGroup>
          <Field data-invalid={Boolean(errors.nombre)}>
            <FieldLabel htmlFor={`nombre-${producto?.id ?? 'nuevo'}`}>Nombre</FieldLabel>
            <Input id={`nombre-${producto?.id ?? 'nuevo'}`} {...register('nombre')} aria-invalid={Boolean(errors.nombre)} placeholder="Spotify Premium Individual" />
            <FieldError errors={[errors.nombre]} />
          </Field>

          <Field data-invalid={Boolean(errors.descripcion)}>
            <FieldLabel htmlFor={`descripcion-${producto?.id ?? 'nuevo'}`}>Descripción</FieldLabel>
            <Textarea id={`descripcion-${producto?.id ?? 'nuevo'}`} {...register('descripcion')} aria-invalid={Boolean(errors.descripcion)} rows={6} placeholder="Qué incluye, duración y condiciones del producto…" />
            <div className="flex justify-between gap-3">
              <FieldDescription>Este texto aparece en el catálogo del bot.</FieldDescription>
              <FieldError errors={[errors.descripcion]} />
            </div>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={Boolean(errors.precio)}>
              <FieldLabel htmlFor={`precio-${producto?.id ?? 'nuevo'}`}>Precio</FieldLabel>
              <Input id={`precio-${producto?.id ?? 'nuevo'}`} {...register('precio')} aria-invalid={Boolean(errors.precio)} inputMode="decimal" placeholder="9,99" />
              <FieldError errors={[errors.precio]} />
            </Field>
            <Field data-invalid={Boolean(errors.stock)}>
              <FieldLabel htmlFor={`stock-${producto?.id ?? 'nuevo'}`}>Stock</FieldLabel>
              <Input id={`stock-${producto?.id ?? 'nuevo'}`} {...register('stock')} aria-invalid={Boolean(errors.stock)} placeholder="bajo pedido" />
              <FieldError errors={[errors.stock]} />
            </Field>
          </div>

          <Field data-invalid={Boolean(errors.categoria)}>
            <FieldLabel>Categoría</FieldLabel>
            <Controller
              control={control}
              name="categoria"
              render={({ field }) => (
                <Select value={field.value} onValueChange={(valor) => field.onChange(valor ?? '')}>
                  <SelectTrigger className="w-full" aria-invalid={Boolean(errors.categoria)}>
                    <SelectValue placeholder="Selecciona una categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    {categorias.map((categoria) => <SelectItem key={categoria} value={categoria}>{categoria}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError errors={[errors.categoria]} />
          </Field>

          <Field data-invalid={Boolean(errors.imagen)}>
            <FieldLabel htmlFor={`imagen-${producto?.id ?? 'nuevo'}`}>Imagen</FieldLabel>
            <Input id={`imagen-${producto?.id ?? 'nuevo'}`} {...register('imagen')} aria-invalid={Boolean(errors.imagen)} placeholder="https://…" />
            <FieldDescription>Opcional. Debe ser una URL HTTPS accesible por Discord.</FieldDescription>
            <FieldError errors={[errors.imagen]} />
          </Field>
        </FieldGroup>
      </div>

      <SheetFooter className="flex-row items-center justify-between border-t">
        <span className="text-xs text-muted-foreground">{isDirty ? 'Cambios sin guardar' : 'Sin cambios pendientes'}</span>
        <Button type="submit" disabled={pendiente || !isDirty}>
          {pendiente ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Guardar producto
        </Button>
      </SheetFooter>
    </form>
  );
}

function ProductSheet({ producto, categorias, trigger }: { producto?: Producto; categorias: string[]; trigger: React.ReactElement }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <Sheet open={abierto} onOpenChange={setAbierto}>
      <SheetTrigger render={trigger} />
      <SheetContent side="right" className="w-full sm:max-w-xl!">
        <SheetHeader className="border-b pr-12">
          <div className="mb-2 flex size-9 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
            <PackagePlus className="size-4" />
          </div>
          <SheetTitle>{producto ? 'Editar producto' : 'Nuevo producto'}</SheetTitle>
          <SheetDescription>{producto ? `Actualiza la información de ${producto.nombre}.` : 'Completa la información que verá el cliente en el catálogo.'}</SheetDescription>
        </SheetHeader>
        <FormularioProducto producto={producto} categorias={categorias} onGuardado={() => setAbierto(false)} />
      </SheetContent>
    </Sheet>
  );
}

export function DialogoNuevoProducto({ categorias }: { categorias: string[] }) {
  return (
    <ProductSheet
      categorias={categorias}
      trigger={<Button><Plus className="size-4" /> Nuevo producto</Button>}
    />
  );
}

export function DialogoEditarProducto({ producto, categorias }: { producto: Producto; categorias: string[] }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span>
            <ProductSheet
              producto={producto}
              categorias={categorias}
              trigger={<Button variant="ghost" size="icon" aria-label={`Editar ${producto.nombre}`}><Pencil className="size-3.5" /></Button>}
            />
          </span>
        }
      />
      <TooltipContent>Editar producto</TooltipContent>
    </Tooltip>
  );
}
