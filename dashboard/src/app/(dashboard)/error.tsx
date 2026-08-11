'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';

export default function ErrorDashboard({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-center justify-center text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"><AlertTriangle className="size-6" /></div>
      <h2 className="mt-5 text-xl font-semibold">No se pudo cargar esta seccion</h2>
      <p className="mt-2 text-sm text-muted-foreground">El dashboard encontro un error inesperado. Puedes reintentar sin cerrar la sesion.</p>
      <Button type="button" variant="outline" className="mt-5 gap-2" onClick={() => reset()}><RefreshCw className="size-4" />Reintentar</Button>
    </div>
  );
}
