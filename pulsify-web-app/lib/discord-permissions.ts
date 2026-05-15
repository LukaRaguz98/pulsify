// Discord permission catalog — bitfields, display labels, grouping into the
// same categories Discord uses in its native role editor, and danger flags for
// permissions that can compromise the server if misassigned.
//
// Reference: https://discord.com/developers/docs/topics/permissions

export type PermissionDanger = 'high' | 'medium'

export type PermissionDef = {
  /** Stable key used by presets and the UI. */
  key: string
  /** 64-bit Discord permission flag. */
  bit: bigint
  label: string
  description: string
  danger?: PermissionDanger
}

export type PermissionCategory = {
  key: string
  label: string
  permissions: PermissionDef[]
}

export const PERMISSION_CATEGORIES: PermissionCategory[] = [
  {
    key: 'general',
    label: 'General Server Permissions',
    permissions: [
      {
        key: 'VIEW_CHANNEL',
        bit: 1n << 10n,
        label: 'View Channels',
        description: 'Allows members to view channels by default (excluding private channels).',
      },
      {
        key: 'MANAGE_CHANNELS',
        bit: 1n << 4n,
        label: 'Manage Channels',
        description: 'Allows members to create, edit, or delete channels.',
        danger: 'medium',
      },
      {
        key: 'MANAGE_ROLES',
        bit: 1n << 28n,
        label: 'Manage Roles',
        description: 'Allows members to create, edit, and delete roles lower than their highest role.',
        danger: 'high',
      },
      {
        key: 'CREATE_GUILD_EXPRESSIONS',
        bit: 1n << 43n,
        label: 'Create Expressions',
        description: 'Allows members to add custom emojis, stickers, and sounds.',
      },
      {
        key: 'MANAGE_GUILD_EXPRESSIONS',
        bit: 1n << 30n,
        label: 'Manage Expressions',
        description: 'Allows members to edit or remove custom emojis, stickers, and sounds.',
      },
      {
        key: 'VIEW_AUDIT_LOG',
        bit: 1n << 7n,
        label: 'View Audit Log',
        description: 'Allows members to view the audit log.',
      },
      {
        key: 'VIEW_GUILD_INSIGHTS',
        bit: 1n << 19n,
        label: 'View Server Insights',
        description: 'Allows members to view server insights.',
      },
      {
        key: 'MANAGE_WEBHOOKS',
        bit: 1n << 29n,
        label: 'Manage Webhooks',
        description: 'Allows members to create, edit, and delete webhooks.',
        danger: 'medium',
      },
      {
        key: 'MANAGE_GUILD',
        bit: 1n << 5n,
        label: 'Manage Server',
        description: 'Allows members to change server name, region, icon, and other settings.',
        danger: 'high',
      },
    ],
  },
  {
    key: 'membership',
    label: 'Membership Permissions',
    permissions: [
      {
        key: 'CREATE_INSTANT_INVITE',
        bit: 1n << 0n,
        label: 'Create Invite',
        description: 'Allows members to invite new people to the server.',
      },
      {
        key: 'CHANGE_NICKNAME',
        bit: 1n << 26n,
        label: 'Change Nickname',
        description: 'Allows members to change their own nickname.',
      },
      {
        key: 'MANAGE_NICKNAMES',
        bit: 1n << 27n,
        label: 'Manage Nicknames',
        description: 'Allows members to change other members\' nicknames.',
      },
      {
        key: 'KICK_MEMBERS',
        bit: 1n << 1n,
        label: 'Kick Members',
        description: 'Allows kicking members from the server.',
        danger: 'medium',
      },
      {
        key: 'BAN_MEMBERS',
        bit: 1n << 2n,
        label: 'Ban Members',
        description: 'Allows permanently banning members from the server.',
        danger: 'high',
      },
      {
        key: 'MODERATE_MEMBERS',
        bit: 1n << 40n,
        label: 'Timeout Members',
        description: 'Allows temporarily preventing members from interacting with the server.',
        danger: 'medium',
      },
    ],
  },
  {
    key: 'text',
    label: 'Text Channel Permissions',
    permissions: [
      {
        key: 'SEND_MESSAGES',
        bit: 1n << 11n,
        label: 'Send Messages',
        description: 'Allows posting messages in text channels.',
      },
      {
        key: 'SEND_MESSAGES_IN_THREADS',
        bit: 1n << 38n,
        label: 'Send Messages in Threads',
        description: 'Allows posting messages in threads.',
      },
      {
        key: 'CREATE_PUBLIC_THREADS',
        bit: 1n << 35n,
        label: 'Create Public Threads',
        description: 'Allows creating threads visible to everyone with channel access.',
      },
      {
        key: 'CREATE_PRIVATE_THREADS',
        bit: 1n << 36n,
        label: 'Create Private Threads',
        description: 'Allows creating invite-only threads.',
      },
      {
        key: 'EMBED_LINKS',
        bit: 1n << 14n,
        label: 'Embed Links',
        description: 'Allows links posted by this role to render as embeds.',
      },
      {
        key: 'ATTACH_FILES',
        bit: 1n << 15n,
        label: 'Attach Files',
        description: 'Allows uploading files or media.',
      },
      {
        key: 'ADD_REACTIONS',
        bit: 1n << 6n,
        label: 'Add Reactions',
        description: 'Allows adding new emoji reactions to messages.',
      },
      {
        key: 'USE_EXTERNAL_EMOJIS',
        bit: 1n << 18n,
        label: 'Use External Emoji',
        description: 'Allows using emojis from other servers.',
      },
      {
        key: 'USE_EXTERNAL_STICKERS',
        bit: 1n << 37n,
        label: 'Use External Stickers',
        description: 'Allows using stickers from other servers.',
      },
      {
        key: 'MENTION_EVERYONE',
        bit: 1n << 17n,
        label: 'Mention @everyone, @here, and All Roles',
        description: 'Allows pinging everyone in a channel as well as any role.',
        danger: 'medium',
      },
      {
        key: 'MANAGE_MESSAGES',
        bit: 1n << 13n,
        label: 'Manage Messages',
        description: 'Allows deleting or pinning messages from other members.',
        danger: 'medium',
      },
      {
        key: 'MANAGE_THREADS',
        bit: 1n << 34n,
        label: 'Manage Threads',
        description: 'Allows renaming, deleting, archiving, and turning on slow mode in threads.',
      },
      {
        key: 'READ_MESSAGE_HISTORY',
        bit: 1n << 16n,
        label: 'Read Message History',
        description: 'Allows reading previous messages.',
      },
      {
        key: 'SEND_TTS_MESSAGES',
        bit: 1n << 12n,
        label: 'Send Text-to-Speech Messages',
        description: 'Allows sending /tts messages that play out loud for everyone.',
      },
      {
        key: 'USE_APPLICATION_COMMANDS',
        bit: 1n << 31n,
        label: 'Use Application Commands',
        description: 'Allows using slash and context-menu commands from applications.',
      },
      {
        key: 'SEND_VOICE_MESSAGES',
        bit: 1n << 46n,
        label: 'Send Voice Messages',
        description: 'Allows sending voice messages.',
      },
      {
        key: 'SEND_POLLS',
        bit: 1n << 49n,
        label: 'Create Polls',
        description: 'Allows creating polls in text channels.',
      },
      {
        key: 'USE_EXTERNAL_APPS',
        bit: 1n << 50n,
        label: 'Use External Apps',
        description: 'Allows using application commands from apps not installed on this server.',
      },
    ],
  },
  {
    key: 'voice',
    label: 'Voice Channel Permissions',
    permissions: [
      {
        key: 'CONNECT',
        bit: 1n << 20n,
        label: 'Connect',
        description: 'Allows connecting to voice channels.',
      },
      {
        key: 'SPEAK',
        bit: 1n << 21n,
        label: 'Speak',
        description: 'Allows speaking in voice channels.',
      },
      {
        key: 'STREAM',
        bit: 1n << 9n,
        label: 'Video',
        description: 'Allows streaming video or sharing screen.',
      },
      {
        key: 'USE_EMBEDDED_ACTIVITIES',
        bit: 1n << 39n,
        label: 'Use Activities',
        description: 'Allows starting activities in voice channels.',
      },
      {
        key: 'USE_SOUNDBOARD',
        bit: 1n << 42n,
        label: 'Use Soundboard',
        description: 'Allows using the soundboard in voice channels.',
      },
      {
        key: 'USE_EXTERNAL_SOUNDS',
        bit: 1n << 45n,
        label: 'Use External Sounds',
        description: 'Allows playing soundboard sounds from other servers.',
      },
      {
        key: 'USE_VAD',
        bit: 1n << 25n,
        label: 'Use Voice Activity',
        description: 'Allows speaking via voice activity (otherwise push-to-talk).',
      },
      {
        key: 'PRIORITY_SPEAKER',
        bit: 1n << 8n,
        label: 'Priority Speaker',
        description: 'Reduces the volume of others when this role speaks.',
      },
      {
        key: 'MUTE_MEMBERS',
        bit: 1n << 22n,
        label: 'Mute Members',
        description: 'Allows muting members in voice channels.',
      },
      {
        key: 'DEAFEN_MEMBERS',
        bit: 1n << 23n,
        label: 'Deafen Members',
        description: 'Allows deafening members in voice channels.',
      },
      {
        key: 'MOVE_MEMBERS',
        bit: 1n << 24n,
        label: 'Move Members',
        description: 'Allows moving members between voice channels.',
      },
    ],
  },
  {
    key: 'stage',
    label: 'Stage Channel Permissions',
    permissions: [
      {
        key: 'REQUEST_TO_SPEAK',
        bit: 1n << 32n,
        label: 'Request to Speak',
        description: 'Allows requesting to speak in stage channels.',
      },
    ],
  },
  {
    key: 'events',
    label: 'Events Permissions',
    permissions: [
      {
        key: 'CREATE_EVENTS',
        bit: 1n << 44n,
        label: 'Create Events',
        description: 'Allows creating events.',
      },
      {
        key: 'MANAGE_EVENTS',
        bit: 1n << 33n,
        label: 'Manage Events',
        description: 'Allows editing and canceling events.',
      },
    ],
  },
  {
    key: 'advanced',
    label: 'Advanced Permissions',
    permissions: [
      {
        key: 'ADMINISTRATOR',
        bit: 1n << 3n,
        label: 'Administrator',
        description:
          'Grants every permission and bypasses channel overwrites. Treat as a god mode — assign with caution.',
        danger: 'high',
      },
    ],
  },
]

// Flat lookup by key — cheap fast path for the editor and presets.
export const PERMISSION_BY_KEY: Map<string, PermissionDef> = new Map(
  PERMISSION_CATEGORIES.flatMap((c) => c.permissions.map((p) => [p.key, p])),
)

export const ALL_PERMISSIONS: PermissionDef[] = PERMISSION_CATEGORIES.flatMap(
  (c) => c.permissions,
)

/** Sum of every catalog bit — used to mask out unknown future bits before saving. */
export const ALL_PERMISSION_BITS: bigint = ALL_PERMISSIONS.reduce(
  (acc, p) => acc | p.bit,
  0n,
)

export function hasPermission(permissions: string, key: string): boolean {
  const def = PERMISSION_BY_KEY.get(key)
  if (!def) return false
  return (BigInt(permissions) & def.bit) !== 0n
}

export function permissionKeysFromBits(permissions: string): string[] {
  const bits = BigInt(permissions)
  return ALL_PERMISSIONS.filter((p) => (bits & p.bit) !== 0n).map((p) => p.key)
}

export function bitsFromPermissionKeys(keys: Iterable<string>): string {
  let bits = 0n
  for (const k of keys) {
    const def = PERMISSION_BY_KEY.get(k)
    if (def) bits |= def.bit
  }
  return bits.toString()
}

export function dangerousKeysIn(keys: Iterable<string>): PermissionDef[] {
  const set = new Set(keys)
  return ALL_PERMISSIONS.filter((p) => p.danger && set.has(p.key))
}

// Default presets seeded into a guild's preset table on first read. These
// follow Discord's own templates and are starting points — admins customize
// them after seeding.
export type PresetSeed = {
  key: string
  name: string
  description: string
  permissionKeys: string[]
}

export const DEFAULT_PRESET_SEEDS: PresetSeed[] = [
  {
    key: 'admin',
    name: 'Admin',
    description: 'Full server control. Grants Administrator.',
    permissionKeys: ['ADMINISTRATOR'],
  },
  {
    key: 'moderator',
    name: 'Moderator',
    description: 'Day-to-day moderation: kick, ban, timeout, manage messages, manage nicknames.',
    permissionKeys: [
      'KICK_MEMBERS',
      'BAN_MEMBERS',
      'MODERATE_MEMBERS',
      'MANAGE_NICKNAMES',
      'MANAGE_MESSAGES',
      'MANAGE_THREADS',
      'VIEW_AUDIT_LOG',
      'MUTE_MEMBERS',
      'DEAFEN_MEMBERS',
      'MOVE_MEMBERS',
      // Plus baseline read/write so they can actually participate.
      'VIEW_CHANNEL',
      'SEND_MESSAGES',
      'SEND_MESSAGES_IN_THREADS',
      'EMBED_LINKS',
      'ATTACH_FILES',
      'ADD_REACTIONS',
      'READ_MESSAGE_HISTORY',
      'CONNECT',
      'SPEAK',
      'USE_VAD',
      'CHANGE_NICKNAME',
    ],
  },
  {
    key: 'member',
    name: 'Member',
    description: 'Standard server access: chat, react, attach, join voice.',
    permissionKeys: [
      'VIEW_CHANNEL',
      'SEND_MESSAGES',
      'SEND_MESSAGES_IN_THREADS',
      'CREATE_PUBLIC_THREADS',
      'EMBED_LINKS',
      'ATTACH_FILES',
      'ADD_REACTIONS',
      'READ_MESSAGE_HISTORY',
      'USE_EXTERNAL_EMOJIS',
      'USE_EXTERNAL_STICKERS',
      'USE_APPLICATION_COMMANDS',
      'CONNECT',
      'SPEAK',
      'STREAM',
      'USE_VAD',
      'USE_SOUNDBOARD',
      'CHANGE_NICKNAME',
      'CREATE_INSTANT_INVITE',
      'SEND_POLLS',
    ],
  },
  {
    key: 'verified',
    name: 'Verified',
    description: 'Trusted member tier: standard access plus reactions and external content.',
    permissionKeys: [
      'VIEW_CHANNEL',
      'SEND_MESSAGES',
      'SEND_MESSAGES_IN_THREADS',
      'CREATE_PUBLIC_THREADS',
      'CREATE_PRIVATE_THREADS',
      'EMBED_LINKS',
      'ATTACH_FILES',
      'ADD_REACTIONS',
      'READ_MESSAGE_HISTORY',
      'USE_EXTERNAL_EMOJIS',
      'USE_EXTERNAL_STICKERS',
      'USE_APPLICATION_COMMANDS',
      'CONNECT',
      'SPEAK',
      'STREAM',
      'USE_VAD',
      'USE_SOUNDBOARD',
      'CHANGE_NICKNAME',
      'CREATE_INSTANT_INVITE',
      'SEND_POLLS',
      'SEND_VOICE_MESSAGES',
    ],
  },
  {
    key: 'bot',
    name: 'Bot',
    description: 'Common permissions a moderation/utility bot needs.',
    permissionKeys: [
      'VIEW_CHANNEL',
      'SEND_MESSAGES',
      'SEND_MESSAGES_IN_THREADS',
      'EMBED_LINKS',
      'ATTACH_FILES',
      'READ_MESSAGE_HISTORY',
      'MANAGE_MESSAGES',
      'MANAGE_THREADS',
      'ADD_REACTIONS',
      'USE_EXTERNAL_EMOJIS',
      'USE_APPLICATION_COMMANDS',
      'KICK_MEMBERS',
      'BAN_MEMBERS',
      'MODERATE_MEMBERS',
      'MANAGE_NICKNAMES',
      'VIEW_AUDIT_LOG',
      'CONNECT',
      'SPEAK',
    ],
  },
]
