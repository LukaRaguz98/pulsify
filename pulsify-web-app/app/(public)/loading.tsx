import { Skeleton } from '@/components/ui/skeleton'

// Shown during navigation to a public page while it streams in. Mirrors the
// rough shape of a doc/content page so the transition feels intentional.
export default function PublicLoading() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-14 sm:py-20" aria-busy="true">
      <Skeleton className="h-7 w-32 rounded-full" />
      <Skeleton className="mt-5 h-12 w-2/3" />
      <Skeleton className="mt-4 h-4 w-40" />
      <Skeleton className="mt-6 h-4 w-full max-w-2xl" />
      <div className="mt-14 grid gap-12 lg:grid-cols-[220px_1fr]">
        <div className="hidden space-y-3 lg:block">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-40" />
          ))}
        </div>
        <div className="space-y-10">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
