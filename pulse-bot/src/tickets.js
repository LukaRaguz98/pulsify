// Discord Ticket System (bot side) — PULSIFY-22.
//
// Members open tickets from a panel (button/dropdown) or the /ticket command;
// the bot creates a private channel, posts an opening message with control
// buttons, and records everything in the `tickets` / `ticket_events` tables.
// Staff manage tickets from those buttons OR from the Pulsify dashboard — both
// write the same tables, and this module subscribes to realtime so the bot's
// in-memory caches (config + open-ticket channels) stay fresh.
//
// The ticket TYPE catalog, channel-naming and custom_id scheme MIRROR
// pulsify-web-app/lib/tickets.ts. Keep the two in sync (same as
// commands.js ↔ lib/commands.ts and scheduler.js ↔ lib/automations.ts).

const {
  Events,
  MessageFlags,
  PermissionFlagsBits,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require("discord.js");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { recordNotification } = require("./notifications");

// ── Shared constants (mirror lib/tickets.ts) ────────────────────────────────
const TKT = "tkt";
const AUTO_CLOSE_TICK_MS = 5 * 60 * 1000; // scan for inactivity every 5 minutes
const ACTIVITY_THROTTLE_MS = 60 * 1000; // at most one last_activity write/min/channel
const TICKET_ICON_FILE = "pulse-ticket.png";
let ticketIconLocal; // bundled fallback, cached after first read

// Component-builder shorthands for Components V2 (raw objects — the same shapes
// the dashboard posts, so panels look identical wherever they're sent).
const td = (content) => ({ type: 10, content });
const divider = () => ({ type: 14, divider: true, spacing: 1 });
const button = (style, label, custom_id, emoji) => ({
  type: 2,
  style,
  label,
  custom_id,
  ...(emoji ? { emoji: { name: emoji } } : {}),
});

function hexToInt(hex) {
  const v = parseInt(String(hex || "").replace("#", ""), 16);
  return Number.isNaN(v) ? 0x5865f2 : v;
}

/**
 * Resolve the ticket badge as a Discord attachment: the web app's tint endpoint
 * (recoloured to the panel accent, same pipeline as the /sync icon), falling
 * back to the bundled PNG so the opening embed always has its glyph. Mirrors
 * loadPulseIcon in commands.js.
 */
async function loadTicketIcon(colorHex) {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const hex = String(colorHex || "#5865f2").replace("#", "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`${appUrl}/api/pulse-icon?icon=ticket&color=${hex}`, { signal: controller.signal });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      return { attachment: buf, name: TICKET_ICON_FILE };
    }
  } catch {
    // fall through to the bundled icon
  } finally {
    clearTimeout(timer);
  }
  try {
    if (!ticketIconLocal) ticketIconLocal = await readFile(path.join(__dirname, "..", "resources", "images", TICKET_ICON_FILE));
    return { attachment: ticketIconLocal, name: TICKET_ICON_FILE };
  } catch {
    return null;
  }
}

/** Mirror of lib/tickets.ts formatChannelName. */
function formatChannelName(format, ctx) {
  const raw = String(format || "ticket-{number}")
    .replace(/\{number\}/g, String(ctx.number))
    .replace(/\{user\}/g, ctx.user || "user")
    .replace(/\{type\}/g, ctx.type || "ticket");
  return (
    raw
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 90) || `ticket-${ctx.number}`
  );
}

/** Apply defaults to a raw ticket_configs row. */
function normaliseConfig(row) {
  const panel = row.panel || {};
  const ac = row.auto_close || {};
  return {
    guild_id: row.guild_id,
    enabled: Boolean(row.enabled),
    panel: {
      channel_id: panel.channel_id ?? null,
      title: panel.title ?? "Open a ticket",
      description: panel.description ?? "",
      color: panel.color ?? "#5865f2",
      mode: panel.mode === "dropdown" ? "dropdown" : "buttons",
    },
    ticket_types: Array.isArray(row.ticket_types) ? row.ticket_types : [],
    category_id: row.category_id ?? null,
    support_role_ids: Array.isArray(row.support_role_ids) ? row.support_role_ids : [],
    transcript_channel_id: row.transcript_channel_id ?? null,
    log_channel_id: row.log_channel_id ?? null,
    naming_format: row.naming_format || "ticket-{number}",
    opening_message: row.opening_message ?? null,
    auto_close: {
      enabled: Boolean(ac.enabled),
      inactivity_hours: Number(ac.inactivity_hours) || 48,
      warn_hours: Number(ac.warn_hours) || 0,
    },
    per_user_limit: Number.isFinite(Number(row.per_user_limit)) ? Number(row.per_user_limit) : 1,
    ping_support: row.ping_support === undefined ? true : Boolean(row.ping_support),
    ticket_counter: Number(row.ticket_counter) || 0,
  };
}

function createTickets(client, supabase) {
  // guild_id -> normalised config
  const configCache = new Map();
  // channel_id -> { ticketId, guildId } for OPEN tickets (message-activity + close)
  const openChannels = new Map();
  // channel_id -> last activity-write timestamp (throttle)
  const activityThrottle = new Map();
  let tickTimer = null;

  // ── V2 helpers (every bot message is a Components V2 container) ──────────────

  /** Guild accent (the colour chosen in ticket settings), as a Discord int. */
  function accentFor(guildId) {
    const cfg = configCache.get(guildId);
    return hexToInt(cfg?.panel?.color);
  }

  /** A Pulse-styled notice container tinted with the guild accent. */
  function noticeContainer(accent, lines, footer = "Ticket update") {
    const clean = (lines || []).filter(Boolean);
    const [first, ...rest] = clean;
    const components = [td("**Pulse**")];
    if (first) components.push(td(first.startsWith("# ") ? first : `### ${first}`));
    for (const line of rest) components.push(td(line));
    components.push(divider(), td(`-# Pulse · ${footer}`));
    return { type: 17, accent_color: accent, components };
  }

  /** Send a V2 notice to a channel (best-effort), tinted with the guild accent. */
  async function sendNotice(channel, guildId, lines, opts = {}) {
    if (!channel?.isTextBased?.()) return;
    await channel
      .send({
        flags: MessageFlags.IsComponentsV2,
        components: [noticeContainer(accentFor(guildId), lines)],
        allowedMentions: opts.allowedMentions ?? { parse: [] },
      })
      .catch(() => {});
  }

  /** Reply to an interaction with a V2 notice (public or ephemeral). */
  function replyNotice(interaction, guildId, lines, { ephemeral = false } = {}) {
    return interaction.reply({
      flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
      components: [noticeContainer(accentFor(guildId), lines)],
    });
  }

  // ── Persistence / cache ────────────────────────────────────────────────────

  async function reload() {
    const { data: configs, error } = await supabase.from("ticket_configs").select("*");
    if (error) {
      console.warn("[Pulse] ticket_configs load failed:", error.message);
    } else {
      configCache.clear();
      for (const row of configs ?? []) configCache.set(row.guild_id, normaliseConfig(row));
    }

    const { data: open } = await supabase
      .from("tickets")
      .select("id, guild_id, channel_id, status")
      .neq("status", "closed");
    openChannels.clear();
    for (const t of open ?? []) {
      if (t.channel_id) openChannels.set(t.channel_id, { ticketId: t.id, guildId: t.guild_id });
    }
    console.log(`[Pulse] Loaded ticket config for ${configCache.size} guild(s), ${openChannels.size} open ticket(s).`);
  }

  function subscribe() {
    supabase
      .channel("ticket-configs")
      .on("postgres_changes", { event: "*", schema: "public", table: "ticket_configs" }, (payload) => {
        if (payload.eventType === "DELETE") {
          if (payload.old?.guild_id) configCache.delete(payload.old.guild_id);
          return;
        }
        if (payload.new) configCache.set(payload.new.guild_id, normaliseConfig(payload.new));
      })
      .subscribe();

    // Keep the open-channel map in step with dashboard-side close/reopen/delete.
    supabase
      .channel("tickets-watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, (payload) => {
        if (payload.eventType === "DELETE") {
          const ch = payload.old?.channel_id;
          if (ch) openChannels.delete(ch);
          return;
        }
        const row = payload.new;
        if (!row?.channel_id) return;
        if (row.status === "closed") openChannels.delete(row.channel_id);
        else openChannels.set(row.channel_id, { ticketId: row.id, guildId: row.guild_id });
      })
      .subscribe();
  }

  async function logEvent(ticketId, guildId, type, actor, detail) {
    try {
      await supabase.from("ticket_events").insert({
        ticket_id: ticketId,
        guild_id: guildId,
        type,
        actor_id: actor?.id ?? null,
        actor_name: actor ? actor.displayName ?? actor.globalName ?? actor.username ?? null : null,
        detail: detail ? String(detail).slice(0, 1000) : null,
      });
    } catch (err) {
      console.warn("[Pulse] ticket_events insert threw:", err.message);
    }
  }

  /** Mirror a lifecycle line into the configured log channel as a V2 notice. */
  async function mirrorToLog(guild, config, line) {
    if (!config.log_channel_id) return;
    try {
      const ch = await guild.channels.fetch(config.log_channel_id).catch(() => null);
      await sendNotice(ch, guild.id, [line.slice(0, 2000)]);
    } catch {
      /* ignore */
    }
  }

  // ── Panels / control rows ────────────────────────────────────────────────────

  // The opening embed of a new ticket: a header Section carrying the (accent-
  // tinted) ticket badge, the opening message, the submitted form answers, a
  // support-role ping line, and the Claim/Close controls.
  function controlContainer(config, ticket, type, answers, supportRoleIds, hasIcon) {
    const accent = hexToInt(type?.color || config.panel.color);
    const opening = (config.opening_message || "A staff member will be with you shortly.")
      .replace(/\{user\}/g, `<@${ticket.opener_id}>`)
      .replace(/\{type\}/g, type?.label || "ticket");

    const headerLines = [td("**Pulse**"), td(`# ${type?.label || "Support ticket"} · #${ticket.number}`), td(`-# ${opening}`)];
    const body = [];
    if (hasIcon) {
      body.push({
        type: 9,
        components: headerLines,
        accessory: { type: 11, media: { url: `attachment://${TICKET_ICON_FILE}` }, description: "Ticket" },
      });
    } else {
      body.push(...headerLines);
    }

    if (config.ping_support && Array.isArray(supportRoleIds) && supportRoleIds.length > 0) {
      body.push(td(`-# ${supportRoleIds.map((r) => `<@&${r}>`).join(" ")}`));
    }
    if (Array.isArray(answers) && answers.length > 0) {
      body.push(divider());
      body.push(td(answers.map((a) => `**${a.label}**\n${a.value || "—"}`).join("\n\n").slice(0, 3500)));
    }
    body.push(divider());
    body.push({
      type: 1,
      components: [
        button(3, "Claim", `${TKT}:claim:${ticket.id}`),
        button(4, "Close", `${TKT}:close:${ticket.id}`),
      ],
    });
    body.push(td("-# Pulse · Support ticket"));
    return { type: 17, accent_color: accent, components: body };
  }

  function closedRow(ticketId) {
    return {
      type: 1,
      components: [
        button(3, "Reopen", `${TKT}:reopen:${ticketId}`),
        button(2, "Transcript", `${TKT}:transcript:${ticketId}`),
        button(4, "Delete", `${TKT}:delete:${ticketId}`),
      ],
    };
  }

  /** Ephemeral type picker used by /ticket (buttons or dropdown). */
  function pickerComponents(config) {
    const enabled = config.ticket_types.filter((t) => t.enabled);
    if (config.panel.mode === "dropdown" || enabled.length > 5) {
      return [
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: `${TKT}:menu`,
              placeholder: "Choose a ticket type…",
              options: enabled.slice(0, 25).map((t) => ({
                label: t.label,
                value: t.id,
                description: t.description ? String(t.description).slice(0, 100) : undefined,
                ...(t.emoji ? { emoji: { name: t.emoji } } : {}),
              })),
            },
          ],
        },
      ];
    }
    return [
      {
        type: 1,
        components: enabled.map((t) => button(2, String(t.label).slice(0, 80), `${TKT}:open:${t.id}`, t.emoji)),
      },
    ];
  }

  // ── Open flow ────────────────────────────────────────────────────────────────

  /** Returns an error string if the member is over their open-ticket limit. */
  async function checkLimit(guild, config, userId) {
    if (!(config.per_user_limit > 0)) return null;
    const { count } = await supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("guild_id", guild.id)
      .eq("opener_id", userId)
      .neq("status", "closed");
    if ((count ?? 0) >= config.per_user_limit) {
      return `You already have ${count} open ticket${count === 1 ? "" : "s"} — please use ${count === 1 ? "it" : "those"} or wait for ${count === 1 ? "it" : "them"} to close.`;
    }
    return null;
  }

  async function handleOpenRequest(interaction, typeId) {
    const guild = interaction.guild;
    if (!guild) return;
    const config = configCache.get(guild.id);
    if (!config || !config.enabled) {
      return interaction.reply({ content: "The ticket system isn't enabled here.", flags: MessageFlags.Ephemeral });
    }
    const type = config.ticket_types.find((t) => t.id === typeId && t.enabled);
    if (!type) {
      return interaction.reply({ content: "That ticket type is no longer available.", flags: MessageFlags.Ephemeral });
    }

    // If the type asks questions, show the modal IMMEDIATELY (the interaction
    // must be acknowledged within ~3s, so no DB call can come first). The
    // per-user limit is enforced after submit (handleModalSubmit). For
    // form-less types we deferReply first, then check the limit, then open.
    if (Array.isArray(type.form) && type.form.length > 0) {
      const modal = new ModalBuilder().setCustomId(`${TKT}:form:${type.id}`).setTitle(`${type.label}`.slice(0, 45));
      for (const f of type.form.slice(0, 5)) {
        const input = new TextInputBuilder()
          .setCustomId(f.id)
          .setLabel(String(f.label).slice(0, 45))
          .setStyle(f.style === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setRequired(f.required !== false);
        if (f.placeholder) input.setPlaceholder(String(f.placeholder).slice(0, 100));
        if (f.max_length) input.setMaxLength(Math.min(4000, Number(f.max_length)));
        modal.addComponents(new ActionRowBuilder().addComponents(input));
      }
      return interaction.showModal(modal);
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const limitMsg = await checkLimit(guild, config, interaction.user.id);
    if (limitMsg) return interaction.editReply({ content: limitMsg });
    await createTicket(interaction, config, type, []);
  }

  async function handleModalSubmit(interaction, typeId) {
    const guild = interaction.guild;
    const config = configCache.get(guild?.id);
    if (!config) return interaction.reply({ content: "Tickets aren't configured here.", flags: MessageFlags.Ephemeral });
    const type = config.ticket_types.find((t) => t.id === typeId);
    if (!type) return interaction.reply({ content: "That ticket type no longer exists.", flags: MessageFlags.Ephemeral });

    const answers = (type.form || []).map((f) => ({
      label: f.label,
      value: (interaction.fields.getTextInputValue(f.id) || "").slice(0, 1024),
    }));
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const limitMsg = await checkLimit(guild, config, interaction.user.id);
    if (limitMsg) return interaction.editReply({ content: limitMsg });
    await createTicket(interaction, config, type, answers);
  }

  async function createTicket(interaction, config, type, answers) {
    const guild = interaction.guild;
    const opener = interaction.user;
    try {
      // Reserve the next ticket number (read-modify-write on the cached counter).
      const number = (config.ticket_counter || 0) + 1;
      config.ticket_counter = number;
      await supabase.from("ticket_configs").update({ ticket_counter: number }).eq("guild_id", guild.id);

      const parentId = type.category_id || config.category_id || null;
      const supportRoleIds = [...new Set([...(config.support_role_ids || []), ...(type.support_role_ids || [])])];

      const overwrites = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: opener.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
          ],
        },
        {
          id: client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageMessages,
          ],
        },
      ];
      for (const rid of supportRoleIds) {
        if (guild.roles.cache.has(rid)) {
          overwrites.push({
            id: rid,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.EmbedLinks,
            ],
          });
        }
      }

      const name = formatChannelName(config.naming_format, {
        number,
        user: opener.username,
        type: type.id,
      });

      const channel = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: parentId && guild.channels.cache.get(parentId)?.type === ChannelType.GuildCategory ? parentId : undefined,
        topic: `Ticket #${number} · ${type.label} · opened by ${opener.tag}`.slice(0, 1024),
        permissionOverwrites: overwrites,
      });

      // Persist the ticket.
      const subject = answers[0]?.value ? String(answers[0].value).slice(0, 120) : null;
      const { data: inserted, error } = await supabase
        .from("tickets")
        .insert({
          guild_id: guild.id,
          number,
          channel_id: channel.id,
          type_id: type.id,
          type_label: type.label,
          subject,
          status: "open",
          priority: "normal",
          opener_id: opener.id,
          opener_name: interaction.member?.displayName ?? opener.globalName ?? opener.username,
          form_answers: answers,
          last_activity_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      const ticket = { id: inserted.id, number, opener_id: opener.id };
      openChannels.set(channel.id, { ticketId: ticket.id, guildId: guild.id });
      await logEvent(ticket.id, guild.id, "opened", interaction.member ?? opener, type.label);

      // One V2 message carries the opening embed (with the accent-tinted ticket
      // badge) AND the pings — the opener is mentioned in the opening text and
      // support roles in the ping line, with allowed_mentions set so both fire.
      const icon = await loadTicketIcon(type.color || config.panel.color);
      await channel
        .send({
          flags: MessageFlags.IsComponentsV2,
          components: [controlContainer(config, { ...ticket, opener_id: opener.id }, type, answers, supportRoleIds, !!icon)],
          files: icon ? [icon] : [],
          allowedMentions: { users: [opener.id], roles: config.ping_support ? supportRoleIds : [] },
        })
        .catch((e) => console.warn("[Pulse] ticket panel send failed:", e.message));

      await mirrorToLog(guild, config, `Ticket #${number} (${type.label}) opened by ${opener.tag} → <#${channel.id}>`);
      await recordNotification(supabase, {
        guildId: guild.id,
        type: "ticket_opened",
        title: `New ${type.label} ticket #${number}`,
        body: subject ?? null,
        link: `/dashboard/${guild.id}/tickets`,
        actorId: opener.id,
        actorName: interaction.member?.displayName ?? opener.username,
        actorUsername: opener.username,
        targetId: channel.id,
        metadata: { ticket_id: ticket.id, type: type.id },
      });

      await interaction.editReply({ content: `✅ Your ticket has been created: <#${channel.id}>` });
    } catch (err) {
      console.error(`[Pulse] Failed to open ticket in guild ${guild.id}:`, err.message);
      const msg = "Sorry — I couldn't create your ticket. The server may be missing the **Manage Channels** permission.";
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content: msg }).catch(() => {});
      else await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }

  // ── Claim / close / reopen / delete / transcript ────────────────────────────

  async function loadTicket(ticketId) {
    const { data } = await supabase.from("tickets").select("*").eq("id", ticketId).maybeSingle();
    return data ?? null;
  }

  async function handleClaim(interaction, ticketId) {
    const ticket = await loadTicket(ticketId);
    if (!ticket) return interaction.reply({ content: "This ticket no longer exists.", flags: MessageFlags.Ephemeral });
    if (ticket.status === "closed") return interaction.reply({ content: "This ticket is closed.", flags: MessageFlags.Ephemeral });
    const name = interaction.member?.displayName ?? interaction.user.username;
    await supabase
      .from("tickets")
      .update({ claimed_by: interaction.user.id, claimed_by_name: name, status: "claimed", updated_at: new Date().toISOString() })
      .eq("id", ticketId);
    await logEvent(ticketId, ticket.guild_id, "claimed", interaction.member ?? interaction.user);
    await replyNotice(interaction, ticket.guild_id, [`**${name}** claimed this ticket.`]);
  }

  async function promptClose(interaction, ticketId) {
    const modal = new ModalBuilder().setCustomId(`${TKT}:closemodal:${ticketId}`).setTitle("Close ticket");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Reason (optional)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(500),
      ),
    );
    await interaction.showModal(modal);
  }

  async function doClose(interaction, ticketId, reason) {
    const ticket = await loadTicket(ticketId);
    if (!ticket) return interaction.reply({ content: "This ticket no longer exists.", flags: MessageFlags.Ephemeral });
    if (ticket.status === "closed") return interaction.reply({ content: "This ticket is already closed.", flags: MessageFlags.Ephemeral });
    const guild = interaction.guild ?? client.guilds.cache.get(ticket.guild_id);
    const config = configCache.get(ticket.guild_id);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const closerName = interaction.member?.displayName ?? interaction.user.username;
    let channel = null;
    let transcript = ticket.transcript;
    if (ticket.channel_id && guild) {
      channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
      if (channel) transcript = await buildTranscript(channel, ticket);
    }

    await supabase
      .from("tickets")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        closed_by: interaction.user.id,
        closed_by_name: closerName,
        close_reason: reason || null,
        transcript,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ticketId);
    openChannels.delete(ticket.channel_id);
    await logEvent(ticketId, ticket.guild_id, "closed", interaction.member ?? interaction.user, reason || null);

    if (channel) {
      // Lock the opener out of posting but keep the channel readable.
      await channel.permissionOverwrites
        .edit(ticket.opener_id, { SendMessages: false })
        .catch(() => {});
      await channel
        .send({
          flags: MessageFlags.IsComponentsV2,
          components: [
            {
              type: 17,
              accent_color: accentFor(ticket.guild_id),
              components: [
                td("**Pulse**"),
                td("# Ticket closed"),
                td(`-# Closed by **${closerName}**${reason ? ` — ${reason}` : ""}.`),
                divider(),
                closedRow(ticketId),
                td("-# Pulse · Ticket"),
              ],
            },
          ],
        })
        .catch(() => {});
    }

    if (config) {
      if (config.transcript_channel_id && guild) {
        const tch = await guild.channels.fetch(config.transcript_channel_id).catch(() => null);
        if (tch?.isTextBased() && transcript) {
          await tch
            .send({
              flags: MessageFlags.IsComponentsV2,
              components: [
                noticeContainer(accentFor(ticket.guild_id), [
                  `**Transcript — Ticket #${ticket.number}** (${ticket.type_label ?? "ticket"})`,
                  `Closed by ${closerName}.`,
                ]),
              ],
              files: [{ attachment: Buffer.from(transcript, "utf8"), name: `ticket-${ticket.number}.txt` }],
              allowedMentions: { parse: [] },
            })
            .catch(() => {});
        }
      }
      await mirrorToLog(guild, config, `Ticket #${ticket.number} closed by ${interaction.user.tag}${reason ? ` — ${reason}` : ""}.`);
    }

    await recordNotification(supabase, {
      guildId: ticket.guild_id,
      type: "ticket_closed",
      title: `Ticket #${ticket.number} closed`,
      body: reason || null,
      link: `/dashboard/${ticket.guild_id}/tickets`,
      actorId: interaction.user.id,
      actorName: closerName,
      actorUsername: interaction.user.username,
      metadata: { ticket_id: ticketId },
    });
    await interaction.editReply({ content: "🔒 Ticket closed." }).catch(() => {});
  }

  async function handleReopen(interaction, ticketId) {
    const ticket = await loadTicket(ticketId);
    if (!ticket) return interaction.reply({ content: "This ticket no longer exists.", flags: MessageFlags.Ephemeral });
    if (ticket.status !== "closed") return interaction.reply({ content: "This ticket is already open.", flags: MessageFlags.Ephemeral });
    const guild = interaction.guild;
    await supabase
      .from("tickets")
      .update({ status: "open", closed_at: null, closed_by: null, closed_by_name: null, close_reason: null, last_activity_at: new Date().toISOString(), inactivity_warned_at: null, updated_at: new Date().toISOString() })
      .eq("id", ticketId);
    if (ticket.channel_id) {
      openChannels.set(ticket.channel_id, { ticketId, guildId: ticket.guild_id });
      const channel = await guild?.channels.fetch(ticket.channel_id).catch(() => null);
      if (channel) await channel.permissionOverwrites.edit(ticket.opener_id, { SendMessages: true }).catch(() => {});
    }
    await logEvent(ticketId, ticket.guild_id, "reopened", interaction.member ?? interaction.user);
    await replyNotice(interaction, ticket.guild_id, [
      `Ticket reopened by ${interaction.member?.displayName ?? interaction.user.username}.`,
    ]);
  }

  async function handleDelete(interaction, ticketId) {
    const ticket = await loadTicket(ticketId);
    if (!ticket) return interaction.reply({ content: "This ticket no longer exists.", flags: MessageFlags.Ephemeral });
    await interaction.reply({ content: "🗑️ Deleting this ticket…", flags: MessageFlags.Ephemeral }).catch(() => {});
    if (ticket.channel_id) openChannels.delete(ticket.channel_id);
    await supabase.from("ticket_events").delete().eq("ticket_id", ticketId);
    await supabase.from("tickets").delete().eq("id", ticketId);
    if (ticket.channel_id && interaction.guild) {
      const channel = await interaction.guild.channels.fetch(ticket.channel_id).catch(() => null);
      if (channel) await channel.delete(`Ticket #${ticket.number} deleted by ${interaction.user.tag}`).catch(() => {});
    }
  }

  async function handleTranscriptButton(interaction, ticketId) {
    const ticket = await loadTicket(ticketId);
    if (!ticket) return interaction.reply({ content: "This ticket no longer exists.", flags: MessageFlags.Ephemeral });
    let transcript = ticket.transcript;
    if (!transcript && ticket.channel_id && interaction.guild) {
      const channel = await interaction.guild.channels.fetch(ticket.channel_id).catch(() => null);
      if (channel) transcript = await buildTranscript(channel, ticket);
    }
    if (!transcript) return interaction.reply({ content: "No transcript is available yet.", flags: MessageFlags.Ephemeral });
    await interaction.reply({
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      components: [noticeContainer(accentFor(ticket.guild_id), [`**Transcript — Ticket #${ticket.number}**`])],
      files: [{ attachment: Buffer.from(transcript, "utf8"), name: `ticket-${ticket.number}.txt` }],
    });
  }

  async function buildTranscript(channel, ticket) {
    try {
      const collected = await channel.messages.fetch({ limit: 100 }).catch(() => null);
      const header =
        `Transcript — Ticket #${ticket.number} (${ticket.type_label ?? "Ticket"})\n` +
        `Opened by ${ticket.opener_name ?? ticket.opener_id} on ${new Date(ticket.opened_at).toISOString()}\n` +
        `Generated ${new Date().toISOString()}\n${"-".repeat(48)}\n`;
      if (!collected) return header;
      const lines = [...collected.values()]
        .reverse()
        .map((m) => {
          const ts = new Date(m.createdTimestamp).toISOString().replace("T", " ").slice(0, 19);
          const author = m.member?.displayName ?? m.author.globalName ?? m.author.username;
          const att = m.attachments.size ? " " + [...m.attachments.values()].map((a) => `[file: ${a.name}]`).join(" ") : "";
          return `[${ts}] ${author}: ${m.content || ""}${att}`.trim();
        });
      return header + lines.join("\n");
    } catch {
      return ticket.transcript ?? "";
    }
  }

  // ── /ticket command entry point (called from commands.js via context) ────────

  async function handleTicketCommand(interaction) {
    const config = configCache.get(interaction.guild?.id);
    if (!config || !config.enabled) {
      return interaction.reply({ content: "The ticket system isn't enabled on this server yet.", flags: MessageFlags.Ephemeral });
    }
    const enabled = config.ticket_types.filter((t) => t.enabled);
    if (enabled.length === 0) {
      return interaction.reply({ content: "No ticket types are available right now.", flags: MessageFlags.Ephemeral });
    }
    await interaction.reply({
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      components: [
        {
          type: 17,
          accent_color: hexToInt(config.panel.color),
          components: [
            td("**Pulse**"),
            td("# Open a ticket"),
            td("-# Pick what you need help with."),
            divider(),
            ...pickerComponents(config),
            td("-# Pulse · Ticket panel"),
          ],
        },
      ],
    });
  }

  // ── Interaction routing (our own listener; index.js handles chat-input) ──────

  async function onInteraction(interaction) {
    try {
      if (interaction.isButton() || interaction.isStringSelectMenu()) {
        const id = interaction.customId;
        if (!id.startsWith(`${TKT}:`)) return;
        const [, action, arg] = id.split(":");
        if (action === "menu") return handleOpenRequest(interaction, interaction.values[0]);
        if (action === "open") return handleOpenRequest(interaction, arg);
        if (action === "claim") return handleClaim(interaction, arg);
        if (action === "close") return promptClose(interaction, arg);
        if (action === "reopen") return handleReopen(interaction, arg);
        if (action === "delete") return handleDelete(interaction, arg);
        if (action === "transcript") return handleTranscriptButton(interaction, arg);
        return;
      }
      if (interaction.isModalSubmit()) {
        const id = interaction.customId;
        if (id.startsWith(`${TKT}:form:`)) return handleModalSubmit(interaction, id.slice(`${TKT}:form:`.length));
        if (id.startsWith(`${TKT}:closemodal:`)) {
          const ticketId = id.slice(`${TKT}:closemodal:`.length);
          const reason = (interaction.fields.getTextInputValue("reason") || "").trim();
          return doClose(interaction, ticketId, reason);
        }
      }
    } catch (err) {
      console.error("[Pulse] Ticket interaction failed:", err.message);
      if (interaction && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Something went wrong handling that.", flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  }

  // Bump last_activity_at when someone talks in an open ticket (throttled).
  function onMessage(message) {
    if (message.author?.bot || !message.guild) return;
    const entry = openChannels.get(message.channelId);
    if (!entry) return;
    const now = Date.now();
    const last = activityThrottle.get(message.channelId) ?? 0;
    if (now - last < ACTIVITY_THROTTLE_MS) return;
    activityThrottle.set(message.channelId, now);
    void supabase
      .from("tickets")
      .update({ last_activity_at: new Date().toISOString(), inactivity_warned_at: null })
      .eq("id", entry.ticketId)
      .then(() => {});
  }

  // ── Auto-close inactivity scan ───────────────────────────────────────────────

  async function autoCloseTick() {
    const { data: open } = await supabase
      .from("tickets")
      .select("id, guild_id, channel_id, number, type_label, opener_id, opener_name, opened_at, transcript, last_activity_at, inactivity_warned_at, status")
      .neq("status", "closed");
    if (!open || open.length === 0) return;
    const now = Date.now();

    for (const ticket of open) {
      const config = configCache.get(ticket.guild_id);
      if (!config?.auto_close?.enabled) continue;
      const guild = client.guilds.cache.get(ticket.guild_id);
      if (!guild) continue;
      const idleMs = now - new Date(ticket.last_activity_at).getTime();
      const closeMs = config.auto_close.inactivity_hours * 3_600_000;
      const warnMs = (config.auto_close.warn_hours || 0) * 3_600_000;

      if (idleMs >= closeMs) {
        // Synthesize a "closer" = the bot, and reuse doClose via a minimal shim.
        await autoClose(guild, config, ticket);
      } else if (warnMs > 0 && idleMs >= warnMs && !ticket.inactivity_warned_at) {
        await supabase.from("tickets").update({ inactivity_warned_at: new Date().toISOString() }).eq("id", ticket.id);
        if (ticket.channel_id) {
          const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
          if (channel?.isTextBased()) {
            const hrsLeft = Math.max(1, Math.round((closeMs - idleMs) / 3_600_000));
            await sendNotice(
              channel,
              ticket.guild_id,
              [`⏰ <@${ticket.opener_id}> this ticket has been quiet — it will auto-close in about ${hrsLeft}h unless there's a reply.`],
              { allowedMentions: { users: [ticket.opener_id] } },
            );
          }
        }
      }
    }
  }

  // Close a ticket from the scheduler (no interaction). Mirrors doClose's writes.
  async function autoClose(guild, config, ticket) {
    let channel = null;
    let transcript = ticket.transcript;
    if (ticket.channel_id) {
      channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
      if (channel) transcript = await buildTranscript(channel, ticket);
    }
    await supabase
      .from("tickets")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        closed_by_name: "Auto-close",
        close_reason: "Closed automatically due to inactivity.",
        transcript,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ticket.id);
    openChannels.delete(ticket.channel_id);
    await logEvent(ticket.id, ticket.guild_id, "closed", null, "Auto-closed due to inactivity");

    if (channel) {
      await channel.permissionOverwrites.edit(ticket.opener_id, { SendMessages: false }).catch(() => {});
      await channel
        .send({
          flags: MessageFlags.IsComponentsV2,
          components: [
            {
              type: 17,
              accent_color: accentFor(ticket.guild_id),
              components: [
                td("**Pulse**"),
                td("# Ticket auto-closed"),
                td("-# This ticket was closed automatically after a period of inactivity."),
                divider(),
                closedRow(ticket.id),
                td("-# Pulse · Ticket"),
              ],
            },
          ],
        })
        .catch(() => {});
    }
    if (config.transcript_channel_id && transcript) {
      const tch = await guild.channels.fetch(config.transcript_channel_id).catch(() => null);
      if (tch?.isTextBased()) {
        await tch
          .send({
            flags: MessageFlags.IsComponentsV2,
            components: [noticeContainer(accentFor(ticket.guild_id), [`**Transcript — Ticket #${ticket.number}** (auto-closed)`])],
            files: [{ attachment: Buffer.from(transcript, "utf8"), name: `ticket-${ticket.number}.txt` }],
            allowedMentions: { parse: [] },
          })
          .catch(() => {});
      }
    }
    await mirrorToLog(guild, config, `Ticket #${ticket.number} auto-closed after inactivity.`);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  async function start() {
    await reload();
    subscribe();
    client.on(Events.InteractionCreate, onInteraction);
    client.on(Events.MessageCreate, onMessage);
    setTimeout(() => {
      void autoCloseTick();
      tickTimer = setInterval(() => void autoCloseTick(), AUTO_CLOSE_TICK_MS);
      if (tickTimer.unref) tickTimer.unref();
    }, 30_000);
    console.log("[Pulse] Ticket system started.");
  }

  return { start, reload, handleTicketCommand };
}

module.exports = { createTickets, formatChannelName };
