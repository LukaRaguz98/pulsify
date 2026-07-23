// Event commands — bot side (PULSIFY-61).
//
// /event list · /event info · /event create · /event cancel
//
// These drive Discord's NATIVE scheduled events (guild.scheduledEvents), so
// there's no Pulsify table and no module gate — `module: null`. The gateway
// listeners in index.js already surface event create/update/delete in the
// activity feed, but they dedupe against the bot as actor, so a command-created
// event would be skipped there; we record its notification here instead (no
// double, because the gateway skips bot-actored events).
//
// `create` makes an EXTERNAL event (a name + a place + a start), which needs no
// voice channel and covers the common "meetup / stream / game night" case. Voice
// and stage events, and editing, stay in the Discord UI + dashboard.

const {
  MessageFlags,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus,
  PermissionFlagsBits,
} = require("discord.js");
const {
  buildPulseContainer,
  getPulseColor,
  loadPulseIcon,
  replyNotice,
  text,
  divider,
} = require("./commands");
const { recordNotification } = require("./notifications");
const { parseDuration } = require("./moderation");
const { checkLimit } = require("./feature-gate");

const STATUS_LABELS = {
  [GuildScheduledEventStatus.Scheduled]: "Scheduled",
  [GuildScheduledEventStatus.Active]: "Active",
  [GuildScheduledEventStatus.Completed]: "Completed",
  [GuildScheduledEventStatus.Canceled]: "Cancelled",
};

const ENTITY_LABELS = {
  [GuildScheduledEventEntityType.StageInstance]: "Stage",
  [GuildScheduledEventEntityType.Voice]: "Voice",
  [GuildScheduledEventEntityType.External]: "External",
};

// Discord caps a scheduled start comfortably in the future; keep the relative
// form sane. Start must be at least a minute out, at most ~400 days.
const MIN_START_MINUTES = 1;
const MAX_START_MINUTES = 400 * 24 * 60;
const MAX_DURATION_MINUTES = 30 * 24 * 60; // 30 days
const DEFAULT_DURATION_MINUTES = 120;

function createEvents({ client, supabase }) {
  /** Fetch the guild's scheduled events as an array, sorted by start time. */
  async function fetchEvents(guild) {
    const coll = await guild.scheduledEvents.fetch().catch(() => null);
    if (!coll) return [];
    return [...coll.values()].sort(
      (a, b) => (a.scheduledStartTimestamp ?? 0) - (b.scheduledStartTimestamp ?? 0),
    );
  }

  function locationOf(event) {
    if (event.entityType === GuildScheduledEventEntityType.External) {
      return event.entityMetadata?.location ?? "Elsewhere";
    }
    return event.channelId ? `<#${event.channelId}>` : "A channel";
  }

  async function handleList({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : 0 });
    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = await loadPulseIcon("event", colorHex);
    // Upcoming + active only — completed/cancelled drop off the list.
    const events = (await fetchEvents(guild)).filter(
      (e) =>
        e.status === GuildScheduledEventStatus.Scheduled ||
        e.status === GuildScheduledEventStatus.Active,
    );

    const body = [];
    if (events.length === 0) {
      body.push(text("No upcoming events. Create one with `/event create`."));
    } else {
      body.push(text(`${events.length} upcoming event${events.length === 1 ? "" : "s"} in ${guild.name}.`));
      body.push(divider());
      const lines = events.slice(0, 12).map((e) => {
        const start = e.scheduledStartTimestamp ? Math.floor(e.scheduledStartTimestamp / 1000) : null;
        const when = start ? `<t:${start}:F> — <t:${start}:R>` : "time TBD";
        const interested = e.userCount ? ` — ${e.userCount} interested` : "";
        return `**${e.name}** — ${STATUS_LABELS[e.status] ?? "Scheduled"}\n-# ${when} — ${locationOf(e)}${interested}`;
      });
      body.push(text(lines.join("\n\n")));
    }

    await interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components: [
        buildPulseContainer({
          iconUrl: icon ? `attachment://${icon.name}` : null,
          colorHex,
          title: "Events",
          subtitle: guild.name,
          body,
          footer: "Pulse — Server events",
        }),
      ],
      files: icon ? [icon] : [],
    });
  }

  async function handleInfo({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : 0 });
    const id = interaction.options.getString("event", true);
    const event = await guild.scheduledEvents.fetch(id).catch(() => null);
    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = await loadPulseIcon("event", colorHex);

    if (!event) {
      await interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        components: [buildPulseContainer({ colorHex, title: "Events", body: [text("I couldn't find that event.")], footer: "Pulse — Server events" })],
      });
      return;
    }

    const start = event.scheduledStartTimestamp ? Math.floor(event.scheduledStartTimestamp / 1000) : null;
    const end = event.scheduledEndTimestamp ? Math.floor(event.scheduledEndTimestamp / 1000) : null;
    const lines = [
      `**Status** — ${STATUS_LABELS[event.status] ?? "Scheduled"}`,
      `**Where** — ${ENTITY_LABELS[event.entityType] ?? "Event"} — ${locationOf(event)}`,
      start ? `**Starts** — <t:${start}:F> (<t:${start}:R>)` : null,
      end ? `**Ends** — <t:${end}:F>` : null,
      typeof event.userCount === "number" ? `**Interested** — ${event.userCount}` : null,
    ].filter(Boolean);

    const body = [];
    if (event.description) body.push(text(event.description.slice(0, 1500)));
    body.push(body.length ? divider() : text(`**${event.name}**`));
    body.push(text(lines.join("\n")));

    await interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components: [
        buildPulseContainer({
          iconUrl: icon ? `attachment://${icon.name}` : null,
          colorHex,
          title: event.name,
          subtitle: guild.name,
          body,
          footer: "Pulse — Server event",
          actions: event.url
            ? [{ type: 1, components: [{ type: 2, style: 5, label: "Open in Discord", url: event.url }] }]
            : [],
        }),
      ],
      files: icon ? [icon] : [],
    });
  }

  async function handleCreate({ interaction, guild, ephemeral }) {
    // The bot needs Manage Events to create one — check up front for a clear error.
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageEvents)) {
      await replyNotice(interaction, "I need the **Manage Events** permission to create events. Grant it, then try again.");
      return;
    }

    const name = interaction.options.getString("name", true).trim().slice(0, 100);
    const location = interaction.options.getString("location", true).trim().slice(0, 100);
    const startRaw = interaction.options.getString("start", true);
    const durationRaw = interaction.options.getString("duration");
    const description = interaction.options.getString("description")?.trim().slice(0, 1000) || undefined;

    const startMin = parseDuration(startRaw);
    if (!startMin || startMin < MIN_START_MINUTES || startMin > MAX_START_MINUTES) {
      await replyNotice(interaction, "Enter when it starts as a time from now — e.g. `2h`, `1d`, `30m` (up to ~1 year).");
      return;
    }
    const durMin = durationRaw ? parseDuration(durationRaw) : DEFAULT_DURATION_MINUTES;
    if (!durMin || durMin < 1 || durMin > MAX_DURATION_MINUTES) {
      await replyNotice(interaction, "Enter how long it lasts — e.g. `1h`, `2h`, `1d` (up to 30 days).");
      return;
    }

    // Plan limit (PULSIFY-62): concurrent scheduled events, gated on the guild
    // owner's plan — same cap the dashboard shows. Counts upcoming/active events
    // (Discord-native, so we count the live collection, not a table).
    const existing = await fetchEvents(guild);
    const liveEvents = existing.filter(
      (e) =>
        e.status === GuildScheduledEventStatus.Scheduled ||
        e.status === GuildScheduledEventStatus.Active,
    ).length;
    const gate = await checkLimit(supabase, guild, "maxScheduledEvents", liveEvents);
    if (!gate.allowed) {
      await replyNotice(interaction, gate.reason);
      return;
    }

    const startAt = new Date(Date.now() + startMin * 60_000);
    const endAt = new Date(startAt.getTime() + durMin * 60_000);

    let event;
    try {
      event = await guild.scheduledEvents.create({
        name,
        scheduledStartTime: startAt,
        scheduledEndTime: endAt,
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: GuildScheduledEventEntityType.External,
        entityMetadata: { location },
        description,
        reason: `Created via /event by ${interaction.user.tag}`,
      });
    } catch (err) {
      console.warn(`[Pulse] /event create failed in ${guild.id}:`, err.message);
      await replyNotice(interaction, "Sorry — I couldn't create that event. Check my permissions and try again.");
      return;
    }

    // The gateway's GuildScheduledEventCreate skips bot-actored events, so record
    // the activity-feed entry here (no double).
    await recordNotification(supabase, {
      guildId: guild.id,
      type: "event_created",
      title: `"${event.name}" was scheduled`,
      body: `Starts ${startAt.toLocaleString()} — ${location}`,
      link: `/dashboard/${guild.id}/events`,
      actorId: interaction.user.id,
      actorName: interaction.member?.displayName ?? interaction.user.username,
      actorUsername: interaction.user.username,
      targetName: event.name,
      metadata: { event_id: event.id },
    }).catch(() => {});

    const startUnix = Math.floor(startAt.getTime() / 1000);
    await replyNotice(
      interaction,
      `Event **${event.name}** scheduled for <t:${startUnix}:F> (<t:${startUnix}:R>) at ${location}.${event.url ? `\n${event.url}` : ""}`,
      ephemeral,
    );
  }

  async function handleCancel({ interaction, guild, ephemeral }) {
    const id = interaction.options.getString("event", true);
    const event = await guild.scheduledEvents.fetch(id).catch(() => null);
    if (!event) {
      await replyNotice(interaction, "I couldn't find that event in this server.");
      return;
    }
    if (
      event.status === GuildScheduledEventStatus.Completed ||
      event.status === GuildScheduledEventStatus.Canceled
    ) {
      await replyNotice(interaction, "That event is already over.");
      return;
    }
    const name = event.name;
    try {
      await event.delete();
    } catch (err) {
      console.warn(`[Pulse] /event cancel failed in ${guild.id}:`, err.message);
      await replyNotice(interaction, "Sorry — I couldn't cancel that event. Check my permissions and try again.");
      return;
    }

    await recordNotification(supabase, {
      guildId: guild.id,
      type: "event_deleted",
      title: `"${name}" was cancelled`,
      link: `/dashboard/${guild.id}/events`,
      actorId: interaction.user.id,
      actorName: interaction.member?.displayName ?? interaction.user.username,
      actorUsername: interaction.user.username,
      targetName: name,
    }).catch(() => {});

    await replyNotice(interaction, `Cancelled **${name}**.`, ephemeral);
  }

  async function autocompleteEvent({ interaction, guild }) {
    const focused = String(interaction.options.getFocused() ?? "").toLowerCase();
    const events = (await fetchEvents(guild)).filter(
      (e) =>
        e.status === GuildScheduledEventStatus.Scheduled ||
        e.status === GuildScheduledEventStatus.Active,
    );
    const choices = events
      .filter((e) => !focused || e.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((e) => ({ name: e.name.slice(0, 100), value: e.id }));
    await interaction.respond(choices);
  }

  return { handleList, handleInfo, handleCreate, handleCancel, autocompleteEvent };
}

module.exports = { createEvents };
