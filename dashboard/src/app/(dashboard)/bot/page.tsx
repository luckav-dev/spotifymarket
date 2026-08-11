import Link from 'next/link';
import { Bot, Command, Gauge, Server, Settings2 } from 'lucide-react';

import { api, ErrorApi } from '@/lib/api';
import { ControlBot } from './bot-control';
import { ErrorConexion } from '@/components/dashboard/error-conexion';
import { PageHeader } from '@/components/dashboard/page-header';
import { StatCard } from '@/components/dashboard/stat-card';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

async function cargarDatos() {
  return Promise.all([
    api.estado(), api.recursos(), api.leerConfig('bot'), api.leerConfig('status'), api.leerConfig('brand'),
  ]);
}

export default async function PaginaControlBot() {
  let datos: Awaited<ReturnType<typeof cargarDatos>> | null = null;
  let mensajeError: string | null = null;

  try {
    datos = await cargarDatos();
  } catch (error) {
    mensajeError = error instanceof ErrorApi ? error.message : 'Error desconocido';
  }

  if (mensajeError || !datos) return <ErrorConexion mensaje={mensajeError ?? 'No se pudieron cargar los datos.'} />;
  const [estado, recursos, botConfig, statusConfig, brandConfig] = datos;

  return (
    <div className="mx-auto max-w-screen-2xl space-y-6">
      <PageHeader
        eyebrow="Sistema"
        icon={Bot}
        title="Central del bot"
        description="Controla la presencia, disponibilidad, marca y sincronización de recursos desde una sola pantalla."
        status={estado.bot.tag ?? 'Bot conectado'}
        actions={<Button variant="outline" render={<Link href="/configuracion" />}><Settings2 /> Ajustes avanzados</Button>}
      />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Gauge} label="Latencia" value={`${estado.bot.latenciaMs} ms`} detail="Conexión con Discord" />
        <StatCard icon={Server} label="Servidores" value={String(estado.bot.servidores)} detail={recursos.servidor.nombre} />
        <StatCard icon={Command} label="Comandos" value={String(estado.bot.comandos)} detail="Cargados por el bot" />
        <StatCard icon={Settings2} label="Configuración" value={estado.configuracion.errores ? `${estado.configuracion.errores} errores` : 'Validada'} detail={`${estado.configuracion.avisos} avisos`} />
      </section>
      <ControlBot
        botInicial={botConfig.datos as never}
        statusInicial={statusConfig.datos as never}
        brandInicial={brandConfig.datos as never}
      />
    </div>
  );
}
