import { Archive, Headphones, Star, TicketCheck } from 'lucide-react';

import { api, ErrorApi } from '@/lib/api';
import { ErrorConexion } from '@/components/dashboard/error-conexion';
import { PageHeader } from '@/components/dashboard/page-header';
import { StatCard } from '@/components/dashboard/stat-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ExploradorTickets } from './ticket-explorer';

export const dynamic = 'force-dynamic';

export default async function PaginaTickets() {
  let datos;
  let resumenAlternativo: Awaited<ReturnType<typeof api.estado>>['tickets'] | null = null;
  let requiereReinicio = false;

  try {
    datos = await api.tickets();
  } catch (error) {
    if (error instanceof ErrorApi && error.estado === 404) {
      resumenAlternativo = (await api.estado()).tickets;
      datos = { activos: [], archivados: [], valoraciones: [] };
      requiereReinicio = true;
    } else {
      return <ErrorConexion mensaje={error instanceof ErrorApi ? error.message : 'Error desconocido'} />;
    }
  }

  const media = resumenAlternativo?.valoracionMedia ?? (datos.valoraciones.length
    ? datos.valoraciones.reduce((total, valoracion) => total + valoracion.estrellas, 0) / datos.valoraciones.length
    : null);
  const activos = resumenAlternativo?.abiertos ?? datos.activos.length;
  const archivados = resumenAlternativo?.cerrados ?? datos.archivados.length;

  return (
    <div className="mx-auto max-w-screen-2xl space-y-6">
      <PageHeader eyebrow="Operaciones" icon={Headphones} title="Tickets" description="Filtra conversaciones, consulta formularios, responsables, prioridades y el historial del soporte." status="Datos en directo" />
      {requiereReinicio ? <Alert><AlertTitle>El bot necesita reiniciarse</AlertTitle><AlertDescription>El resumen es real, pero la lista detallada se activará cuando el proceso del bot cargue la API nueva.</AlertDescription></Alert> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Headphones} label="En curso" value={String(activos)} />
        <StatCard icon={Archive} label="Archivados" value={String(archivados)} />
        <StatCard icon={Star} label="Valoración media" value={media ? `${media.toFixed(1)}/5` : '—'} />
        <StatCard icon={TicketCheck} label="Atendidos total" value={String(activos + archivados)} />
      </div>
      <ExploradorTickets activos={datos.activos} archivados={datos.archivados} />
    </div>
  );
}
