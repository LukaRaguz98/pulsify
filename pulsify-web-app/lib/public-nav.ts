// Single source of truth for the order of the public/info pages.
//
// Both the public sub-nav (components/public/PublicBreadcrumb) and the dashboard
// footer (components/Footer) render this list, so they always show the same
// pages in the same order — adding a page here updates every menu at once.
// (The landing footer keeps its own grouped Product/Resources/Legal columns.)
export const PUBLIC_PAGES: { href: string; label: string }[] = [
  { href: '/faq', label: 'FAQ' },
  { href: '/support', label: 'Support' },
  { href: '/community', label: 'Community' },
  { href: '/feedback', label: 'Feedback' },
  { href: '/release-notes', label: 'Release Notes' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
]
