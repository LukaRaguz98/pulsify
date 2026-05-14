require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  Events,
} = require('discord.js');

const { createClient } = require('@supabase/supabase-js');
const { createAnalytics } = require('./analytics');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const analytics = createAnalytics(supabase);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});

const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check if Pulse bot is online'),

  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Show server statistics'),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) =>
      o.setName('user').setDescription('The user to warn').setRequired(true)
    )
    .addStringOption((o) =>
      o.setName('reason').setDescription('Reason for the warning').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('View warnings for a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) =>
      o.setName('user').setDescription('The user to check').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('clearwarnings')
    .setDescription('Clear all warnings for a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) =>
      o.setName('user').setDescription('The user to clear warnings for').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('sync')
    .setDescription('Sync this server\'s data to the Pulse dashboard')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map((c) => c.toJSON());

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`[Pulse] Logged in as ${readyClient.user.tag}`);

  readyClient.user.setPresence({
    activities: [{ name: 'Powered by Pulsify' }],
    status: 'online',
  });

  const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);
  await rest.put(Routes.applicationCommands(readyClient.user.id), { body: commands });
  console.log('[Pulse] Slash commands registered.');

  for (const guild of readyClient.guilds.cache.values()) {
    await syncGuild(guild);

    // Seed analytics with members already connected to voice channels.
    for (const vs of guild.voiceStates.cache.values()) {
      if (vs.channelId && !vs.member?.user?.bot) {
        analytics.voiceJoin(
          guild.id,
          vs.id,
          vs.member?.user?.username,
          vs.channelId,
          vs.channel?.name
        );
      }
    }
  }

  // Remove stale synced_guilds entries for servers the bot is no longer in
  const currentIds = [...readyClient.guilds.cache.keys()];
  const { data: stored } = await supabase.from('synced_guilds').select('guild_id');
  const stale = (stored ?? []).filter((r) => !currentIds.includes(r.guild_id));
  if (stale.length > 0) {
    await supabase
      .from('synced_guilds')
      .delete()
      .in('guild_id', stale.map((r) => r.guild_id));
    console.log(`[Pulse] Removed ${stale.length} stale guild(s) from synced_guilds.`);
  }
});

client.on(Events.GuildCreate, async (guild) => {
  console.log(`[Pulse] Joined guild: ${guild.name}`);
  await syncGuild(guild);
});

client.on(Events.GuildDelete, async (guild) => {
  console.log(`[Pulse] Left/kicked from guild: ${guild.name} (${guild.id})`);
  await supabase.from('synced_guilds').delete().eq('guild_id', guild.id);
});

client.on(Events.GuildMemberAdd, async (member) => {
  analytics.track({
    type: 'member_join',
    guildId: member.guild.id,
    userId: member.id,
    userName: member.user.username,
  });

  const settings = await getGuildSettings(member.guild.id);

  if (settings?.welcome?.enabled && settings.welcome.channel_id) {
    try {
      const channel = await member.guild.channels.fetch(settings.welcome.channel_id);
      if (channel?.isTextBased()) {
        const resolve = (text) =>
          text.replace(/\{user\}/g, member.toString()).replace(/\{server\}/g, member.guild.name);

        if (settings.welcome.type === 'embed' && settings.welcome.embed) {
          const cfg = settings.welcome.embed;
          const colorInt = parseInt((cfg.color ?? '#6366f1').replace('#', ''), 16);
          const embed = new EmbedBuilder()
            .setColor(isNaN(colorInt) ? 0x6366f1 : colorInt)
            .setTitle(resolve(cfg.title ?? 'Welcome!'))
            .setDescription(resolve(cfg.description ?? ''));

          if (Array.isArray(cfg.fields) && cfg.fields.length > 0) {
            embed.addFields(cfg.fields.map((f) => ({
              name: f.name,
              value: f.value,
              inline: f.inline ?? true,
            })));
          }

          if (cfg.footer_text) {
            embed.setFooter({ text: resolve(cfg.footer_text) });
          }

          if (cfg.banner_color) {
            // Bot fetches banner from the web app and sends it as a Discord attachment.
            // This works in both local dev (same machine) and production.
            const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
            const bannerFetchUrl = `${appUrl}/api/banner?name=${encodeURIComponent(member.guild.name)}&color=${cfg.banner_color}`;
            embed.setImage('attachment://banner.png');
            await channel.send({
              embeds: [embed],
              files: [{ attachment: bannerFetchUrl, name: 'banner.png' }],
            });
          } else {
            await channel.send({ embeds: [embed] });
          }
        } else {
          const msg = resolve(settings.welcome.message ?? 'Welcome to {server}, {user}!');
          await channel.send(msg);
        }
      }
    } catch (err) {
      console.error(`[Pulse] Welcome message failed in guild ${member.guild.id}:`, err.message);
    }
  }

  if (settings?.auto_role?.enabled && settings.auto_role.role_id) {
    try {
      const role = await member.guild.roles.fetch(settings.auto_role.role_id);
      if (role) {
        await member.roles.add(role);
        console.log(`[Pulse] Auto-role "${role.name}" assigned to ${member.user.tag} in ${member.guild.name}`);
      } else {
        console.warn(`[Pulse] Auto-role not found: ${settings.auto_role.role_id} in guild ${member.guild.id}`);
      }
    } catch (err) {
      console.error(`[Pulse] Auto-role failed for ${member.user.tag} in guild ${member.guild.id}:`, err.message);
    }
  }
});

client.on(Events.GuildMemberRemove, async (member) => {
  console.log(`[Pulse] Member left: ${member.user.tag} from ${member.guild.name}`);

  analytics.track({
    type: 'member_leave',
    guildId: member.guild.id,
    userId: member.id,
    userName: member.user.username,
  });

  const settings = await getGuildSettings(member.guild.id);

  if (settings?.goodbye?.enabled && settings.goodbye.channel_id) {
    try {
      const channel = await member.guild.channels.fetch(settings.goodbye.channel_id);
      if (channel?.isTextBased()) {
        // The member already left, so {user} resolves to their name (a mention would be dead).
        const resolve = (text) =>
          text.replace(/\{user\}/g, member.user.username).replace(/\{server\}/g, member.guild.name);

        if (settings.goodbye.type === 'embed' && settings.goodbye.embed) {
          const cfg = settings.goodbye.embed;
          const colorInt = parseInt((cfg.color ?? '#6366f1').replace('#', ''), 16);
          const embed = new EmbedBuilder()
            .setColor(isNaN(colorInt) ? 0x6366f1 : colorInt)
            .setTitle(resolve(cfg.title ?? 'Goodbye!'))
            .setDescription(resolve(cfg.description ?? ''));

          if (Array.isArray(cfg.fields) && cfg.fields.length > 0) {
            embed.addFields(cfg.fields.map((f) => ({
              name: f.name,
              value: f.value,
              inline: f.inline ?? true,
            })));
          }

          if (cfg.footer_text) {
            embed.setFooter({ text: resolve(cfg.footer_text) });
          }

          if (cfg.banner_color) {
            const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
            const bannerFetchUrl = `${appUrl}/api/banner?name=${encodeURIComponent(member.guild.name)}&color=${cfg.banner_color}`;
            embed.setImage('attachment://banner.png');
            await channel.send({
              embeds: [embed],
              files: [{ attachment: bannerFetchUrl, name: 'banner.png' }],
            });
          } else {
            await channel.send({ embeds: [embed] });
          }
        } else {
          const msg = resolve(settings.goodbye.message ?? '{user} has left {server}.');
          await channel.send(msg);
        }
      }
    } catch (err) {
      console.error(`[Pulse] Goodbye message failed in guild ${member.guild.id}:`, err.message);
    }
  }
});

client.on(Events.GuildBanAdd, async (ban) => {
  analytics.track({
    type: 'mod_action',
    guildId: ban.guild.id,
    userId: ban.user.id,
    userName: ban.user.username,
    metadata: { action: 'ban' },
  });

  const settings = await getGuildSettings(ban.guild.id);
  if (settings?.moderation_alerts?.enabled && settings.moderation_alerts.channel_id) {
    const channel = ban.guild.channels.cache.get(settings.moderation_alerts.channel_id);
    if (channel?.isTextBased()) {
      const embed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle('Member Banned')
        .setDescription(`**${ban.user.tag}** (${ban.user.id}) was banned.`)
        .addFields({ name: 'Reason', value: ban.reason ?? 'No reason provided' })
        .setTimestamp();
      await channel.send({ embeds: [embed] }).catch(console.error);
    }
  }
});

client.on(Events.GuildBanRemove, async (ban) => {
  analytics.track({
    type: 'mod_action',
    guildId: ban.guild.id,
    userId: ban.user.id,
    userName: ban.user.username,
    metadata: { action: 'unban' },
  });

  const settings = await getGuildSettings(ban.guild.id);
  if (settings?.moderation_alerts?.enabled && settings.moderation_alerts.channel_id) {
    const channel = ban.guild.channels.cache.get(settings.moderation_alerts.channel_id);
    if (channel?.isTextBased()) {
      const embed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle('Member Unbanned')
        .setDescription(`**${ban.user.tag}** (${ban.user.id}) was unbanned.`)
        .setTimestamp();
      await channel.send({ embeds: [embed] }).catch(console.error);
    }
  }
});

client.on(Events.MessageCreate, (message) => {
  if (message.author.bot || !message.guild) return;
  analytics.track({
    type: 'message',
    guildId: message.guild.id,
    userId: message.author.id,
    // Server display name (guild nickname → global name → username).
    userName: message.member?.displayName ?? message.author.displayName,
    channelId: message.channelId,
    channelName: message.channel?.name,
  });
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const guildId = newState.guild.id;
  const userId = newState.id;
  const member = newState.member ?? oldState.member;
  if (member?.user?.bot) return;
  const userName = member?.user?.username;

  const left = oldState.channelId && !newState.channelId;
  const joined = !oldState.channelId && newState.channelId;
  const moved =
    oldState.channelId &&
    newState.channelId &&
    oldState.channelId !== newState.channelId;

  if (left) {
    analytics.voiceLeave(guildId, userId);
  } else if (joined) {
    analytics.voiceJoin(guildId, userId, userName, newState.channelId, newState.channel?.name);
  } else if (moved) {
    analytics
      .voiceLeave(guildId, userId)
      .then(() =>
        analytics.voiceJoin(guildId, userId, userName, newState.channelId, newState.channel?.name)
      );
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  analytics.track({
    type: 'command',
    guildId: interaction.guildId,
    userId: interaction.user.id,
    userName: interaction.user.username,
    channelId: interaction.channelId,
    metadata: { command: commandName },
  });

  if (commandName === 'ping') {
    const ws = client.ws.ping;
    await interaction.reply({
      content: `Pong! Pulse is online. Latency: \`${ws}ms\``,
      ephemeral: true,
    });
    return;
  }

  if (commandName === 'stats') {
    await interaction.deferReply();
    const guild = interaction.guild;
    if (!guild) return interaction.editReply('This command can only be used in a server.');

    await guild.members.fetch().catch(() => null);

    const embed = new EmbedBuilder()
      .setColor(0x6366f1)
      .setTitle(`${guild.name} — Server Stats`)
      .setThumbnail(guild.iconURL())
      .addFields(
        { name: 'Members', value: guild.memberCount.toString(), inline: true },
        { name: 'Channels', value: guild.channels.cache.size.toString(), inline: true },
        { name: 'Roles', value: (guild.roles.cache.size - 1).toString(), inline: true },
        { name: 'Boosts', value: guild.premiumSubscriptionCount?.toString() ?? '0', inline: true },
        { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
      )
      .setFooter({ text: 'Pulse · Dashboard at pulsify.app' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (commandName === 'warn') {
    const target = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason', true);
    const guild = interaction.guild;
    if (!guild) return;

    await supabase.from('guild_warnings').insert({
      guild_id: guild.id,
      user_id: target.id,
      username: target.tag,
      moderator_id: interaction.user.id,
      moderator_username: interaction.user.tag,
      reason,
      active: true,
    });

    analytics.track({
      type: 'mod_action',
      guildId: guild.id,
      userId: target.id,
      userName: target.username,
      metadata: { action: 'warn', moderator_id: interaction.user.id },
    });

    const embed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle('Warning Issued')
      .setDescription(`**${target.tag}** has been warned.`)
      .addFields({ name: 'Reason', value: reason })
      .setFooter({ text: `Warned by ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    return;
  }

  if (commandName === 'warnings') {
    const target = interaction.options.getUser('user', true);
    const guild = interaction.guild;
    if (!guild) return;

    const { data: warnings } = await supabase
      .from('guild_warnings')
      .select('*')
      .eq('guild_id', guild.id)
      .eq('user_id', target.id)
      .eq('active', true)
      .order('created_at', { ascending: false });

    if (!warnings?.length) {
      await interaction.reply({ content: `**${target.tag}** has no active warnings.`, ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x6366f1)
      .setTitle(`Warnings for ${target.tag}`)
      .setDescription(
        warnings.map((w, i) => `**${i + 1}.** ${w.reason} — by ${w.moderator_username}`).join('\n')
      )
      .setFooter({ text: `${warnings.length} active warning(s)` });

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (commandName === 'clearwarnings') {
    const target = interaction.options.getUser('user', true);
    const guild = interaction.guild;
    if (!guild) return;

    await supabase
      .from('guild_warnings')
      .update({ active: false })
      .eq('guild_id', guild.id)
      .eq('user_id', target.id);

    analytics.track({
      type: 'mod_action',
      guildId: guild.id,
      userId: target.id,
      userName: target.username,
      metadata: { action: 'clearwarnings', moderator_id: interaction.user.id },
    });

    await interaction.reply({
      content: `All warnings for **${target.tag}** have been cleared.`,
      ephemeral: true,
    });
    return;
  }

  if (commandName === 'sync') {
    await interaction.deferReply({ ephemeral: true });
    const guild = interaction.guild;
    if (!guild) return;
    await syncGuild(guild);
    await interaction.editReply('Server data synced to the Pulse dashboard successfully.');
    return;
  }
});

async function syncGuild(guild) {
  try {
    await guild.members.fetch().catch(() => null);
    await supabase.from('synced_guilds').upsert(
      {
        guild_id: guild.id,
        name: guild.name,
        icon: guild.icon,
        owner_id: guild.ownerId,
        member_count: guild.memberCount,
        synced_at: new Date().toISOString(),
      },
      { onConflict: 'guild_id' }
    );
    console.log(`[Pulse] Synced guild: ${guild.name}`);
  } catch (err) {
    console.error(`[Pulse] Failed to sync guild ${guild.name}:`, err);
  }
}

async function getGuildSettings(guildId) {
  const { data } = await supabase
    .from('guild_settings')
    .select('settings')
    .eq('guild_id', guildId)
    .maybeSingle();
  return data?.settings ?? null;
}

async function shutdown() {
  console.log('[Pulse] Shutting down — flushing analytics...');
  try {
    await analytics.flushAllVoice();
    await analytics.flush();
  } catch (err) {
    console.error('[Pulse] Error during analytics flush on shutdown:', err.message);
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

client.login(process.env.DISCORD_BOT_TOKEN);
