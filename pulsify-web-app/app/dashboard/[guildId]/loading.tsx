import { Skeleton } from '@/components/ui/skeleton'

// Shared route-level loading fallback for every page under a guild.
//
// Placed at the `[guildId]` segment so it becomes the Suspense boundary fallback
// for the whole dashboard — navigating between any feature page (Statistics,
// Moderation, Channels, …) shows this polished skeleton instead of a blank
// frame while the server component streams in. Individual pages can still add
// their own loading.tsx to override this when a tailored shape reads better.
//
// Mirrors the common page shape: `page-content` wrapper → PageHeader (title +
// subtitle) → a row of stat cards → a couple of wide content blocks. The pulse
// animation is auto-neutralised under `[data-animations="false"]`.
export default function GuildLoading() {
  return (
    <div className="page-content" aria-busy="true">
      {/* PageHeader — title + subtitle, optional action on the right. */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="space-y-2.5">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-28 rounded-xl" />
      </div>

      {/* Stat cards row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border p-5"
            style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
          >
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-4 h-8 w-20" />
            <Skeleton className="mt-3 h-3 w-16" />
          </div>
        ))}
      </div>

      {/* Wide content blocks */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div
          className="rounded-xl border p-6 lg:col-span-2"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        >
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-2 h-3 w-56 max-w-full" />
          <div className="mt-6 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-6 w-14 rounded-md" />
              </div>
            ))}
          </div>
        </div>

        <div
          className="rounded-xl border p-6"
          style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
        >
          <Skeleton className="h-5 w-32" />
          <div className="mt-6 space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3.5 w-2/3" />
                <Skeleton className="h-3 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
