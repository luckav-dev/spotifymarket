import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import { sesionActual } from '@/lib/sesion';
import { BarraLateral } from '@/components/dashboard/sidebar';
import { Cabecera } from '@/components/dashboard/header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';

/**
 * Verificacion real de sesion.
 *
 * Proxy solo comprobo que existia la cookie (chequeo optimista, sin I/O). Aqui
 * se deserializa y se valida la firma HMAC y la caducidad; si algo no cuadra,
 * fuera. Ningun dato de la sesion llega al cliente sin pasar por aqui.
 */
export default async function LayoutDashboard({ children }: { children: React.ReactNode }) {
  const sesion = await sesionActual();
  if (!sesion) redirect('/login');
  const cookieStore = await cookies();
  const sidebarAbierta = cookieStore.get('sidebar_state')?.value !== 'false';

  return (
    <SidebarProvider defaultOpen={sidebarAbierta}>
      <BarraLateral />
      <SidebarInset className="h-svh min-w-0 overflow-hidden">
        <Cabecera sesion={sesion} />
        <main className="dashboard-scroll flex-1 overflow-y-auto px-4 py-5 md:px-6 md:py-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
