'use client';

import { Hash } from 'lucide-react';

import type { Recursos } from '@/lib/api';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';

type Canal = Recursos['canalesTexto'][number];

export function ChannelCombobox({ canales, value, onValueChange, placeholder = 'Buscar un canal…' }: {
  canales: Canal[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
}) {
  const seleccionado = canales.find((canal) => canal.id === value) ?? null;

  return (
    <Combobox
      items={canales}
      value={seleccionado}
      onValueChange={(canal) => onValueChange(canal?.id ?? '')}
      itemToStringLabel={(canal) => `#${canal.nombre}`}
      itemToStringValue={(canal) => canal.id}
      isItemEqualToValue={(canal, actual) => canal.id === actual.id}
    >
      <ComboboxInput aria-label="Canal de Discord" placeholder={placeholder} className="w-full" showClear />
      <ComboboxContent>
        <ComboboxEmpty>No se encontró ningún canal.</ComboboxEmpty>
        <ComboboxList>
          {(canal: Canal) => (
            <ComboboxItem key={canal.id} value={canal}>
              <Hash className="text-muted-foreground" />
              <span className="flex-1 truncate">{canal.nombre}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
