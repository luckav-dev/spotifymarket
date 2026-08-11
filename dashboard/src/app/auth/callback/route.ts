import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { intercambiarCodigo, obtenerUsuario, urlAvatar } from '@/lib/discord';
import { iniciarSesion } from '@/lib/sesion';
import { api, ErrorApi } from '@/lib/api';

export const dynamic = 'force-dynamic';

/** Vuelta de Discord: cambia el code por un token, resuelve el acceso contra el bot y abre sesion. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorDiscord = url.searchParams.get('error');

  const almacen = await cookies();
  const stateEsperado = almacen.get('oauth_state')?.value;
  almacen.delete('oauth_state');

  if (errorDiscord) {
    return NextResponse.redirect(new URL('/login?error=cancelado', url));
  }

  // Comparacion en tiempo constante: el state no es secreto, pero es el unico
  // guardian contra que un enlace ajeno complete un login por la victima.
  if (!code || !state || !stateEsperado || !tiempoConstanteIgual(state, stateEsperado)) {
    return NextResponse.redirect(new URL('/login?error=state_invalido', url));
  }

  try {
    const { access_token } = await intercambiarCodigo(code);
    const usuario = await obtenerUsuario(access_token);
    const acceso = await api.acceso(usuario.id);

    if (!acceso.permitido) {
      return NextResponse.redirect(new URL('/login?error=sin_permiso', url));
    }

    await iniciarSesion({
      id: usuario.id,
      nombre: usuario.global_name ?? usuario.username,
      avatar: urlAvatar(usuario),
      nivel: acceso.nivel,
      esDueno: acceso.esDueno,
    });

    return NextResponse.redirect(new URL('/inicio', url));
  } catch (error) {
    const mensaje = error instanceof ErrorApi ? error.message : 'Error completando el login';
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(mensaje)}`, url));
  }
}

function tiempoConstanteIgual(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
