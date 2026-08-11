import Link from 'next/link';
import { ArrowLeft, SearchX } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 py-16">
      <Empty className="max-w-xl border bg-card/40 py-14">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="size-12"><SearchX className="size-5" /></EmptyMedia>
          <p className="font-mono text-xs text-primary">ERROR 404</p>
          <EmptyTitle className="text-2xl">Esta pantalla no existe</EmptyTitle>
          <EmptyDescription>La ruta que buscas ya no está disponible o nunca formó parte del dashboard.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex flex-wrap justify-center gap-2">
            <Button render={<Link href="/inicio" />}><ArrowLeft className="size-4" /> Volver al inicio</Button>
            <Button variant="outline" render={<Link href="/login" />}>Ir al acceso</Button>
          </div>
        </EmptyContent>
      </Empty>
    </main>
  );
}
