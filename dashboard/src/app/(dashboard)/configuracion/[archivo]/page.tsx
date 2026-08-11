import { notFound } from 'next/navigation';
import { Settings2 } from 'lucide-react';

import { api, ErrorApi } from '@/lib/api';
import { ErrorConexion } from '@/components/dashboard/error-conexion';
import { ARCHIVOS_CONFIG } from '../archivos';
import { EditorConfig } from '../config-editor';
import type { JsonObjeto } from '@/lib/json';
import { PageHeader } from '@/components/dashboard/page-header';

export const dynamic = 'force-dynamic';

export default async function PaginaArchivoConfig({
  params,
}: {
  params: Promise<{ archivo: string }>;
}) {
  const { archivo } = await params;

  if (!(archivo in ARCHIVOS_CONFIG)) notFound();

  // El await se aisla del JSX: React construye elementos de forma perezosa,
  // asi que envolver el JSX en el mismo try/catch no protegeria de nada por
  // debajo de este componente y el linter de react-hooks lo marca.
  let datos: JsonObjeto | null = null;
  let mensajeError: string | null = null;

  try {
    datos = (await api.leerConfig(archivo)).datos;
  } catch (error) {
    mensajeError = error instanceof ErrorApi ? error.message : 'Error desconocido';
  }

  if (mensajeError) return <ErrorConexion mensaje={mensajeError} />;

  const info = ARCHIVOS_CONFIG[archivo];

  return (
    <div className="mx-auto max-w-screen-2xl space-y-5">
      <PageHeader eyebrow="Configuración" icon={Settings2} title={info.etiqueta} description={info.descripcion} status={`${archivo}.json`} />
      <EditorConfig nombre={archivo} datosIniciales={datos!} />
    </div>
  );
}
