export function formatearPrecio(valor: number, simbolo = '€') {
  return `${valor.toFixed(2)}${simbolo}`;
}

export function formatearDuracion(ms: number) {
  const unidades: [string, number][] = [
    ['d', 86_400_000],
    ['h', 3_600_000],
    ['m', 60_000],
  ];

  const partes: string[] = [];
  let resto = ms;

  for (const [sufijo, tamano] of unidades) {
    const cantidad = Math.floor(resto / tamano);
    if (cantidad) {
      partes.push(`${cantidad}${sufijo}`);
      resto -= cantidad * tamano;
    }
  }

  return partes.length ? partes.join(' ') : 'menos de 1m';
}

/**
 * Extrae la URL del CDN de un emoji a partir de su mencion (<:nombre:id> o
 * <a:nombre:id>), tal como lo devuelve emojiManager.get() en el bot. Se usa
 * solo para la vista previa del compositor de anuncios.
 */
export function urlEmojiCdn(mencion: string): string | null {
  const m = /^<(a)?:\w+:(\d+)>$/.exec(mencion);
  if (!m) return null;
  return `https://cdn.discordapp.com/emojis/${m[2]}.${m[1] ? 'gif' : 'png'}?size=24`;
}

export function formatearFechaRelativa(ms: number) {
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  const futuro = diff < 0;

  const texto = formatearDuracion(abs);
  return futuro ? `en ${texto}` : `hace ${texto}`;
}
