import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { urlAutorizacion } from '@/lib/discord';

export const dynamic = 'force-dynamic';

/** Arranca el login: guarda un state anti-CSRF en cookie y redirige a Discord. */
export async function GET() {
  const state = crypto.randomBytes(24).toString('base64url');
  const almacen = await cookies();

  almacen.set('oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });

  return NextResponse.redirect(urlAutorizacion(state));
}
