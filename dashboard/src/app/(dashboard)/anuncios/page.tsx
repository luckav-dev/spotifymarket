import { Megaphone } from 'lucide-react';

import { api, ErrorApi } from '@/lib/api';
import { ErrorConexion } from '@/components/dashboard/error-conexion';
import { PageHeader } from '@/components/dashboard/page-header';
import { CompositorAnuncios } from './composer';

export const dynamic = 'force-dynamic';

export default async function PaginaAnuncios() {
  let recursos, emojisPorRol: Record<string, string>;

  try {
    const [resRecursos, resEmojis, resConfigEmojis] = await Promise.all([api.recursos(), api.emojis(), api.leerConfig('emojis')]);
    recursos = resRecursos;
    const roles = (resConfigEmojis.datos.roles as Record<string, string>) ?? {};
    emojisPorRol = Object.fromEntries(Object.entries(roles).map(([rol, archivo]) => [rol, resEmojis.emojis[archivo]]).filter(([, mencion]) => Boolean(mencion)));
  } catch (error) {
    return <ErrorConexion mensaje={error instanceof ErrorApi ? error.message : 'Error desconocido'} />;
  }

  if (!recursos.canalesTexto.length) return <ErrorConexion mensaje="El bot no ve ningún canal de texto en el servidor." />;

  return (
    <div className="mx-auto max-w-screen-2xl space-y-5">
      <PageHeader eyebrow="Publicación" icon={Megaphone} title="Anuncios" description="Construye mensajes por bloques, reordénalos y comprueba el resultado antes de publicarlos." status="Components V2" />
      <CompositorAnuncios recursos={recursos} emojisPorRol={emojisPorRol} />
    </div>
  );
}
