'use client';

import { useState } from 'react';
import { Plus, Trash2, ChevronRight, ChevronDown } from 'lucide-react';

import type { JsonValor } from '@/lib/json';
import { formaVacia, esObjeto } from '@/lib/json';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

/** Textarea en vez de Input cuando el texto es largo o tiene saltos de linea. */
function esTextoLargo(texto: string) {
  return texto.length > 60 || texto.includes('\n');
}

function EditorPrimitivo({ valor, onChange }: { valor: JsonValor; onChange: (v: JsonValor) => void }) {
  if (typeof valor === 'boolean') {
    return <Switch checked={valor} onCheckedChange={onChange} />;
  }

  if (typeof valor === 'number') {
    return (
      <Input
        type="number"
        value={valor}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      />
    );
  }

  const texto = valor === null ? '' : String(valor);
  if (esTextoLargo(texto)) {
    return <Textarea value={texto} onChange={(e) => onChange(e.target.value)} rows={3} />;
  }
  return <Input value={texto} onChange={(e) => onChange(e.target.value)} />;
}

/** Lista de strings o numeros: una fila por elemento, con anadir y quitar. */
function EditorListaPrimitivos({
  valores,
  onChange,
}: {
  valores: JsonValor[];
  onChange: (v: JsonValor[]) => void;
}) {
  const tipo = typeof valores[0] === 'number' ? 'number' : 'text';

  return (
    <div className="space-y-1.5">
      {valores.map((v, i) => (
        <div key={i} className="flex gap-1.5">
          <Input
            type={tipo}
            value={String(v)}
            onChange={(e) => {
              const copia = [...valores];
              copia[i] = tipo === 'number' ? Number(e.target.value) : e.target.value;
              onChange(copia);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => onChange(valores.filter((_, j) => j !== i))}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => onChange([...valores, tipo === 'number' ? 0 : ''])}
      >
        <Plus className="size-3.5" />
        Anadir
      </Button>
    </div>
  );
}

/** Fila de un diccionario: clave editable + valor recursivo + quitar. */
function FilaClaveValor({
  clave,
  valor,
  onCambiarClave,
  onCambiarValor,
  onEliminar,
}: {
  clave: string;
  valor: JsonValor;
  onCambiarClave: (nueva: string) => void;
  onCambiarValor: (v: JsonValor) => void;
  onEliminar: () => void;
}) {
  const [abierto, setAbierto] = useState(true);
  const compuesto = esObjeto(valor) || Array.isArray(valor);

  return (
    <Collapsible open={abierto} onOpenChange={setAbierto} className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 p-2.5">
        {compuesto ? (
          <CollapsibleTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={abierto ? 'Contraer sección' : 'Expandir sección'} />}>
            {abierto ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </CollapsibleTrigger>
        ) : (
          <span className="size-7" />
        )}

        <Input
          value={clave}
          onChange={(e) => onCambiarClave(e.target.value)}
          className="max-w-52 font-mono text-xs"
        />

        {!compuesto && (
          <div className="flex-1">
            <EditorPrimitivo valor={valor} onChange={onCambiarValor} />
          </div>
        )}

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="ml-auto shrink-0 text-destructive hover:bg-destructive/10"
          onClick={onEliminar}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {compuesto && (
        <CollapsibleContent className="border-t p-3">
          <EditorValor valor={valor} onChange={onCambiarValor} />
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

/** Objeto (diccionario): filas clave/valor con anadir clave nueva. */
export function EditorObjeto({
  valor,
  onChange,
}: {
  valor: { [clave: string]: JsonValor };
  onChange: (v: { [clave: string]: JsonValor }) => void;
}) {
  const entradas = Object.entries(valor);

  function anadirClave() {
    let nombre = 'nueva_clave';
    let n = 1;
    while (nombre in valor) nombre = `nueva_clave_${n++}`;

    // Se clona la forma de la primera entrada existente: asi anadir un rol de
    // staff o una categoria de ticket ya trae los campos que hacen falta, en
    // vez de un objeto vacio que el usuario tendria que adivinar.
    const forma = entradas.length ? formaVacia(entradas[0][1]) : '';
    onChange({ ...valor, [nombre]: forma });
  }

  return (
    <div className="space-y-1.5">
      {entradas.map(([clave, v]) => (
        <FilaClaveValor
          key={clave}
          clave={clave}
          valor={v}
          onCambiarClave={(nueva) => {
            if (!nueva || nueva === clave) return;
            const reconstruido = Object.fromEntries(
              entradas.map(([k, val]) => [k === clave ? nueva : k, val]),
            );
            onChange(reconstruido);
          }}
          onCambiarValor={(nuevo) => onChange({ ...valor, [clave]: nuevo })}
          onEliminar={() => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { [clave]: _omitido, ...resto } = valor;
            onChange(resto);
          }}
        />
      ))}
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={anadirClave}>
        <Plus className="size-3.5" />
        Anadir clave
      </Button>
    </div>
  );
}

/** Array de objetos: tarjetas repetibles, clonando la forma del primero. */
function EditorListaObjetos({
  valores,
  onChange,
}: {
  valores: { [clave: string]: JsonValor }[];
  onChange: (v: { [clave: string]: JsonValor }[]) => void;
}) {
  return (
    <div className="space-y-2">
      {valores.map((v, i) => (
        <div key={i} className="rounded-lg border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Elemento {i + 1}</Label>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-destructive hover:bg-destructive/10"
              onClick={() => onChange(valores.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
          <EditorObjeto
            valor={v}
            onChange={(nuevo) => {
              const copia = [...valores];
              copia[i] = nuevo;
              onChange(copia);
            }}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => onChange([...valores, valores.length ? (formaVacia(valores[0]) as typeof valores[0]) : {}])}
      >
        <Plus className="size-3.5" />
        Anadir elemento
      </Button>
    </div>
  );
}

export function EditorValor({ valor, onChange }: { valor: JsonValor; onChange: (v: JsonValor) => void }) {
  if (Array.isArray(valor)) {
    if (valor.length === 0) {
      return (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => onChange([''])}
        >
          <Plus className="size-3.5" />
          Anadir el primer elemento
        </Button>
      );
    }
    if (esObjeto(valor[0])) {
      return (
        <EditorListaObjetos
          valores={valor as { [clave: string]: JsonValor }[]}
          onChange={(v) => onChange(v)}
        />
      );
    }
    return <EditorListaPrimitivos valores={valor} onChange={onChange} />;
  }

  if (esObjeto(valor)) {
    return <EditorObjeto valor={valor} onChange={(v) => onChange(v)} />;
  }

  return <EditorPrimitivo valor={valor} onChange={onChange} />;
}
