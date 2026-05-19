import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { setDiscordSessionFromOAuth } from '@/lib/discord-session';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // Honour `?next=…` so we can return the user to the page they bounced
  // from when re-authorising mid-session, instead of always landing on
  // /dashboard.
  const next = searchParams.get('next');

  if (code) {
    const supabase = await createClient();
    const { data } = await supabase.auth.exchangeCodeForSession(code);

    // Snapshot the Discord tokens into our own cookie. Supabase wipes
    // provider_token on every session refresh, so without this the
    // dashboard would think the Discord session expired within ~1h.
    const providerToken = data?.session?.provider_token;
    const refreshToken = data?.session?.provider_refresh_token;
    if (providerToken && refreshToken) {
      await setDiscordSessionFromOAuth({
        access_token: providerToken,
        refresh_token: refreshToken,
        // Discord access tokens last 7 days by default; we don't get the
        // exact expires_in from Supabase, so use that as a safe upper bound
        // — `getValidDiscordToken` will refresh proactively before expiry.
        expires_in: 7 * 24 * 60 * 60,
      });
    }
  }

  const redirectPath = next && next.startsWith('/') ? next : '/dashboard';
  return NextResponse.redirect(`${origin}${redirectPath}`);
}
