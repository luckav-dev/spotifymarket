import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Comprobacion optimista: sin cookie de sesion, redirige antes de tocar
 * ninguna pagina protegida.
 *
 * Proxy no es el sitio para la comprobacion real (Next lo advierte
 * explicitamente: no esta pensado para I/O lento ni como solucion completa de
 * sesion). La verificacion de verdad -firma valida, no caducada- vive en el
 * layout de (dashboard), que corre en el servidor y puede rechazar sin
 * exponer nada al cliente.
 */
export function proxy(request: NextRequest) {
  const tieneCookie = request.cookies.has('sesion');

  if (!tieneCookie && !request.nextUrl.pathname.startsWith('/login')) {
    const destino = new URL('/login', request.url);
    destino.searchParams.set('volver', request.nextUrl.pathname);
    return NextResponse.redirect(destino);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/inicio/:path*',
    '/bot/:path*',
    '/tickets/:path*',
    '/moderacion/:path*',
    '/catalogo/:path*',
    '/anuncios/:path*',
    '/paneles/:path*',
    '/configuracion/:path*',
  ],
};
