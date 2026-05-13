import Image from 'next/image'
import { LoginButton } from '@/components/LoginButton'

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-background text-foreground min-h-screen">
      <div className="flex flex-col items-center gap-8 text-center px-6">
        <div className="flex items-center gap-3 mb-2">
          <Image
            src="/logo.png"
            alt="Pulsify"
            width={64}
            height={64}
            className="shrink-0"
            style={{ filter: 'drop-shadow(0 8px 24px var(--p-glow))' }}
            priority
          />
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
