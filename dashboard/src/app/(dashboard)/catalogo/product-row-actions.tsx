'use client';

import { useState, useTransition } from 'react';
import { Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import type { Producto } from '@/lib/api';
import { cambiarVisibilidadAction, borrarProductoAction } from './actions';
import { DialogoEditarProducto } from './product-form';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

export function AccionesFila({ producto, categorias }: { producto: Producto; categorias: string[] }) {
  const [cambiandoVisibilidad, iniciarCambioVisibilidad] = useTransition();
  const [borrando, iniciarBorrado] = useTransition();
  const [confirmarAbierto, setConfirmarAbierto] = useState(false);

  function alternarVisibilidad(visible: boolean) {
    iniciarCambioVisibilidad(async () => {
      await cambiarVisibilidadAction(producto.id, visible);
      toast.success(visible ? 'Producto publicado' : 'Producto oculto');
    });
  }

  function confirmarBorrado() {
    iniciarBorrado(async () => {
      await borrarProductoAction(producto.id);
      // Se cierra al terminar, no al pulsar: si el borrado fallara, el dialogo
      // de confirmacion seguiria abierto en vez de desaparecer por delante.
      setConfirmarAbierto(false);
      toast.success('Producto eliminado');
    });
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      <Switch
        checked={producto.visible}
        disabled={cambiandoVisibilidad}
        onCheckedChange={alternarVisibilidad}
        aria-label={producto.visible ? 'Ocultar producto' : 'Publicar producto'}
      />

      <DialogoEditarProducto producto={producto} categorias={categorias} />

      <AlertDialog open={confirmarAbierto} onOpenChange={setConfirmarAbierto}>
        <AlertDialogTrigger
          render={
            <Button variant="ghost" size="icon" className="size-8 text-destructive hover:bg-destructive/10">
              <Trash2 className="size-3.5" />
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar {producto.nombre}</AlertDialogTitle>
            <AlertDialogDescription>
              Esta accion no se puede deshacer. El producto desaparecera del catalogo y del panel publicado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmarBorrado}
              disabled={borrando}
              className="gap-1.5 bg-destructive text-white hover:bg-destructive/90"
            >
              {borrando && <Loader2 className="size-3.5 animate-spin" />}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
