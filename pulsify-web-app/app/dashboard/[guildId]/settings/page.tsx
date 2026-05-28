import { redirect } from 'next/navigation'

// Preferences moved to a global /preferences route — they affect every
// surface of the app, not just one server, so they no longer live under the
// per-guild dashboard. Existing in-app links and bookmarks land here and get
// bounced to the new location.
export default async function GuildSettingsRedirect() {
  redirect('/preferences')
}
