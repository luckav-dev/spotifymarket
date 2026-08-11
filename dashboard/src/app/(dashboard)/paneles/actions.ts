'use server';

import { api, ErrorApi } from '@/lib/api';
import { requerirSesion } from '@/lib/sesion';

export type ResultadoPanel = { ok: true; url: string } | { ok: false; error: string };

export async function publicarPanelAction(tipo: string, canalId: string): Promise<ResultadoPanel> {
  await requerirSesion();

  if (!canalId) return { ok: false, error: 'Elige un canal.' };

  try {
    const { url } = await api.publicarPanel(tipo, canalId);
    return { ok: true, url };
  } catch (error) {
    return { ok: false, error: error instanceof ErrorApi ? error.message : 'Error publicando el panel' };
  }
}
