import type { LucideIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';

export function PageHeader({
  title,
  description,
  eyebrow,
  icon: Icon,
  actions,
  status,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  status?: string;
}) {
  return (
    <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            {Icon ? <Icon className="size-3.5" /> : null}
            {eyebrow}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-semibold sm:text-3xl">{title}</h2>
          {status ? <Badge variant="outline" className="font-normal text-muted-foreground">{status}</Badge> : null}
        </div>
        {description ? <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
