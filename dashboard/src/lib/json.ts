export type JsonPrimitivo = string | number | boolean | null;
export type JsonValor = JsonPrimitivo | JsonValor[] | { [clave: string]: JsonValor };
export type JsonObjeto = { [clave: string]: JsonValor };

/**
 * Clona la forma de un valor con las hojas vaciadas: strings a '', numeros a
 * 0, booleanos a false, arrays a [] y objetos con las mismas claves pero
 * vaciados recursivamente.
 *
 * Se usa para anadir una entrada nueva a un diccionario (un rol de staff, una
 * categoria de ticket, un tramo de escalado...) clonando la forma de una
 * entrada hermana en vez de pedirle al usuario que sepa que campos hacen
 * falta.
 */
export function formaVacia(valor: JsonValor): JsonValor {
  if (Array.isArray(valor)) return [];
  if (valor !== null && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, formaVacia(v)]));
  }
  if (typeof valor === 'string') return '';
  if (typeof valor === 'number') return 0;
  if (typeof valor === 'boolean') return false;
  return null;
}

export function esObjeto(valor: JsonValor): valor is JsonObjeto {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}
