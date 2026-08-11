'use client';

import { useState, useTransition } from 'react';
import { Braces, FormInput, Loader2, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';

import type { JsonValor } from '@/lib/json';
import { guardarConfigAction } from './actions';
import { EditorObjeto } from './json-editor';
import { EditorJsonCrudo } from './raw-editor';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export function EditorConfig({ nombre, datosIniciales }: { nombre: string; datosIniciales: JsonValor }) {
  const [datos, setDatos] = useState(datosIniciales);
  const [guardado, setGuardado] = useState(datosIniciales);
  const [pendiente, iniciar] = useTransition();
  const [jsonValido, setJsonValido] = useState(true);
  const [tab, setTab] = useState('formulario');
  const [jsonVersion, setJsonVersion] = useState(0);

  const cambiado = JSON.stringify(datos) !== JSON.stringify(guardado);

  function descartar() {
    setDatos(guardado);
    setJsonValido(true);
    setJsonVersion((version) => version + 1);
  }

  function guardar() {
    iniciar(async () => {
      const resultado = await guardarConfigAction(nombre, datos);
      if (resultado.ok) {
        setGuardado(datos);
        if (resultado.avisos.length) {
          toast.warning('Configuración guardada con avisos', { description: resultado.avisos.join(' · ') });
        } else {
          toast.success('Configuración guardada');
        }
      } else {
        toast.error(resultado.error);
      }
    });
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(valor) => {
        setTab(valor);
        if (valor === 'json') setJsonVersion((version) => version + 1);
      }}
      className="space-y-4"
    >
      <Card size="sm" className="sticky top-0 z-20">
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList>
            <TabsTrigger value="formulario"><FormInput className="size-3.5" /> Formulario</TabsTrigger>
            <TabsTrigger value="json"><Braces className="size-3.5" /> JSON</TabsTrigger>
          </TabsList>
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <span className="mr-1 text-xs text-muted-foreground">{cambiado ? 'Cambios sin guardar' : 'Todo guardado'}</span>
            <Button type="button" variant="outline" size="sm" disabled={!cambiado || pendiente} onClick={descartar}>
              <RotateCcw className="size-3.5" /> Descartar
            </Button>
            <Button type="button" size="sm" disabled={pendiente || !cambiado || !jsonValido} onClick={guardar}>
              {pendiente ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Guardar
            </Button>
          </div>
        </CardContent>
      </Card>

      <TabsContent value="formulario">
        {typeof datos === 'object' && datos !== null && !Array.isArray(datos) ? (
          <EditorObjeto valor={datos} onChange={(valor) => { setDatos(valor); setJsonValido(true); }} />
        ) : (
          <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Este archivo necesita el editor JSON.</CardContent></Card>
        )}
      </TabsContent>
      <TabsContent value="json">
        <EditorJsonCrudo key={jsonVersion} valor={datos} onCambioValido={setDatos} onValidezCambia={setJsonValido} />
      </TabsContent>
    </Tabs>
  );
}
