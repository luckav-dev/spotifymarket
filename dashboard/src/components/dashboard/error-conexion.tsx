import { ServerCrash } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/** El fallo mas comun del dashboard con diferencia: el bot no esta arrancado. */
export function ErrorConexion({ mensaje }: { mensaje: string }) {
  return (
    <Alert variant="destructive">
      <ServerCrash className="size-4" />
      <AlertTitle>No se pudo hablar con el bot</AlertTitle>
      <AlertDescription>{mensaje}</AlertDescription>
    </Alert>
  );
}
