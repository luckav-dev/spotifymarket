'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  CheckCircle2,
  ChevronDown,
  GripVertical,
  Heading,
  Images,
  LayoutPanelLeft,
  Loader2,
  Minus,
  MousePointerClick,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  Type,
} from 'lucide-react';
import { toast } from 'sonner';

import type { Bloque, Recursos } from '@/lib/api';
import { validarAnuncioAction, enviarAnuncioAction } from './actions';
import { CamposBloque } from './block-fields';
import { VistaPreviaAnuncio } from './preview';
import { ChannelCombobox } from '@/components/dashboard/channel-combobox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

type BloqueConId = Bloque & { _id: string };

const TIPOS_BLOQUE: { tipo: Bloque['tipo']; etiqueta: string; icono: typeof Heading }[] = [
  { tipo: 'titulo', etiqueta: 'Título', icono: Heading },
  { tipo: 'texto', etiqueta: 'Texto', icono: Type },
  { tipo: 'separador', etiqueta: 'Separador', icono: Minus },
  { tipo: 'imagenes', etiqueta: 'Imágenes', icono: Images },
  { tipo: 'seccion', etiqueta: 'Sección', icono: LayoutPanelLeft },
  { tipo: 'botones', etiqueta: 'Botones', icono: MousePointerClick },
];

function bloqueVacio(tipo: Bloque['tipo']): Bloque {
  switch (tipo) {
    case 'titulo': return { tipo: 'titulo', texto: '', nivel: 1 };
    case 'texto': return { tipo: 'texto', contenido: '' };
    case 'separador': return { tipo: 'separador', linea: true, espaciado: 'grande' };
    case 'imagenes': return { tipo: 'imagenes', urls: [''] };
    case 'seccion': return { tipo: 'seccion', texto: '', boton: { etiqueta: '', estilo: 'secundario' } };
    case 'botones': return { tipo: 'botones', botones: [{ etiqueta: '', estilo: 'secundario' }] };
  }
}

function useMediaQuery(query: string) {
  const [coincide, setCoincide] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const actualizar = () => setCoincide(media.matches);
    actualizar();
    media.addEventListener('change', actualizar);
    return () => media.removeEventListener('change', actualizar);
  }, [query]);
  return coincide;
}

function SortableBlock({
  bloque,
  emojisPorRol,
  onChange,
  onDelete,
}: {
  bloque: BloqueConId;
  emojisPorRol: Record<string, string>;
  onChange: (bloque: Bloque) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: bloque._id });
  const info = TIPOS_BLOQUE.find((tipo) => tipo.tipo === bloque.tipo)!;
  const Icono = info.icono;

  return (
    <Card
      ref={setNodeRef}
      size="sm"
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'z-20 border-primary/40 opacity-80 shadow-lg')}
    >
      <CardHeader className="flex-row items-center gap-2 border-b py-2.5">
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Reordenar bloque" {...attributes} {...listeners} className="cursor-grab touch-none active:cursor-grabbing">
          <GripVertical className="size-4" />
        </Button>
        <Badge variant="secondary" className="gap-1.5 font-normal"><Icono className="size-3" /> {info.etiqueta}</Badge>
        <Button type="button" variant="ghost" size="icon-sm" className="ml-auto text-destructive" onClick={onDelete} aria-label="Eliminar bloque">
          <Trash2 className="size-3.5" />
        </Button>
      </CardHeader>
      <CardContent className="pt-1">
        <CamposBloque bloque={bloque} emojisPorRol={emojisPorRol} onChange={onChange} />
      </CardContent>
    </Card>
  );
}

type EditorPaneProps = {
  recursos: Recursos;
  emojisPorRol: Record<string, string>;
  bloques: BloqueConId[];
  canalId: string;
  mencion: string;
  problemas: string[];
  pendienteValidar: boolean;
  pendienteEnvio: boolean;
  onCanalChange: (valor: string) => void;
  onMencionChange: (valor: string) => void;
  onAdd: (tipo: Bloque['tipo']) => void;
  onUpdate: (id: string, bloque: Bloque) => void;
  onDelete: (id: string) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onValidate: () => void;
  onSend: () => void;
};

function EditorPane(props: EditorPaneProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b p-4">
        <FieldGroup className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel>Canal</FieldLabel>
            <ChannelCombobox canales={props.recursos.canalesTexto} value={props.canalId} onValueChange={props.onCanalChange} placeholder="Selecciona o busca un canal" />
          </Field>
          <Field>
            <FieldLabel>Menciones</FieldLabel>
            <Select value={props.mencion} onValueChange={(valor) => props.onMencionChange(valor ?? 'ninguna')}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ninguna">Ninguna</SelectItem>
                <SelectItem value="roles">Permitir @roles</SelectItem>
                <SelectItem value="everyone">Permitir @everyone</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
      </div>

      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div>
          <p className="text-sm font-medium">Contenido</p>
          <p className="text-xs text-muted-foreground">Arrastra los bloques para reordenarlos.</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="sm"><Plus className="size-3.5" /> Añadir <ChevronDown className="size-3.5" /></Button>} />
          <DropdownMenuContent align="end">
            {TIPOS_BLOQUE.map(({ tipo, etiqueta, icono: Icono }) => (
              <DropdownMenuItem key={tipo} onClick={() => props.onAdd(tipo)}><Icono className="size-4" /> {etiqueta}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ScrollArea className="min-h-[24rem] flex-1">
        <div className="space-y-3 p-4">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={props.onDragEnd}>
            <SortableContext items={props.bloques.map((bloque) => bloque._id)} strategy={verticalListSortingStrategy}>
              {props.bloques.map((bloque) => (
                <SortableBlock
                  key={bloque._id}
                  bloque={bloque}
                  emojisPorRol={props.emojisPorRol}
                  onChange={(nuevo) => props.onUpdate(bloque._id, nuevo)}
                  onDelete={() => props.onDelete(bloque._id)}
                />
              ))}
            </SortableContext>
          </DndContext>
          {!props.bloques.length ? (
            <Empty className="min-h-56 border">
              <EmptyHeader>
                <EmptyMedia variant="icon"><Plus /></EmptyMedia>
                <EmptyTitle>El anuncio está vacío</EmptyTitle>
                <EmptyDescription>Añade un título, texto, imágenes o botones.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
        </div>
      </ScrollArea>

      {props.problemas.length ? (
        <Alert variant="destructive" className="mx-4 mb-3">
          <AlertTitle>{props.problemas.length} problema(s)</AlertTitle>
          <AlertDescription>{props.problemas.join(' · ')}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex gap-2 border-t p-4">
        <Button type="button" variant="outline" disabled={props.pendienteValidar || !props.bloques.length} onClick={props.onValidate}>
          {props.pendienteValidar ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} Validar
        </Button>
        <Button type="button" className="flex-1" disabled={props.pendienteEnvio || !props.bloques.length || !props.canalId} onClick={props.onSend}>
          {props.pendienteEnvio ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Enviar anuncio
        </Button>
      </div>
    </div>
  );
}

function PreviewPane({ bloques }: { bloques: Bloque[] }) {
  return (
    <div className="h-full min-h-0 bg-muted/20 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div><p className="text-sm font-medium">Vista previa</p><p className="text-xs text-muted-foreground">Resultado aproximado en Discord</p></div>
        <Badge variant="outline" className="gap-1.5 font-normal"><CheckCircle2 className="size-3 text-primary" /> En directo</Badge>
      </div>
      <VistaPreviaAnuncio bloques={bloques} />
    </div>
  );
}

export function CompositorAnuncios({ recursos, emojisPorRol }: { recursos: Recursos; emojisPorRol: Record<string, string> }) {
  const [bloques, setBloques] = useState<BloqueConId[]>([]);
  const [canalId, setCanalId] = useState('');
  const [mencion, setMencion] = useState('ninguna');
  const [problemas, setProblemas] = useState<string[]>([]);
  const [pendienteValidar, iniciarValidacion] = useTransition();
  const [pendienteEnvio, iniciarEnvio] = useTransition();
  const escritorio = useMediaQuery('(min-width: 1024px)');

  const bloquesLimpios = useMemo<Bloque[]>(() => bloques.map(({ _id, ...resto }) => {
    void _id;
    return resto as Bloque;
  }), [bloques]);

  function anadir(tipo: Bloque['tipo']) {
    setBloques((actual) => [...actual, { ...bloqueVacio(tipo), _id: crypto.randomUUID() }]);
  }

  function actualizar(id: string, nuevo: Bloque) {
    setBloques((actual) => actual.map((bloque) => bloque._id === id ? { ...nuevo, _id: id } : bloque));
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setBloques((actual) => {
      const origen = actual.findIndex((bloque) => bloque._id === active.id);
      const destino = actual.findIndex((bloque) => bloque._id === over.id);
      return arrayMove(actual, origen, destino);
    });
  }

  function validar() {
    setProblemas([]);
    iniciarValidacion(async () => {
      const resultado = await validarAnuncioAction(bloquesLimpios);
      if (resultado.ok) toast.success('El anuncio es válido.');
      else setProblemas(resultado.problemas);
    });
  }

  function enviar() {
    setProblemas([]);
    iniciarEnvio(async () => {
      const resultado = await enviarAnuncioAction(canalId, bloquesLimpios, mencion);
      if (resultado.ok) {
        toast.success('Anuncio enviado', { action: { label: 'Ver mensaje', onClick: () => window.open(resultado.url, '_blank') } });
        setBloques([]);
      } else {
        setProblemas(resultado.problemas ?? [resultado.error]);
        toast.error(resultado.error);
      }
    });
  }

  const editorProps: EditorPaneProps = {
    recursos,
    emojisPorRol,
    bloques,
    canalId,
    mencion,
    problemas,
    pendienteValidar,
    pendienteEnvio,
    onCanalChange: setCanalId,
    onMencionChange: setMencion,
    onAdd: anadir,
    onUpdate: actualizar,
    onDelete: (id) => setBloques((actual) => actual.filter((bloque) => bloque._id !== id)),
    onDragEnd,
    onValidate: validar,
    onSend: enviar,
  };

  if (!escritorio) {
    return <div className="space-y-4 overflow-hidden rounded-xl border bg-card"><EditorPane {...editorProps} /><PreviewPane bloques={bloquesLimpios} /></div>;
  }

  return (
    <div className="h-[calc(100svh-12.5rem)] min-h-[42rem] overflow-hidden rounded-xl border bg-card">
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel id="editor" defaultSize="58%" minSize="40%"><EditorPane {...editorProps} /></ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel id="preview" defaultSize="42%" minSize="28%"><PreviewPane bloques={bloquesLimpios} /></ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
