import { Skeleton } from '@/components/ui/skeleton';

export default function LoadingDashboard() {
  return (
    <div className="mx-auto max-w-screen-2xl space-y-6">
      <Skeleton className="h-24 rounded-lg" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
      <Skeleton className="h-72 rounded-lg" />
    </div>
  );
}
