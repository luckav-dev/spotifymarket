import type { ReactNode } from 'react';

/**
 * Renderiza el subconjunto de markdown que usa el bot (ver
 * references/components-v2.md > 14): titulos con #, citas con >, texto
 * pequeno con -#, negrita y codigo en linea. No es un parser de markdown
 * completo -no hace falta- solo lo que el propio Container V2 interpreta.
 */

function conInline(texto: string, key: number): ReactNode {
  const partes = texto.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);

  return (
    <span key={key}>
      {partes.map((parte, i) => {
        if (parte.startsWith('**') && parte.endsWith('**')) {
          return <strong key={i}>{parte.slice(2, -2)}</strong>;
        }
        if (parte.startsWith('`') && parte.endsWith('`')) {
          return (
            <code key={i} className="rounded bg-black/30 px-1 py-0.5 font-mono text-[0.85em]">
              {parte.slice(1, -1)}
            </code>
          );
        }
        return <span key={i}>{parte}</span>;
      })}
    </span>
  );
}

export function renderizarTextoDiscord(texto: string): ReactNode {
  const lineas = texto.split('\n');

  return (
    <>
      {lineas.map((linea, i) => {
        if (/^### /.test(linea)) {
          return (
            <p key={i} className="text-sm font-bold">
              {conInline(linea.slice(4), i)}
            </p>
          );
        }
        if (/^## /.test(linea)) {
          return (
            <p key={i} className="text-base font-bold">
              {conInline(linea.slice(3), i)}
            </p>
          );
        }
        if (/^# /.test(linea)) {
          return (
            <p key={i} className="text-lg font-bold">
              {conInline(linea.slice(2), i)}
            </p>
          );
        }
        if (/^-# /.test(linea)) {
          return (
            <p key={i} className="text-xs text-white/45">
              {conInline(linea.slice(3), i)}
            </p>
          );
        }
        if (/^> /.test(linea)) {
          return (
            <p key={i} className="border-l-[3px] border-white/25 pl-2.5 text-white/85">
              {conInline(linea.slice(2), i)}
            </p>
          );
        }
        if (!linea.trim()) {
          return <div key={i} className="h-2.5" />;
        }
        return (
          <p key={i} className="text-white/90">
            {conInline(linea, i)}
          </p>
        );
      })}
    </>
  );
}
