'use client';

import { useState, useTransition } from 'react';
import { Activity, BookOpenCheck, Lightbulb, Loader2, Send, ShieldCheck, ShoppingBag, Ticket } from 'lucide-react';
import { toast } from 'sonner';

import type { Recursos } from '@/lib/api';
import { publicarPanelAction } from './actions';
import { ChannelCombobox } from '@/components/dashboard/channel-combobox';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';

type IconoPanel = 'tickets' | 'verificacion' | 'catalogo' | 'normas' | 'estado' | 'sugerencias';

const ICONOS_PANEL = {
  tickets: Ticket,
  verificacion: ShieldCheck,
  catalogo: ShoppingBag,
  normas: BookOpenCheck,
  estado: Activity,
  sugerencias: Lightbulb,
} satisfies Record<IconoPanel, typeof Ticket>;

export function TarjetaPanel({ tipo, titulo, descripcion, icono, canales }: {
  tipo: string;
  titulo: string;
  descripcion: string;
  icono: IconoPanel;
  canales: Recursos['canalesTexto'];
}) {
  const Icono = ICONOS_PANEL[icono];
  const [canalId, setCanalId] = useState('');
  const [pendiente, iniciar] = useTransition();

  function publicar() {
    iniciar(async () => {
      const resultado = await publicarPanelAction(tipo, canalId);
      if (resultado.ok) toast.success('Panel publicado', { action: { label: 'Ver mensaje', onClick: () => window.open(resultado.url, '_blank', 'noopener,noreferrer') } });
      else toast.error(resultado.error);
    });
  }

  return (
    <Card className="transition-colors hover:border-primary/25">
      <CardHeader className="border-b">
        <div className="mb-2 flex size-9 items-center justify-center rounded-lg border bg-muted text-muted-foreground"><Icono className="size-4" /></div>
        <CardTitle>{titulo}</CardTitle>
        <CardDescription>{descripcion}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Field>
          <FieldLabel>Canal de publicación</FieldLabel>
          <ChannelCombobox canales={canales} value={canalId} onValueChange={setCanalId} placeholder="Elige o busca un canal" />
        </Field>
        <Button type="button" className="w-full" disabled={pendiente || !canalId} onClick={publicar}>
          {pendiente ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Publicar panel
        </Button>
      </CardContent>
    </Card>
  );
}
