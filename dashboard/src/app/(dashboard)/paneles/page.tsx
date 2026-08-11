import { LayoutTemplate } from 'lucide-react';

import { api, ErrorApi } from '@/lib/api';
import { ErrorConexion } from '@/components/dashboard/error-conexion';
import { PageHeader } from '@/components/dashboard/page-header';
import { TarjetaPanel } from './panel-card';

export const dynamic = 'force-dynamic';

export default async function PaginaPaneles() {
  let canales;

  try {
    canales = (await api.recursos()).canalesTexto;
  } catch (error) {
    return <ErrorConexion mensaje={error instanceof ErrorApi ? error.message : 'Error desconocido'} />;
  }

  return (
    <div className="mx-auto max-w-screen-2xl space-y-6">
      <PageHeader eyebrow="Publicación" icon={LayoutTemplate} title="Paneles del bot" description="Publica cada sistema en un canal. Si ya existe, el bot actualiza el mensaje sin duplicarlo." status="6 sistemas" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <TarjetaPanel tipo="tickets" titulo="Tickets" descripcion="Selector de categoría para abrir una solicitud de soporte." icono="tickets" canales={canales} />
        <TarjetaPanel tipo="verificacion" titulo="Verificación" descripcion="Botón que comprueba al usuario y entrega el rol configurado." icono="verificacion" canales={canales} />
        <TarjetaPanel tipo="catalogo" titulo="Catálogo" descripcion="Resumen de categorías con acceso a todos los productos." icono="catalogo" canales={canales} />
        <TarjetaPanel tipo="normas" titulo="Normas" descripcion="Panel navegable para consultar cada bloque de reglas por separado." icono="normas" canales={canales} />
        <TarjetaPanel tipo="estado" titulo="Estado del servicio" descripcion="Disponibilidad actual, nota del equipo e historial de cambios." icono="estado" canales={canales} />
        <TarjetaPanel tipo="sugerencias" titulo="Sugerencias" descripcion="Formulario de propuestas con votos y resolución del equipo." icono="sugerencias" canales={canales} />
      </div>
    </div>
  );
}
