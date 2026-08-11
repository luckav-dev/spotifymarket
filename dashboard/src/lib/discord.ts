import 'server-only';

/**
 * OAuth2 de Discord, flujo Authorization Code.
 *
 * Scope minimo: solo 'identify'. No se pide 'guilds.members.read' porque el
 * nivel de staff lo resuelve el bot -que ya tiene la cache de miembros y
 * permissions.json- a traves de /api/acceso. Pedir menos scope es menos
 * superficie de consentimiento para quien inicia sesion.
 */

const AUTORIZAR_URL = 'https://discord.com/oauth2/authorize';
const TOKEN_URL = 'https://discord.com/api/oauth2/token';
const USUARIO_URL = 'https://discord.com/api/users/@me';

function variable(nombre: string) {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta ${nombre} en el entorno del dashboard.`);
  return valor;
}

export function urlAutorizacion(state: string) {
  const url = new URL(AUTORIZAR_URL);
  url.searchParams.set('client_id', variable('DISCORD_CLIENT_ID'));
  url.searchParams.set('redirect_uri', variable('DISCORD_REDIRECT_URI'));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'none');
  return url.toString();
}

type RespuestaToken = { access_token: string; token_type: string };

export async function intercambiarCodigo(code: string): Promise<RespuestaToken> {
  const respuesta = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: variable('DISCORD_CLIENT_ID'),
      client_secret: variable('DISCORD_CLIENT_SECRET'),
      grant_type: 'authorization_code',
      code,
      redirect_uri: variable('DISCORD_REDIRECT_URI'),
    }),
    cache: 'no-store',
  });

  if (!respuesta.ok) {
    throw new Error(`Discord rechazo el intercambio de codigo (${respuesta.status})`);
  }

  return respuesta.json();
}

export type UsuarioDiscord = {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
};

export async function obtenerUsuario(accessToken: string): Promise<UsuarioDiscord> {
  const respuesta = await fetch(USUARIO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });

  if (!respuesta.ok) {
    throw new Error(`No se pudo obtener el usuario de Discord (${respuesta.status})`);
  }

  return respuesta.json();
}

export function urlAvatar(usuario: UsuarioDiscord) {
  if (!usuario.avatar) {
    // Avatar por defecto de Discord, determinista por id (algoritmo nuevo).
    // BigInt(22)/BigInt(6) en vez de literales 22n/6n: el target de TS del
    // proyecto es ES2017 y los literales BigInt piden ES2020 o superior.
    const indice = (BigInt(usuario.id) >> BigInt(22)) % BigInt(6);
    return `https://cdn.discordapp.com/embed/avatars/${indice}.png`;
  }
  const extension = usuario.avatar.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${usuario.id}/${usuario.avatar}.${extension}?size=64`;
}
