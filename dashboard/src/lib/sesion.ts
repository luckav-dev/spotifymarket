import 'server-only';

import crypto from 'node:crypto';
import { cookies } from 'next/headers';

/**
 * Sesion en cookie firmada.
 *
 * Se firma con HMAC en vez de tirar de una libreria de JWT: el contenido no es
 * secreto, solo tiene que ser infalsificable, y asi el dashboard no arrastra
 * una dependencia mas para cuatro campos.
 */

const COOKIE = 'sesion';
const DURACION_MS = 8 * 60 * 60 * 1000;

export type Sesion = {
  id: string;
  nombre: string;
  avatar: string | null;
  nivel: number;
  esDueno: boolean;
  expira: number;
};

function secreto() {
  const valor = process.env.SESSION_SECRET;
  if (!valor || valor.length < 32) {
    throw new Error('SESSION_SECRET tiene que existir y medir al menos 32 caracteres.');
  }
  return valor;
}

function firmar(carga: string) {
  return crypto.createHmac('sha256', secreto()).update(carga).digest('base64url');
}

export function serializar(sesion: Sesion) {
  const carga = Buffer.from(JSON.stringify(sesion)).toString('base64url');
  return `${carga}.${firmar(carga)}`;
}

export function deserializar(valor: string | undefined): Sesion | null {
  if (!valor) return null;

  const [carga, firma] = valor.split('.');
  if (!carga || !firma) return null;

  const esperada = firmar(carga);

  // Comparacion en tiempo constante. Las dos firmas son base64url de 32 bytes,
  // asi que aqui las longitudes siempre coinciden.
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const sesion = JSON.parse(Buffer.from(carga, 'base64url').toString('utf8')) as Sesion;
    return sesion.expira > Date.now() ? sesion : null;
  } catch {
    return null;
  }
}

export async function sesionActual(): Promise<Sesion | null> {
  const almacen = await cookies();
  return deserializar(almacen.get(COOKIE)?.value);
}

/**
 * Para usar al principio de cada Server Action.
 *
 * El layout ya protege las paginas, pero una Server Action es un endpoint
 * propio que un cliente podria llamar directamente sin pasar por la pagina:
 * cada una vuelve a comprobar la sesion en vez de confiar en que solo se
 * invoca desde una pantalla protegida.
 */
export async function requerirSesion(): Promise<Sesion> {
  const sesion = await sesionActual();
  if (!sesion) throw new Error('Sesion no valida o caducada. Vuelve a iniciar sesion.');
  return sesion;
}

export async function iniciarSesion(datos: Omit<Sesion, 'expira'>) {
  const almacen = await cookies();
  const sesion: Sesion = { ...datos, expira: Date.now() + DURACION_MS };

  almacen.set(COOKIE, serializar(sesion), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: DURACION_MS / 1000,
  });
}

export async function cerrarSesion() {
  const almacen = await cookies();
  almacen.delete(COOKIE);
}

export const NOMBRE_COOKIE = COOKIE;
