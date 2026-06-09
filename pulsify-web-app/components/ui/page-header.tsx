import { highlightBrand } from '@/components/ui/brand-text'
import { HelpTip } from '@/components/ui/help-tip'

type Props = {
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  /** Renders a contextual-help ⓘ next to the title; looks copy up by id from
   *  lib/help-content. No-op when the user has disabled contextual help. */
  helpId?: string
}

export function PageHeader({ title, description, action, helpId }: Props) {
  return (
    // On phones the title + a non-shrinking action row can't share one line, so
    // the actions stack below the title at full width. `max-sm:[&>*]:flex-wrap`
    // lets the action's button row (the common `<div className="flex ...">`
    // pattern every view passes) wrap instead of overflowing off the edge.
    <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <h1 className="flex items-center gap-1.5 text-2xl font-bold tracking-tight text-foreground">
          <span className="min-w-0">{title}</span>
          {helpId && <HelpTip id={helpId} iconSize={18} />}
        </h1>
        {description && (
          <p className="mt-1.5 text-sm text-muted-foreground">{highlightBrand(description)}</p>
        )}
      </div>
      {action && (
        <div className="shrink-0 max-sm:w-full max-sm:[&>*]:flex-wrap">{action}</div>
      )}
    </div>
  )
}
