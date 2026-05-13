import { LoginButton } from '@/components/LoginButton'

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-background text-foreground min-h-screen">
      <div className="flex flex-col items-center gap-8 text-center px-6">
        <div className="flex items-center gap-3 mb-2">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: 'linear-gradient(135deg, var(--p-1) 0%, var(--p-2) 100%)',
              boxShadow: '0 8px 24px -8px var(--p-glow)',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11v2a2 2 0 0 0 2 2h3l6 4V5L8 9H5a2 2 0 0 0-2 2Z"/>
              <path d="M18 8a4 4 0 0 1 0 8"/>
            </svg>
          </div>
          <span className="text-2xl font-bold tracking-tight" style={{ color: 'var(--p-1)' }}>Pulsify</span>
        </div>

        <div>
          <h1 className="text-5xl font-bold tracking-tight text-foreground leading-tight">
            Manage your Discord
            <br />
            <span style={{ color: 'var(--p-1)' }}>community</span>, smarter.
          </h1>
          <p className="mt-4 max-w-md text-lg text-muted-foreground leading-relaxed">
            Analytics, automations, events, moderation — all in one clean dashboard powered by the Pulse bot.
          </p>
        </div>

        <LoginButton />

        <p className="text-sm text-subtle">
          No credit card required. Free tier available.
        </p>
      </div>
    </div>
  )
}
