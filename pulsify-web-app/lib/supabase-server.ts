import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // `cookies().set()` throws when called during a Server Component
          // render (it's only allowed in Server Actions / Route Handlers).
          // Supabase calls this on token refresh; swallowing the error is the
          // canonical SSR pattern — the proxy middleware refreshes the session
          // on every request, so a missed write here is harmless. Without this
          // guard, a refresh firing mid-render would crash the page (and is the
          // likely cause of "logged-in users get bounced off pages" reports).
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Ignore — running in a context where cookies can't be set.
          }
        },
      },
    }
  );
}
