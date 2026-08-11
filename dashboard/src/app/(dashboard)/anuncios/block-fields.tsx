'use client';

import { Plus, Trash2, Image as ImageIcon } from 'lucide-react';

import type { Bloque, BotonBloque } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { urlEmojiCdn } from '@/lib/format';

const MAX_IMAGENES = 10;
const MAX_BOTONES_FILA = 5;

function SelectorEmoji({
  valor,
  emojisPorRol,
  onChange,
}: {
  valor?: string;
  emojisPorRol: Record<string, string>;
  onChange: (rol: string | undefined) => void;
}) {
  return (
    <Select
      value={valor ?? '__ninguno'}
      onValueChange={(v) => onChange(!v || v === '__ninguno' ? undefined : v)}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Sin icono" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__ninguno">Sin icono</SelectItem>
        {Object.entries(emojisPorRol).map(([rol, mencion]) => {
          const url = urlEmojiCdn(mencion);
          return (
            <SelectItem key={rol} value={rol}>
              <span className="flex items-center gap-2">
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt="" className="size-4" />
                ) : (
                  <span className="size-4" />
                )}
                {rol}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

function CamposBoton({
  boton,
  emojisPorRol,
  onChange,
}: {
  boton: BotonBloque;
  emojisPorRol: Record<string, string>;
  onChange: (boton: BotonBloque) => void;
}) {
  const esEnlace = boton.estilo === 'enlace';

  return (
    <div className="grid grid-cols-2 gap-2 rounded-md border border-border p-2.5">
      <div className="col-span-2 space-y-1">
        <Label className="text-xs">Etiqueta</Label>
        <Input
          value={boton.etiqueta}
          maxLength={80}
          onChange={(e) => onChange({ ...boton, etiqueta: e.target.value })}
          placeholder="Comprar"
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Estilo</Label>
        <Select
          value={boton.estilo ?? 'secundario'}
          onValueChange={(v) => onChange({ ...boton, estilo: v as BotonBloque['estilo'] })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="primario">Primario</SelectItem>
            <SelectItem value="secundario">Secundario</SelectItem>
            <SelectItem value="exito">Exito</SelectItem>
            <SelectItem value="peligro">Peligro</SelectItem>
            <SelectItem value="enlace">Enlace</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Icono</Label>
        <SelectorEmoji
          valor={boton.emoji}
          emojisPorRol={emojisPorRol}
          onChange={(emoji) => onChange({ ...boton, emoji })}
        />
      </div>

      <div className="col-span-2 space-y-1">
        <Label className="text-xs">{esEnlace ? 'URL' : 'ID de accion (customId)'}</Label>
        {esEnlace ? (
          <Input
            value={boton.url ?? ''}
            onChange={(e) => onChange({ ...boton, url: e.target.value })}
            placeholder="https://..."
          />
        ) : (
          <Input
            value={boton.customId ?? ''}
            onChange={(e) => onChange({ ...boton, customId: e.target.value })}
            placeholder="shop:pagina:0"
            className="font-mono text-xs"
          />
        )}
      </div>
    </div>
  );
}

const BOTON_VACIO: BotonBloque = { etiqueta: '', estilo: 'secundario' };

export function CamposBloque({
  bloque,
  emojisPorRol,
  onChange,
}: {
  bloque: Bloque;
  emojisPorRol: Record<string, string>;
  onChange: (bloque: Bloque) => void;
}) {
  switch (bloque.tipo) {
    case 'titulo':
      return (
        <div className="flex gap-2">
          <Input
            value={bloque.texto}
            onChange={(e) => onChange({ ...bloque, texto: e.target.value })}
            placeholder="Titulo del anuncio"
            className="flex-1"
          />
          <Select
            value={String(bloque.nivel ?? 1)}
            onValueChange={(v) => onChange({ ...bloque, nivel: Number(v) })}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Titulo</SelectItem>
              <SelectItem value="2">Subtitulo</SelectItem>
              <SelectItem value="3">Menor</SelectItem>
            </SelectContent>
          </Select>
        </div>
      );

    case 'texto':
      return (
        <div className="space-y-1">
          <Textarea
            value={bloque.contenido}
            onChange={(e) => onChange({ ...bloque, contenido: e.target.value })}
            placeholder={'Texto del bloque. Admite **negrita**, `codigo`, > cita y -# texto pequeno.'}
            rows={3}
          />
        </div>
      );

    case 'separador':
      return (
        <div className="flex gap-2">
          <Select
            value={bloque.linea === false ? 'sin' : 'con'}
            onValueChange={(v) => onChange({ ...bloque, linea: v === 'con' })}
          >
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="con">Con linea</SelectItem>
              <SelectItem value="sin">Solo aire</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={bloque.espaciado ?? 'grande'}
            onValueChange={(v) => onChange({ ...bloque, espaciado: v as 'pequeno' | 'grande' })}
          >
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pequeno">Espaciado pequeno</SelectItem>
              <SelectItem value="grande">Espaciado grande</SelectItem>
            </SelectContent>
          </Select>
        </div>
      );

    case 'imagenes':
      return (
        <div className="space-y-2">
          {bloque.urls.map((url, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={url}
                onChange={(e) => {
                  const urls = [...bloque.urls];
                  urls[i] = e.target.value;
                  onChange({ ...bloque, urls });
                }}
                placeholder="https://..."
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => onChange({ ...bloque, urls: bloque.urls.filter((_, j) => j !== i) })}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
          {bloque.urls.length < MAX_IMAGENES && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => onChange({ ...bloque, urls: [...bloque.urls, ''] })}
            >
              <ImageIcon className="size-3.5" />
              Anadir imagen
            </Button>
          )}
        </div>
      );

    case 'seccion': {
      const tieneMiniatura = Boolean(bloque.miniatura);

      return (
        <div className="space-y-2.5">
          <Textarea
            value={bloque.texto}
            onChange={(e) => onChange({ ...bloque, texto: e.target.value })}
            placeholder="Texto de la seccion"
            rows={2}
          />

          <div className="flex gap-2">
            <Select
              value={tieneMiniatura ? 'miniatura' : 'boton'}
              onValueChange={(v) =>
                onChange(
                  v === 'miniatura'
                    ? { ...bloque, boton: undefined, miniatura: '' }
                    : { ...bloque, miniatura: undefined, boton: bloque.boton ?? BOTON_VACIO },
                )
              }
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="boton">Con boton</SelectItem>
                <SelectItem value="miniatura">Con miniatura</SelectItem>
              </SelectContent>
            </Select>

            {tieneMiniatura ? (
              <Input
                value={bloque.miniatura ?? ''}
                onChange={(e) => onChange({ ...bloque, miniatura: e.target.value })}
                placeholder="https://..."
                className="flex-1"
              />
            ) : null}
          </div>

          {!tieneMiniatura && (
            <CamposBoton
              boton={bloque.boton ?? BOTON_VACIO}
              emojisPorRol={emojisPorRol}
              onChange={(boton) => onChange({ ...bloque, boton })}
            />
          )}
        </div>
      );
    }

    case 'botones':
      return (
        <div className="space-y-2">
          {bloque.botones.map((boton, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="flex-1">
                <CamposBoton
                  boton={boton}
                  emojisPorRol={emojisPorRol}
                  onChange={(nuevo) => {
                    const botones = [...bloque.botones];
                    botones[i] = nuevo;
                    onChange({ ...bloque, botones });
                  }}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mt-2.5 shrink-0"
                onClick={() => onChange({ ...bloque, botones: bloque.botones.filter((_, j) => j !== i) })}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
          {bloque.botones.length < MAX_BOTONES_FILA && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => onChange({ ...bloque, botones: [...bloque.botones, { ...BOTON_VACIO }] })}
            >
              <Plus className="size-3.5" />
              Anadir boton
            </Button>
          )}
        </div>
      );

    default:
      return null;
  }
}
