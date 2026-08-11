import { ShieldAlert, ShieldCheck, UsersRound } from 'lucide-react';

import { api, ErrorApi } from '@/lib/api';
import { ErrorConexion } from '@/components/dashboard/error-conexion';
import { PageHeader } from '@/components/dashboard/page-header';
import { StatCard } from '@/components/dashboard/stat-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ExploradorModeracion } from './moderation-explorer';

export const dynamic = 'force-dynamic';

export default async function PaginaModeracion() {
  let datos;
  let requiereReinicio = false;
  try {
    datos = await api.moderacion();
  } catch (error) {
    if (error instanceof ErrorApi && error.estado === 404) {
      datos = { avisos: [], activos: 0, usuarios: 0 };
      requiereReinicio = true;
    } else {
      return <ErrorConexion mensaje={error instanceof ErrorApi ? error.message : 'Error desconocido'} />;
    }
  }

  return (
    <div className="mx-auto max-w-screen-2xl space-y-6">
      <PageHeader eyebrow="Operaciones" icon={ShieldAlert} title="Moderación" description="Consulta sanciones, responsables, motivos y estado actual del historial disciplinario." status={`${datos.activos} activos`} />
      {requiereReinicio ? <Alert><AlertTitle>El bot necesita reiniciarse</AlertTitle><AlertDescription>La vista está preparada; el historial aparecerá cuando el proceso del bot cargue la API nueva.</AlertDescription></Alert> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard icon={ShieldAlert} label="Avisos activos" value={String(datos.activos)} />
        <StatCard icon={UsersRound} label="Usuarios registrados" value={String(datos.usuarios)} />
        <StatCard icon={ShieldCheck} label="Historial total" value={String(datos.avisos.length)} />
      </div>
      <ExploradorModeracion avisos={datos.avisos} />
    </div>
  );
}
