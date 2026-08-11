'use client';

import { Bot } from 'lucide-react';

import type { Bloque } from '@/lib/api';
import { renderizarTextoDiscord } from '@/lib/discord-markdown';
import { urlEmojiCdn } from '@/lib/format';

const ESTILOS_BOTON: Record<string, string> = {
  primario: 'bg-[#5865F2] text-white hover:bg-[#4752C4]',
  secundario: 'bg-[#4E5058] text-white hover:bg-[#6D6F78]',
  exito: 'bg-[#248046] text-white hover:bg-[#1A6334]',
  peligro: 'bg-[#DA373C] text-white hover:bg-[#A12828]',
  enlace: 'bg-[#4E5058] text-white hover:bg-[#6D6F78]',
};

function IconoBoton({ emoji }: { emoji?: string }) {
  if (!emoji) return null;
  const url = urlEmojiCdn(emoji);
  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element -- CDN externo variable, no vale next/image sin configurar dominios por adelantado
  return <img src={url} alt="" className="size-4" />;
}

function VistaBoton({ boton }: { boton: NonNullable<Extract<Bloque, { tipo: 'botones' }>['botones']>[number] }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-8 items-center gap-1.5 rounded-[3px] px-3 text-sm font-medium ${ESTILOS_BOTON[boton.estilo ?? 'secundario']}`}
    >
      <IconoBoton emoji={boton.emoji} />
      {boton.etiqueta || 'Boton'}
    </span>
  );
}

function VistaBloque({ bloque }: { bloque: Bloque }) {
  switch (bloque.tipo) {
    case 'titulo':
    case 'texto':
      return (
        <div className="space-y-1">
          {renderizarTextoDiscord(
            bloque.tipo === 'titulo' ? `${'#'.repeat(bloque.nivel ?? 1)} ${bloque.texto}` : bloque.contenido,
          )}
        </div>
      );

    case 'separador':
      return bloque.linea ?? true ? (
        <hr className={`border-white/10 ${bloque.espaciado === 'grande' ? 'my-3' : 'my-1'}`} />
      ) : (
        <div className={bloque.espaciado === 'grande' ? 'h-3' : 'h-1'} />
      );

    case 'imagenes':
      return (
        <div className="grid grid-cols-2 gap-1 overflow-hidden rounded-lg">
          {bloque.urls.map((url, i) => (
            <div key={i} className="relative aspect-video bg-black/30">
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt="" className="size-full object-cover" />
              ) : null}
            </div>
          ))}
        </div>
      );

    case 'seccion':
      return (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">{renderizarTextoDiscord(bloque.texto)}</div>
          {bloque.miniatura ? (
            <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-black/30">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={bloque.miniatura} alt="" className="size-full object-cover" />
            </div>
          ) : bloque.boton ? (
            <VistaBoton boton={bloque.boton} />
          ) : null}
        </div>
      );

    case 'botones':
      return (
        <div className="flex flex-wrap gap-2">
          {bloque.botones.map((boton, i) => (
            <VistaBoton key={i} boton={boton} />
          ))}
        </div>
      );

    default:
      return null;
  }
}

export function VistaPreviaAnuncio({ bloques }: { bloques: Bloque[] }) {
  return (
    <div className="overflow-hidden rounded-lg bg-[#313338] text-sm">
      <div className="flex items-start gap-3 p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#5865F2]">
          <Bot className="size-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-white">Bot</span>
            <span className="rounded bg-[#5865F2] px-1 py-px text-[10px] font-medium text-white">BOT</span>
            <span className="text-xs text-white/40">ahora</span>
          </div>

          {bloques.length === 0 ? (
            <p className="mt-1 text-white/40 italic">El anuncio esta vacio. Anade un bloque para empezar.</p>
          ) : (
            <div className="mt-1.5 max-w-md space-y-2 rounded-lg border border-white/10 bg-[#2b2d31] p-3">
              {bloques.map((bloque, i) => (
                <VistaBloque key={i} bloque={bloque} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
