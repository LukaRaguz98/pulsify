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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
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

  const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);
  await rest.put(Routes.applicationCommands(readyClient.user.id), { body: commands });
  console.log('[Pulse] Slash commands registered.');

  for (const guild of readyClient.guilds.cache.values()) {
    await syncGuild(guild);
  }
});

client.on(Events.GuildCreate, async (guild) => {
  console.log(`[Pulse] Joined guild: ${guild.name}`);
  await syncGuild(guild);
});

client.on(Events.GuildMemberAdd, async (member) => {
  const settings = await getGuildSettings(member.guild.id);

  if (settings?.welcome?.enabled && settings.welcome.channel_id) {
    try {
      const channel = await member.guild.channels.fetch(settings.welcome.channel_id);
      if (channel?.isTextBased()) {
        const msg = (settings.welcome.message ?? 'Welcome to {server}, {user}!')
          .replace('{user}', member.toString())
          .replace('{server}', member.guild.name);
        await channel.send(msg);
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
});

client.on(Events.GuildBanAdd, async (ban) => {
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

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

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

client.login(process.env.DISCORD_BOT_TOKEN);
