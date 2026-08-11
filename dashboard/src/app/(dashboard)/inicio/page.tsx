import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  Bot,
  Boxes,
  Clock3,
  Command,
  Gauge,
  Megaphone,
  Server,
  ShieldCheck,
  ShoppingBag,
  Smile,
  Star,
  Ticket,
  Users,
} from 'lucide-react';

import { api, ErrorApi, type Estado, type Recursos } from '@/lib/api';
import { formatearDuracion } from '@/lib/format';
import { ErrorConexion } from '@/components/dashboard/error-conexion';
import { PageHeader } from '@/components/dashboard/page-header';
import { StatCard } from '@/components/dashboard/stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';

export const dynamic = 'force-dynamic';

export default async function PaginaInicio() {
  let estado: Estado;
  let recursos: Recursos;

  try {
    [estado, recursos] = await Promise.all([api.estado(), api.recursos()]);
  } catch (error) {
    return <ErrorConexion mensaje={error instanceof ErrorApi ? error.message : 'Error desconocido'} />;
  }

  const uptime = estado.bot.enPieDesdeMs ? formatearDuracion(estado.bot.enPieDesdeMs) : 'Sin datos';
  const catalogoVisible = estado.catalogo.total > 0
    ? Math.round((estado.catalogo.visibles / estado.catalogo.total) * 100)
    : 0;

  return (
    <div className="mx-auto max-w-screen-2xl space-y-6">
      <PageHeader
        eyebrow="Operaciones"
        icon={Activity}
        title="Vista general"
        description="Estado del bot, actividad de soporte y accesos rápidos a las tareas de administración."
        status={estado.bot.tag ?? 'Bot conectado'}
        actions={
          <Button render={<Link href="/anuncios" />}>
            <Megaphone className="size-4" /> Nuevo anuncio
          </Button>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Ticket} label="Tickets abiertos" value={String(estado.tickets.abiertos)} detail={`${estado.tickets.cerrados} cerrados`} />
        <StatCard icon={ShoppingBag} label="Productos visibles" value={String(estado.catalogo.visibles)} detail={`${estado.catalogo.total} productos totales`} />
        <StatCard icon={Users} label="Miembros" value={String(recursos.servidor.miembros)} detail={recursos.servidor.nombre} />
        <StatCard icon={Star} label="Valoración media" value={estado.tickets.valoracionMedia ? `${estado.tickets.valoracionMedia}/5` : '—'} detail={`${estado.tickets.valoraciones} valoraciones`} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(20rem,.7fr)]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Estado del sistema</CardTitle>
            <CardDescription>Conexión actual entre el dashboard, Discord y el bot.</CardDescription>
            <CardAction>
              <Badge variant="outline" className="gap-1.5 font-normal text-primary">
                <span className="size-1.5 rounded-full bg-primary" /> En línea
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-0 p-0 sm:grid-cols-2">
            <SystemRow icon={Gauge} label="Latencia" value={`${estado.bot.latenciaMs} ms`} detail={estado.bot.latenciaMs < 200 ? 'Respuesta estable' : 'Conviene revisar'} />
            <SystemRow icon={Clock3} label="Tiempo activo" value={uptime} detail="Sesión actual del bot" />
            <SystemRow icon={Command} label="Comandos" value={String(estado.bot.comandos)} detail="Registrados en Discord" />
            <SystemRow icon={Server} label="Recursos" value={`${recursos.canalesTexto.length} canales`} detail={`${recursos.roles.length} roles disponibles`} />
            <SystemRow icon={Smile} label="Emojis" value={String(estado.emojis)} detail="Emojis personalizados sincronizados" />
            <SystemRow
              icon={ShieldCheck}
              label="Configuración"
              value={estado.configuracion.errores ? `${estado.configuracion.errores} errores` : 'Validada'}
              detail={`${estado.configuracion.avisos} avisos no bloqueantes`}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Publicación del catálogo</CardTitle>
            <CardDescription>Productos disponibles actualmente para los clientes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Visibilidad</span>
                <span className="font-mono">{catalogoVisible}%</span>
              </div>
              <Progress value={catalogoVisible} />
            </div>
            <Separator />
            <div className="space-y-1">
              <QuickLink href="/catalogo" icon={Boxes} label="Gestionar catálogo" />
              <QuickLink href="/tickets" icon={Ticket} label="Revisar tickets" />
              <QuickLink href="/configuracion" icon={ShieldCheck} label="Configurar el bot" />
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function SystemRow({ icon: Icon, label, value, detail }: { icon: typeof Bot; label: string; value: string; detail: string }) {
  return (
    <div className="flex gap-3 border-b p-4 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 sm:[&:nth-child(odd)]:border-r">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 font-medium">{value}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function QuickLink({ href, icon: Icon, label }: { href: string; icon: typeof Bot; label: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
      <Icon className="size-4" />
      <span className="flex-1">{label}</span>
      <ArrowRight className="size-4" />
    </Link>
  );
}
