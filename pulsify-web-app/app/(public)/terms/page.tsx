import type { Metadata } from 'next'
import { LegalDoc, type LegalSection } from '@/components/public/LegalDoc'
import { SITE } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Terms of Service · Pulsify',
  description:
    'The terms that govern your use of Pulsify and the Pulse bot — acceptable use, prohibited behaviour, service limitations, moderation disclaimers, termination, liability and intellectual property.',
  alternates: { canonical: '/terms' },
}

const SECTIONS: LegalSection[] = [
  {
    id: 'acceptance',
    heading: 'Acceptance of Terms',
    blocks: [
      'By accessing or using Pulsify you confirm that you can form a binding contract, that you are old enough to use Discord in your jurisdiction, and that you will comply with these Terms as well as Discord’s Terms of Service and Community Guidelines.',
      'If you use Pulsify on behalf of an organisation, you represent that you have authority to bind that organisation to these Terms.',
    ],
  },
  {
    id: 'service',
    heading: 'Description of the Service',
    blocks: [
      'Pulsify is a dashboard and bot for managing Discord communities — including moderation, analytics, events, roles, channels, automations and AI-assisted moderation (“Pulse Guard”). The features available to you depend on your plan and may change over time as we improve the service.',
    ],
  },
  {
    id: 'acceptable-use',
    heading: 'Acceptable Use',
    blocks: [
      'You agree to use Pulsify only for lawful purposes and in line with these Terms. You are responsible for the servers you manage, the configuration you apply and the actions taken through your account.',
      {
        bullets: [
          'Use the service in compliance with Discord’s policies and all applicable laws.',
          'Keep your account secure and only grant access to people you trust.',
          'Use the bot’s permissions responsibly and only where you are authorised to manage the server.',
        ],
      },
    ],
  },
  {
    id: 'prohibited',
    heading: 'Prohibited Behaviour',
    blocks: [
      'You may not, and may not allow others to:',
      {
        bullets: [
          'Use Pulsify to harass, abuse or harm others, or to facilitate illegal activity.',
          'Attempt to disrupt, overload, reverse-engineer or gain unauthorised access to the service or its infrastructure.',
          'Circumvent rate limits, usage limits, plan restrictions or security measures.',
          'Resell, sublicense or misrepresent the service as your own.',
          'Use the service to violate Discord’s Terms of Service or the rights of any third party.',
        ],
      },
    ],
  },
  {
    id: 'limitations',
    heading: 'Service Limitations & Availability',
    blocks: [
      'We work hard to keep Pulsify available and reliable, but the service is provided on an “as is” and “as available” basis. We do not guarantee uninterrupted or error-free operation, and features, limits and pricing may change.',
      'Some functionality depends on Discord and other third-party services that are outside our control, and may be affected when those services are unavailable.',
    ],
  },
  {
    id: 'moderation-disclaimer',
    heading: 'Moderation & Automation Disclaimer',
    blocks: [
      'Pulse Guard and the automation features are powerful tools, but they are not perfect. AI moderation may produce false positives or miss content, and automations act exactly as you configure them.',
      {
        bullets: [
          'You are responsible for reviewing your moderation and automation settings before relying on them.',
          'You remain responsible for moderation decisions taken on your servers, whether manual or automated.',
          'We are not liable for actions taken, or not taken, by automated systems you choose to enable.',
        ],
      },
    ],
  },
  {
    id: 'accounts',
    heading: 'Accounts, Suspension & Termination',
    blocks: [
      'You access Pulsify through your Discord account. You may stop using the service at any time by removing the Pulse bot and disconnecting Pulsify from Discord.',
      'We may suspend or terminate access if you violate these Terms, create risk or legal exposure, or abuse the service. Where reasonable we will provide notice, but we may act immediately when necessary to protect the service or other users.',
    ],
  },
  {
    id: 'intellectual-property',
    heading: 'Intellectual Property',
    blocks: [
      'Pulsify, the Pulse bot, our logos, designs and the software behind the service are owned by us and protected by intellectual-property laws. These Terms do not grant you any ownership of the service.',
      'Your server content and configuration remain yours. You grant us the limited rights needed to operate the service on your behalf — for example, to store and display your settings and analytics.',
    ],
  },
  {
    id: 'liability',
    heading: 'Disclaimers & Limitation of Liability',
    blocks: [
      'To the maximum extent permitted by law, Pulsify and its operators are not liable for any indirect, incidental, special or consequential damages, or for loss of data, profits or goodwill, arising from your use of the service.',
      'The service is provided without warranties of any kind, whether express or implied. Some jurisdictions do not allow certain limitations, so some of the above may not apply to you.',
    ],
  },
  {
    id: 'changes',
    heading: 'Changes to These Terms',
    blocks: [
      'We may update these Terms from time to time. We will update the “Last updated” date above, and your continued use of the service after changes take effect constitutes acceptance of the revised Terms.',
    ],
  },
]

export default function TermsPage() {
  return (
    <LegalDoc
      eyebrow="Legal"
      title="Terms of Service"
      updated={SITE.legalLastUpdated}
      contactEmail={SITE.supportEmail}
      intro="These Terms of Service govern your access to and use of Pulsify, including the dashboard and the Pulse bot. By inviting the Pulse bot or signing in to the dashboard, you agree to these Terms. If you do not agree, please do not use the service."
      sections={SECTIONS}
    />
  )
}
