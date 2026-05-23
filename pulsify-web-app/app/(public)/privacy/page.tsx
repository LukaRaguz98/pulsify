import type { Metadata } from 'next'
import { LegalDoc, type LegalSection } from '@/components/public/LegalDoc'
import { SITE } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Privacy Policy · Pulsify',
  description:
    'How Pulsify collects, uses, stores and protects your data — including Discord OAuth, analytics, cookies, security and third-party services.',
  alternates: { canonical: '/privacy' },
}

const SECTIONS: LegalSection[] = [
  {
    id: 'data-we-collect',
    heading: 'Information We Collect',
    blocks: [
      'We aim to collect only what we need to run the service. The information we process falls into the following categories:',
      {
        bullets: [
          'Discord account data — your Discord user ID, username, global display name, avatar and email, provided through Discord OAuth when you sign in.',
          'Server (guild) data — IDs, names, icons, roles, channels and member lists for the servers you manage, retrieved through the Discord API.',
          'Activity data — message counts, voice activity, joins and leaves and command usage, used to power analytics. We store aggregate counts and metadata, not the contents of your members’ private messages.',
          'Moderation data — warnings, timeouts, bans, notes and audit entries created by you or your moderators through the dashboard or the bot.',
          'Configuration data — your automations, scheduled workflows, command settings, Pulse Guard rules and dashboard preferences.',
          'Technical data — basic request metadata such as IP address and browser type, used for security and to keep the service running.',
        ],
      },
    ],
  },
  {
    id: 'discord-oauth',
    heading: 'Discord OAuth Data Usage',
    blocks: [
      'When you sign in with Discord, we request a limited set of OAuth scopes:',
      {
        bullets: [
          'identify — to recognise who you are and show your profile in the dashboard.',
          'email — to associate your account and send essential service communications.',
          'guilds — to list the servers you manage and verify you hold the required permissions.',
        ],
      },
      'We use Discord OAuth tokens only to perform the actions you request. Tokens are stored securely and refreshed automatically, and you can revoke Pulsify’s access at any time from your Discord account settings.',
    ],
  },
  {
    id: 'analytics',
    heading: 'Analytics & Tracking',
    blocks: [
      'Pulsify records server activity — messages, voice, joins and command usage — to generate the analytics and insights shown in your dashboard. This data is tied to servers and is used to operate features you turn on, not to build advertising profiles.',
      'We do not sell your data, and we do not embed third-party advertising trackers in the dashboard.',
    ],
  },
  {
    id: 'cookies',
    heading: 'Cookies & Session Handling',
    blocks: [
      'We use first-party cookies strictly to operate the service:',
      {
        bullets: [
          'Authentication cookies — maintain your secure session after you sign in with Discord.',
          'Preference cookies — remember non-sensitive UI settings such as theme, density and layout so the dashboard looks the way you left it.',
        ],
      },
      'We do not use cookies for cross-site advertising or behavioural tracking.',
    ],
  },
  {
    id: 'storage-security',
    heading: 'Data Storage & Security',
    blocks: [
      'Your data is stored with our managed database and infrastructure providers and protected with encryption in transit (HTTPS) and access controls.',
      'We restrict access to production data to the systems and people that need it and follow least-privilege principles. No method of transmission or storage is ever completely secure, but we work to protect your information using industry-standard practices.',
    ],
  },
  {
    id: 'third-parties',
    heading: 'Third-Party Services',
    blocks: [
      'We rely on a small set of trusted providers to operate Pulsify:',
      {
        bullets: [
          'Discord — the platform Pulsify integrates with; your use of Discord is governed by Discord’s own policies.',
          'Supabase — authentication and database hosting.',
          'AI providers — used by Pulse Guard to analyse message content for moderation; only the content needed for a moderation decision is processed.',
          'Hosting & infrastructure — to serve the dashboard and run the Pulse bot.',
        ],
      },
      'Each provider processes data only as needed to deliver their part of the service.',
    ],
  },
  {
    id: 'data-retention',
    heading: 'Data Retention',
    blocks: [
      'We keep your data for as long as your account and servers remain active. When you remove the Pulse bot from a server or delete your account, the associated configuration and synced data is scheduled for deletion. Some records may be retained where required for security, legal or fraud-prevention purposes.',
    ],
  },
  {
    id: 'your-rights',
    heading: 'Your Rights & Choices',
    blocks: [
      'Depending on where you live, you may have the right to access, correct, export or delete your personal data:',
      {
        bullets: [
          'Revoke access — disconnect Pulsify from Discord at any time in your Discord account settings.',
          'Delete data — remove the Pulse bot from a server, or contact us to request deletion of your account data.',
          'Access & correction — contact us to review or update the information we hold about you.',
        ],
      },
    ],
  },
  {
    id: 'childrens-privacy',
    heading: 'Children’s Privacy',
    blocks: [
      'Pulsify is not directed to children below the minimum age required to use Discord in their country (typically 13). We do not knowingly collect personal data from children below that age. If you believe a child has provided us with data, contact us and we will remove it.',
    ],
  },
  {
    id: 'changes',
    heading: 'Changes to This Policy',
    blocks: [
      'We may update this Privacy Policy as the service evolves. Material changes will be reflected by updating the “Last updated” date above, and where appropriate we will provide additional notice.',
    ],
  },
]

export default function PrivacyPage() {
  return (
    <LegalDoc
      eyebrow="Privacy"
      title="Privacy Policy"
      updated={SITE.legalLastUpdated}
      contactEmail={SITE.privacyEmail}
      intro="This Privacy Policy explains what information Pulsify collects when you use the dashboard and the Pulse bot, how we use it, and the choices you have. By using Pulsify you agree to the practices described here."
      sections={SECTIONS}
    />
  )
}
