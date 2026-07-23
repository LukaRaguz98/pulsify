// Announcement commands — bot side (PULSIFY-61).
//
// /announce · /announcements recent
//
// `/announce` posts a Pulse-branded announcement embed to a channel and records
// it in the `announcements` table (the same table the dashboard's Announcements
// page writes), so it shows up there and in `/announcements recent`. The embed
// matches /changelog's look — the announcement badge beside a `# title` heading.
// No module gate (`module: null`) — announcements have no master switch.

const { MessageFlags } = require("discord.js");
const {
  buildPulseContainer,
  getPulseColor,
  loadPulseIcon,
  replyNotice,
  text,
  divider,
} = require("./commands");

// Mirror of ANNOUNCEMENT_LIMITS in pulsify-web-app/lib/announcements.ts.
const LIMITS = { maxTitle: 200, maxContent: 4000 };

function createAnnouncements({ client, supabase }) {
  async function handleAnnounce({ interaction, guild, ephemeral }) {
    const message = interaction.options.getString("message", true).trim();
    const title = (interaction.options.getString("title") ?? "Announcement").trim() || "Announcement";
    const channel = interaction.options.getChannel("channel") ?? interaction.channel;

    if (!message) {
      await replyNotice(interaction, "Write the announcement message.");
      return;
    }
    if (!channel?.isTextBased?.() || channel.isDMBased?.()) {
      await replyNotice(interaction, "Pick a text channel to post the announcement in.");
      return;
    }
    if (channel.guildId && channel.guildId !== guild.id) {
      await replyNotice(interaction, "That channel isn't in this server.");
      return;
    }

    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = await loadPulseIcon("announcement", colorHex);
    const container = buildPulseContainer({
      iconUrl: icon ? `attachment://${icon.name}` : null,
      colorHex,
      title: title.slice(0, LIMITS.maxTitle),
      body: [text(message.slice(0, LIMITS.maxContent))],
      footer: `Pulse — ${guild.name}`,
    });

    let sent;
    try {
      sent = await channel.send({
        flags: MessageFlags.IsComponentsV2,
        components: [container],
        files: icon ? [icon] : [],
      });
    } catch (err) {
      console.warn(`[Pulse] /announce failed in ${guild.id}:`, err.message);
      await replyNotice(interaction, `I couldn't post in <#${channel.id}> — check I can send messages there, then try again.`);
      return;
    }

    // Record it so it appears on the dashboard + in /announcements recent.
    await supabase
      .from("announcements")
      .insert({
        guild_id: guild.id,
        title: title.slice(0, LIMITS.maxTitle),
        content: message.slice(0, LIMITS.maxContent),
        channel_id: channel.id,
        status: "published",
        message_id: sent.id,
        published_at: new Date().toISOString(),
        author_id: interaction.user.id,
        author_name: interaction.member?.displayName ?? interaction.user.username,
        created_by: interaction.user.id,
      })
      .then(({ error }) => {
        if (error) console.warn("[Pulse] announcement insert failed:", error.message);
      });

    await replyNotice(interaction, `Announcement posted in <#${channel.id}>.`, ephemeral);
  }

  async function handleRecent({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : 0 });
    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = await loadPulseIcon("announcement", colorHex);

    const { data } = await supabase
      .from("announcements")
      .select("title, channel_id, message_id, published_at, author_name")
      .eq("guild_id", guild.id)
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(10);
    const list = data ?? [];

    const body = [];
    if (list.length === 0) {
      body.push(text("No announcements have been posted yet. Post one with `/announce`."));
    } else {
      body.push(text(`The ${list.length} most recent announcement${list.length === 1 ? "" : "s"}.`));
      body.push(divider());
      const lines = list.map((a) => {
        const when = a.published_at ? `<t:${Math.floor(new Date(a.published_at).getTime() / 1000)}:R>` : "";
        const where = a.channel_id ? ` in <#${a.channel_id}>` : "";
        const by = a.author_name ? ` — by ${a.author_name}` : "";
        const jump =
          a.message_id && a.channel_id
            ? ` — [jump](https://discord.com/channels/${guild.id}/${a.channel_id}/${a.message_id})`
            : "";
        return `**${a.title}**\n-# ${when}${where}${by}${jump}`;
      });
      body.push(text(lines.join("\n\n")));
    }

    await interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components: [
        buildPulseContainer({
          iconUrl: icon ? `attachment://${icon.name}` : null,
          colorHex,
          title: "Announcements",
          subtitle: guild.name,
          body,
          footer: "Pulse — Announcements",
        }),
      ],
      files: icon ? [icon] : [],
    });
  }

  return { handleAnnounce, handleRecent };
}

module.exports = { createAnnouncements };
