'use server';

import { revalidatePath } from 'next/cache';

import { guardarConfigAction } from '../configuracion/actions';
import { api, ErrorApi } from '@/lib/api';
import type { JsonValor } from '@/lib/json';
import { requerirSesion } from '@/lib/sesion';

export async function guardarControlBotAction(nombre: 'bot' | 'status' | 'brand', datos: JsonValor) {
  const resultado = await guardarConfigAction(nombre, datos);
  if (resultado.ok) revalidatePath('/bot');
  return resultado;
}

export async function ejecutarControlAction(accion: 'presencia' | 'comandos' | 'emojis') {
  await requerirSesion();
  try {
    const datos = await api.control(accion);
    revalidatePath('/bot');
    revalidatePath('/inicio');
    return { ok: true as const, datos, error: null };
  } catch (error) {
    return {
      ok: false as const,
      datos: null,
      error: error instanceof ErrorApi ? error.message : 'No se pudo ejecutar la acción.',
    };
  }
}
