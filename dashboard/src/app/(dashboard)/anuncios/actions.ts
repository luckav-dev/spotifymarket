'use server';

import { api, ErrorApi, type Bloque } from '@/lib/api';
import { requerirSesion } from '@/lib/sesion';

export type ResultadoValidacion = { ok: boolean; problemas: string[] };

export async function validarAnuncioAction(bloques: Bloque[]): Promise<ResultadoValidacion> {
  await requerirSesion();

  try {
    return await api.validarAnuncio(bloques);
  } catch (error) {
    return { ok: false, problemas: [error instanceof ErrorApi ? error.message : 'Error validando'] };
  }
}

export type ResultadoEnvio =
  | { ok: true; url: string }
  | { ok: false; error: string; problemas?: string[] };

export async function enviarAnuncioAction(
  canalId: string,
  bloques: Bloque[],
  mencion: string,
): Promise<ResultadoEnvio> {
  await requerirSesion();

  if (!canalId) return { ok: false, error: 'Elige un canal antes de enviar.' };

  try {
    const resultado = await api.enviarAnuncio(canalId, bloques, mencion);
    return { ok: true, url: resultado.url };
  } catch (error) {
    if (error instanceof ErrorApi) {
      return { ok: false, error: error.message, problemas: error.problemas };
    }
    return { ok: false, error: 'Error enviando el anuncio' };
  }
}
