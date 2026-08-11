'use server';

import { revalidatePath } from 'next/cache';

import { api, ErrorApi, type Producto } from '@/lib/api';
import { requerirSesion } from '@/lib/sesion';

export type EstadoFormulario = {
  ok: boolean;
  error: string | null;
};

const VACIO: EstadoFormulario = { ok: false, error: null };

function leerProducto(datos: FormData): Omit<Producto, 'id' | 'visible'> | { error: string } {
  const nombre = String(datos.get('nombre') ?? '').trim();
  const descripcion = String(datos.get('descripcion') ?? '').trim();
  const precioTexto = String(datos.get('precio') ?? '').trim().replace(',', '.');
  const stockTexto = String(datos.get('stock') ?? '').trim();
  const categoria = String(datos.get('categoria') ?? '').trim();
  const imagen = String(datos.get('imagen') ?? '').trim();

  if (!nombre) return { error: 'Falta el nombre.' };
  if (!descripcion) return { error: 'Falta la descripcion.' };
  if (!categoria) return { error: 'Falta la categoria.' };

  const precio = Number(precioTexto);
  if (!Number.isFinite(precio) || precio < 0) return { error: 'El precio no es valido.' };

  const sinLimite = ['bajo pedido', 'ilimitado', 'sin limite', '-1'].includes(stockTexto.toLowerCase());
  const stock = sinLimite ? -1 : Number.parseInt(stockTexto, 10);
  if (!sinLimite && (!Number.isInteger(stock) || stock < 0)) {
    return { error: 'El stock tiene que ser un entero, o "bajo pedido".' };
  }

  if (imagen && !/^https:\/\//i.test(imagen)) {
    return { error: 'La imagen tiene que ser una URL https, o quedarse vacia.' };
  }

  return { nombre, descripcion, precio, stock, categoria, imagen };
}

export async function crearProductoAction(
  _previo: EstadoFormulario,
  datos: FormData,
): Promise<EstadoFormulario> {
  await requerirSesion();

  const producto = leerProducto(datos);
  if ('error' in producto) return { ok: false, error: producto.error };

  try {
    await api.crearProducto(producto);
  } catch (error) {
    return { ok: false, error: error instanceof ErrorApi ? error.message : 'Error creando el producto' };
  }

  revalidatePath('/catalogo');
  return { ok: true, error: null };
}

export async function editarProductoAction(
  id: string,
  _previo: EstadoFormulario,
  datos: FormData,
): Promise<EstadoFormulario> {
  await requerirSesion();

  const producto = leerProducto(datos);
  if ('error' in producto) return { ok: false, error: producto.error };

  try {
    await api.editarProducto(id, producto);
  } catch (error) {
    return { ok: false, error: error instanceof ErrorApi ? error.message : 'Error editando el producto' };
  }

  revalidatePath('/catalogo');
  return { ok: true, error: null };
}

export async function cambiarVisibilidadAction(id: string, visible: boolean) {
  await requerirSesion();
  await api.editarProducto(id, { visible });
  revalidatePath('/catalogo');
}

export async function borrarProductoAction(id: string) {
  await requerirSesion();
  await api.borrarProducto(id);
  revalidatePath('/catalogo');
}

export const estadoInicial = VACIO;
