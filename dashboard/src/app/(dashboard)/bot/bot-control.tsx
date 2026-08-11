'use client';

import { useState, useTransition } from 'react';
import { Bot, Braces, Command, Info, Loader2, RefreshCw, Save, Smile } from 'lucide-react';
import { toast } from 'sonner';

import { ejecutarControlAction, guardarControlBotAction } from './actions';
import type { JsonObjeto } from '@/lib/json';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

type BotConfig = {
  intents: string[];
  presencia: { estado: string; actividad: { tipo: string; nombre: string } };
};

type StatusConfig = {
  activo: boolean;
  titulo: string;
  descripcion: string;
  estadoPorDefecto: string;
  mostrarHistorial: boolean;
  historialMaximo: number;
  estados: Record<string, { nombre?: string }>;
  [key: string]: unknown;
};

type BrandConfig = {
  nombre: string;
  assets: Record<string, string>;
  enlaces: { web: string; soporte: string; terminos: string };
};

export function ControlBot({ botInicial, statusInicial, brandInicial }: {
  botInicial: BotConfig;
  statusInicial: StatusConfig;
  brandInicial: BrandConfig;
}) {
  const [botConfig, setBotConfig] = useState(botInicial);
  const [statusConfig, setStatusConfig] = useState(statusInicial);
  const [brandConfig, setBrandConfig] = useState(brandInicial);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [, iniciarGuardado] = useTransition();

  function guardar(nombre: 'bot' | 'status' | 'brand', datos: object) {
    setGuardando(nombre);
    iniciarGuardado(async () => {
      const resultado = await guardarControlBotAction(nombre, datos as JsonObjeto);
      setGuardando(null);
      if (resultado.ok) {
        toast.success(nombre === 'bot' ? 'Presencia aplicada en Discord' : 'Configuración guardada');
        if (resultado.avisos.length) toast.warning(resultado.avisos.join(' · '));
      } else {
        toast.error(resultado.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <Alert>
        <Info />
        <AlertTitle>Control en tiempo real</AlertTitle>
        <AlertDescription>La presencia se aplica al guardar. Los demás módulos leen la configuración actualizada sin reiniciar el dashboard.</AlertDescription>
      </Alert>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Presencia de Discord</CardTitle>
            <CardDescription>Estado y actividad que ven los miembros del servidor.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FieldGroup className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>Estado</FieldLabel>
                <Select value={botConfig.presencia.estado} onValueChange={(estado) => estado && setBotConfig((actual) => ({ ...actual, presencia: { ...actual.presencia, estado } }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="online">En línea</SelectItem>
                    <SelectItem value="idle">Ausente</SelectItem>
                    <SelectItem value="dnd">No molestar</SelectItem>
                    <SelectItem value="invisible">Invisible</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Tipo de actividad</FieldLabel>
                <Select value={botConfig.presencia.actividad.tipo} onValueChange={(tipo) => tipo && setBotConfig((actual) => ({ ...actual, presencia: { ...actual.presencia, actividad: { ...actual.presencia.actividad, tipo } } }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Custom">Personalizada</SelectItem>
                    <SelectItem value="Playing">Jugando</SelectItem>
                    <SelectItem value="Listening">Escuchando</SelectItem>
                    <SelectItem value="Watching">Viendo</SelectItem>
                    <SelectItem value="Competing">Compitiendo</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>
            <Field>
              <FieldLabel>Texto de actividad</FieldLabel>
              <Input value={botConfig.presencia.actividad.nombre} onChange={(event) => setBotConfig((actual) => ({ ...actual, presencia: { ...actual.presencia, actividad: { ...actual.presencia.actividad, nombre: event.target.value } } }))} placeholder="Ej. Atendiendo pedidos" maxLength={128} />
            </Field>
            <Button disabled={guardando === 'bot'} onClick={() => guardar('bot', botConfig)}>
              {guardando === 'bot' ? <Loader2 className="animate-spin" /> : <Save />} Guardar y aplicar
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle>Estado del servicio</CardTitle>
            <CardDescription>Controla la disponibilidad que se publica para los clientes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div><p className="text-sm font-medium">Sistema visible</p><p className="text-xs text-muted-foreground">Permite publicar y consultar el estado.</p></div>
              <Switch checked={statusConfig.activo} onCheckedChange={(activo) => setStatusConfig((actual) => ({ ...actual, activo }))} aria-label="Activar sistema de estado" />
            </div>
            <Field>
              <FieldLabel>Estado predeterminado</FieldLabel>
              <Select value={statusConfig.estadoPorDefecto} onValueChange={(estadoPorDefecto) => estadoPorDefecto && setStatusConfig((actual) => ({ ...actual, estadoPorDefecto }))}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(statusConfig.estados).map(([clave, estado]) => <SelectItem key={clave} value={clave}>{estado.nombre ?? clave}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Título</FieldLabel>
              <Input value={statusConfig.titulo} onChange={(event) => setStatusConfig((actual) => ({ ...actual, titulo: event.target.value }))} />
            </Field>
            <Field>
              <FieldLabel>Descripción</FieldLabel>
              <Textarea value={statusConfig.descripcion} onChange={(event) => setStatusConfig((actual) => ({ ...actual, descripcion: event.target.value }))} rows={3} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-sm">Mostrar historial</span>
                <Switch checked={statusConfig.mostrarHistorial} onCheckedChange={(mostrarHistorial) => setStatusConfig((actual) => ({ ...actual, mostrarHistorial }))} aria-label="Mostrar historial" />
              </div>
              <Field>
                <FieldLabel>Máximo de entradas</FieldLabel>
                <Input type="number" min={1} max={10} value={statusConfig.historialMaximo} onChange={(event) => setStatusConfig((actual) => ({ ...actual, historialMaximo: Number(event.target.value) }))} />
              </Field>
            </div>
            <Button disabled={guardando === 'status'} onClick={() => guardar('status', statusConfig)}>
              {guardando === 'status' ? <Loader2 className="animate-spin" /> : <Save />} Guardar estado
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle>Marca y enlaces</CardTitle>
            <CardDescription>Nombre público y destinos oficiales del bot.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field><FieldLabel>Nombre</FieldLabel><Input value={brandConfig.nombre} onChange={(event) => setBrandConfig((actual) => ({ ...actual, nombre: event.target.value }))} /></Field>
            <Field><FieldLabel>Web</FieldLabel><Input type="url" value={brandConfig.enlaces.web} onChange={(event) => setBrandConfig((actual) => ({ ...actual, enlaces: { ...actual.enlaces, web: event.target.value } }))} placeholder="https://…" /></Field>
            <Field><FieldLabel>Soporte</FieldLabel><Input type="url" value={brandConfig.enlaces.soporte} onChange={(event) => setBrandConfig((actual) => ({ ...actual, enlaces: { ...actual.enlaces, soporte: event.target.value } }))} placeholder="https://…" /></Field>
            <Field><FieldLabel>Términos</FieldLabel><Input type="url" value={brandConfig.enlaces.terminos} onChange={(event) => setBrandConfig((actual) => ({ ...actual, enlaces: { ...actual.enlaces, terminos: event.target.value } }))} placeholder="https://…" /></Field>
            <Button disabled={guardando === 'brand'} onClick={() => guardar('brand', brandConfig)}>
              {guardando === 'brand' ? <Loader2 className="animate-spin" /> : <Save />} Guardar marca
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle>Acciones administrativas</CardTitle>
            <CardDescription>Operaciones que actualizan recursos directamente en Discord.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <AccionControl icono={Command} boton="Sincronizar comandos" titulo="Sincronizar comandos en Discord" descripcion="Volverá a publicar todos los comandos cargados por el bot en el servidor configurado." accion="comandos" exito="Comandos sincronizados" />
            <AccionControl icono={Smile} boton="Sincronizar emojis" titulo="Sincronizar emojis del bot" descripcion="Comprobará los recursos locales y subirá únicamente los emojis que falten." accion="emojis" exito="Emojis sincronizados" />
            <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground"><Braces className="mb-2 size-4" />Los ajustes avanzados siguen disponibles en los trece editores JSON y formulario.</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AccionControl({ icono: Icono, boton, titulo, descripcion, accion, exito }: {
  icono: typeof Bot;
  boton: string;
  titulo: string;
  descripcion: string;
  accion: 'comandos' | 'emojis';
  exito: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [pendiente, iniciar] = useTransition();

  function ejecutar() {
    iniciar(async () => {
      const resultado = await ejecutarControlAction(accion);
      if (resultado.ok) {
        toast.success(exito);
        setAbierto(false);
      } else toast.error(resultado.error);
    });
  }

  return (
    <AlertDialog open={abierto} onOpenChange={setAbierto}>
      <AlertDialogTrigger render={<Button variant="outline" className="w-full justify-start"><Icono /> {boton}</Button>} />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia><RefreshCw /></AlertDialogMedia>
          <AlertDialogTitle>{titulo}</AlertDialogTitle>
          <AlertDialogDescription>{descripcion}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={ejecutar} disabled={pendiente}>{pendiente && <Loader2 className="animate-spin" />} Continuar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
