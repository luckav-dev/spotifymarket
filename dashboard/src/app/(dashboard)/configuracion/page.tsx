import { Settings2 } from 'lucide-react';

import { ARCHIVOS_CONFIG } from './archivos';
import { ConfigGrid } from './config-grid';
import { PageHeader } from '@/components/dashboard/page-header';

export default function PaginaConfiguracion() {
  return (
    <div className="mx-auto max-w-screen-2xl space-y-6">
      <PageHeader
        eyebrow="Sistema"
        icon={Settings2}
        title="Configuración"
        description="Edita la presencia, permisos, textos y comportamiento que utiliza el bot en tiempo real."
        status={`${Object.keys(ARCHIVOS_CONFIG).length} módulos`}
      />
      <ConfigGrid />
    </div>
  );
}
