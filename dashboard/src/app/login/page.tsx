import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, LockKeyhole, MessageCircle, ShieldAlert } from 'lucide-react';

import { sesionActual } from '@/lib/sesion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

const ERRORES: Record<string, string> = {
  cancelado: 'Has cancelado el inicio de sesión en Discord.',
  state_invalido: 'La sesión de acceso caducó o no es válida. Inténtalo de nuevo.',
  sin_permiso: 'Tu cuenta de Discord no tiene nivel suficiente en el servidor para entrar aquí.',
};

export default async function PaginaLogin({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sesion = await sesionActual();
  if (sesion) redirect('/inicio');

  const { error } = await searchParams;
  const mensajeError = error ? (ERRORES[error] ?? error) : null;

  return (
    <main className="grid min-h-svh place-items-center bg-background p-5">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="relative size-10 overflow-hidden rounded-lg border bg-muted"><Image src="/brand/logo.png" alt="SpotifyMarket" fill sizes="40px" className="object-cover" /></div>
          <div><p className="text-sm font-semibold">SpotifyMarket</p><p className="text-xs text-muted-foreground">Panel de administración</p></div>
        </div>
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-lg border bg-muted text-muted-foreground"><LockKeyhole className="size-4" /></div>
            <CardTitle className="text-xl">Acceso del equipo</CardTitle>
            <CardDescription>Discord comprobará tu servidor, nivel y permisos antes de iniciar la sesión.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {mensajeError ? <Alert variant="destructive"><ShieldAlert className="size-4" /><AlertTitle>No se pudo entrar</AlertTitle><AlertDescription>{mensajeError}</AlertDescription></Alert> : null}
            <Button size="lg" className="w-full" render={<Link href="/login/discord" />}><MessageCircle className="size-4" /> Continuar con Discord <ArrowRight className="ml-auto size-4" /></Button>
            <Separator />
            <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><LockKeyhole className="mt-0.5 size-3.5 shrink-0" /> El token del bot y los archivos de configuración permanecen en el servidor.</p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
