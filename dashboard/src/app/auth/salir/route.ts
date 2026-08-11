import { NextResponse } from 'next/server';

import { cerrarSesion } from '@/lib/sesion';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  await cerrarSesion();
  return NextResponse.redirect(new URL('/login', request.url));
}
