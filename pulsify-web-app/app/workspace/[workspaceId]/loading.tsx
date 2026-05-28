import { Skeleton } from '@/components/ui/skeleton'

// Shared Suspense fallback for every workspace page. Mirrors the dashboard
// loading skeleton's shape: header → stat row → content blocks.
export default function WorkspaceLoading() {
  return (
    <div className="page-content" aria-busy="true">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="space-y-2.5">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-9 w-32 rounded-xl" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border p-5" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-4 h-8 w-20" />
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border p-6 lg:col-span-2" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          <Skeleton className="h-5 w-40" />
          <div className="mt-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-1/3" /><Skeleton className="h-3 w-1/2" /></div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border p-6" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          <Skeleton className="h-5 w-32" />
          <div className="mt-6 space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2"><Skeleton className="h-3.5 w-2/3" /><Skeleton className="h-3 w-full" /></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
