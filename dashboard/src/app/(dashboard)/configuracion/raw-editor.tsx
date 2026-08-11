'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

import type { JsonValor } from '@/lib/json';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => <Skeleton className="h-[34rem] w-full rounded-lg" />,
});

export function EditorJsonCrudo({
  valor,
  onCambioValido,
  onValidezCambia,
}: {
  valor: JsonValor;
  onCambioValido: (v: JsonValor) => void;
  onValidezCambia: (valido: boolean) => void;
}) {
  const [texto, setTexto] = useState(() => JSON.stringify(valor, null, 2));
  const [error, setError] = useState<string | null>(null);

  function manejarCambio(nuevo: string) {
    setTexto(nuevo);
    try {
      const parseado = JSON.parse(nuevo) as JsonValor;
      onCambioValido(parseado);
      onValidezCambia(true);
      setError(null);
    } catch (cause) {
      onValidezCambia(false);
      setError(cause instanceof SyntaxError ? cause.message : 'El JSON no es válido.');
    }
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border bg-[#0f1115]">
        <MonacoEditor
          height="34rem"
          language="json"
          theme="vs-dark"
          value={texto}
          onChange={(nuevo) => manejarCambio(nuevo ?? '')}
          options={{
            automaticLayout: true,
            fontFamily: 'var(--font-geist-mono)',
            fontSize: 13,
            formatOnPaste: true,
            formatOnType: true,
            minimap: { enabled: false },
            padding: { top: 16, bottom: 16 },
            scrollBeyondLastLine: false,
            tabSize: 2,
            wordWrap: 'on',
          }}
        />
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="size-3.5 text-primary" /> JSON válido y listo para guardar
        </div>
      )}
    </div>
  );
}
