'use server';

import { revalidatePath } from 'next/cache';

import { api, ErrorApi } from '@/lib/api';
import { requerirSesion } from '@/lib/sesion';
import { esObjeto, type JsonValor } from '@/lib/json';

export type ResultadoGuardado =
  | { ok: true; error: null; avisos: string[] }
  | { ok: false; error: string; avisos: [] };

export async function guardarConfigAction(nombre: string, datos: JsonValor): Promise<ResultadoGuardado> {
  await requerirSesion();

  if (!esObjeto(datos)) {
    return { ok: false, error: 'La configuracion raiz tiene que ser un objeto.', avisos: [] };
  }

  try {
    const respuesta = await api.guardarConfig(nombre, datos);
    revalidatePath(`/configuracion/${nombre}`);
    return { ok: true, error: null, avisos: respuesta.avisos ?? [] };
  } catch (error) {
    const mensaje = error instanceof ErrorApi
      ? [error.message, ...error.problemas].join(' · ')
      : 'Error guardando';
    return { ok: false, error: mensaje, avisos: [] };
  }
}
