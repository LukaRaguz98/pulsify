// Server Recovery & Backup System (bot side) — PULSIFY-42.
//
// The DASHBOARD owns manual backups + restores; this module is the WRITER of
// SCHEDULED backups. An hourly tick walks every guild, and for each one whose
// `backup_schedules` row is enabled and due, it captures a snapshot (DB config
// + the live role/channel structure from the gateway cache), inserts a
// `server_backups` row, writes a `recovery_logs` audit entry, prunes the guild
// down to its retention count, and arms the next run.
//
// The captured section shapes MIRROR pulsify-web-app/lib/backups.ts and the
// dashboard's captureSections (app/dashboard/[guildId]/backups/actions.ts) — keep
// the three in sync (same discipline as giveaways.js ↔ lib/giveaways.ts).

const {
  MessageFlags,
} = require("discord.js");
const {
  buildPulseContainer,
  getPulseColor,
  loadPulseIcon,
  editNotice,
  text,
  divider,
} = require("./commands");
const { getDashboardUrl } = require("./version");

// Mirror of lib/backups.ts.
const BACKUP_SECTION_KEYS = [
  "roles",
  "channels",
  "automations",
  "moderation",
  "onboarding",
  "pulse_guard",
  "tickets",
  "giveaways",
  "events",
  "announcements",
];
const CURRENT_BACKUP_VERSION = 1;
const LIMITS = { maxRoles: 100, maxChannels: 200, maxBackupsPerGuild: 50 };

const TICK_MS = 60 * 60 * 1000; // check schedules hourly

function sectionKeysPresent(sections) {
  return BACKUP_SECTION_KEYS.filter((k) => {
    const v = sections[k];
    if (v == null) return false;
    if (Array.isArray(v)) return v.length > 0;
    return Object.keys(v).length > 0;
  });
}

function sizeOf(sections) {
  try {
    return Buffer.byteLength(JSON.stringify(sections), "utf8");
  } catch {
    return 0;
  }
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] != null) out[k] = obj[k];
  return out;
}

function computeNextRun(frequency, from = new Date()) {
  const next = new Date(from);
  next.setUTCHours(4, 0, 0, 0);
  if (next <= from) next.setUTCDate(next.getUTCDate() + 1);
  if (frequency === "weekly") next.setUTCDate(next.getUTCDate() + 6);
  return next.toISOString();
}

function createBackups(client, supabase) {
  let tickTimer = null;
  let ticking = false;

  // ── Capture ────────────────────────────────────────────────────────────────
  async function captureSections(guild, keys) {
    const sections = {};

    // Live Discord structure from the gateway cache.
    if (keys.includes("roles")) {
      const roles = [...guild.roles.cache.values()]
        .filter((r) => r.id !== guild.id && !r.managed)
        .sort((a, b) => b.position - a.position)
        .slice(0, LIMITS.maxRoles)
        .map((r) => ({
          name: r.name,
          color: r.color,
          hoist: r.hoist,
          mentionable: r.mentionable,
          permissions: String(r.permissions.bitfield),
          position: r.position,
        }));
      if (roles.length) sections.roles = roles;
    }

    if (keys.includes("channels")) {
      const channels = [...guild.channels.cache.values()]
        .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0))
        .slice(0, LIMITS.maxChannels)
        .map((c) => ({
          name: c.name,
          type: c.type,
          parent: c.parent ? c.parent.name : null,
          position: c.rawPosition ?? 0,
          topic: c.topic ?? null,
          nsfw: c.nsfw ?? undefined,
          rate_limit_per_user: c.rateLimitPerUser ?? undefined,
          bitrate: c.bitrate ?? undefined,
          user_limit: c.userLimit ?? undefined,
          overwrites: c.permissionOverwrites ? c.permissionOverwrites.cache.size : 0,
        }));
      if (channels.length) sections.channels = channels;
    }

    if (keys.includes("events")) {
      try {
        const events = await guild.scheduledEvents.fetch();
        const list = [...events.values()].map((e) => ({
          id: e.id,
          name: e.name,
          description: e.description ?? null,
          scheduled_start_time: e.scheduledStartAt ? e.scheduledStartAt.toISOString() : null,
          scheduled_end_time: e.scheduledEndAt ? e.scheduledEndAt.toISOString() : null,
          entity_type: e.entityType,
          location: e.entityMetadata?.location ?? null,
        }));
        if (list.length) sections.events = list;
      } catch {
        // Missing access / no events — skip the section.
      }
    }

    // DB-backed config sections.
    const needsSettings = keys.some((k) => ["automations", "moderation", "onboarding"].includes(k));
    const [settingsRes, aiRes, ticketRes, giveawayRes, announcementRes] = await Promise.all([
      needsSettings
        ? supabase.from("guild_settings").select("settings").eq("guild_id", guild.id).maybeSingle()
        : Promise.resolve({ data: null }),
      keys.includes("pulse_guard")
        ? supabase
            .from("ai_moderation_settings")
            .select("enabled, sensitivity, settings")
            .eq("guild_id", guild.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      keys.includes("tickets")
        ? supabase.from("ticket_configs").select("*").eq("guild_id", guild.id).maybeSingle()
        : Promise.resolve({ data: null }),
      keys.includes("giveaways")
        ? supabase
            .from("giveaways")
            .select("id, title, prize, description, winner_count, status, requirements, starts_at, ends_at, channel_id")
            .eq("guild_id", guild.id)
            .in("status", ["scheduled", "active"])
        : Promise.resolve({ data: null }),
      keys.includes("announcements")
        ? supabase
            .from("announcements")
            .select("id, title, content, channel_id, status, scheduled_for")
            .eq("guild_id", guild.id)
        : Promise.resolve({ data: null }),
    ]);

    const settings = settingsRes?.data?.settings ?? {};
    if (keys.includes("automations")) {
      const v = pick(settings, ["welcome", "goodbye", "auto_role"]);
      if (Object.keys(v).length) sections.automations = v;
    }
    if (keys.includes("moderation")) {
      const v = pick(settings, ["moderation_alerts"]);
      if (Object.keys(v).length) sections.moderation = v;
    }
    if (keys.includes("onboarding")) {
      const v = pick(settings, ["onboarding", "member_onboarding"]);
      if (Object.keys(v).length) sections.onboarding = v;
    }
    if (keys.includes("pulse_guard") && aiRes?.data) {
      sections.pulse_guard = {
        enabled: aiRes.data.enabled ?? false,
        sensitivity: aiRes.data.sensitivity ?? "medium",
        settings: aiRes.data.settings ?? {},
      };
    }
    if (keys.includes("tickets") && ticketRes?.data) {
      const t = ticketRes.data;
      sections.tickets = {
        enabled: t.enabled ?? false,
        panel: t.panel ?? {},
        ticket_types: t.ticket_types ?? [],
        support_role_ids: t.support_role_ids ?? [],
        naming_format: t.naming_format ?? "ticket-{number}",
        opening_message: t.opening_message ?? null,
        auto_close: t.auto_close ?? {},
        per_user_limit: t.per_user_limit ?? 1,
        ping_support: t.ping_support ?? true,
      };
    }
    if (keys.includes("giveaways") && giveawayRes?.data?.length) sections.giveaways = giveawayRes.data;
    if (keys.includes("announcements") && announcementRes?.data?.length)
      sections.announcements = announcementRes.data;

    return sections;
  }

  async function nextVersion(guildId) {
    const { data } = await supabase
      .from("server_backups")
      .select("version")
      .eq("guild_id", guildId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (Number(data?.version ?? 0) || 0) + 1;
  }

  // Keep the N most recent SCHEDULED backups of this frequency, plus the hard
  // per-guild cap across everything. Manual backups are never auto-pruned.
  async function prune(guildId, type, retention) {
    // Per-frequency retention.
    const { data: sameType } = await supabase
      .from("server_backups")
      .select("id")
      .eq("guild_id", guildId)
      .eq("type", type)
      .order("created_at", { ascending: false });
    const overflow = (sameType ?? []).slice(retention).map((r) => r.id);

    // Hard cap across all types (oldest first).
    const { data: all } = await supabase
      .from("server_backups")
      .select("id")
      .eq("guild_id", guildId)
      .order("created_at", { ascending: false });
    const capOverflow = (all ?? []).slice(LIMITS.maxBackupsPerGuild).map((r) => r.id);

    const toDelete = [...new Set([...overflow, ...capOverflow])];
    if (toDelete.length) {
      await supabase.from("server_backups").delete().in("id", toDelete);
      await supabase.from("recovery_logs").insert({
        guild_id: guildId,
        action: "backup_pruned",
        status: "success",
        detail: `Pruned ${toDelete.length} old backup${toDelete.length === 1 ? "" : "s"} (retention ${retention}).`,
      });
    }
  }

  async function runBackup(guild, schedule) {
    const keys = (schedule.section_keys && schedule.section_keys.length
      ? schedule.section_keys
      : BACKUP_SECTION_KEYS
    ).filter((k) => BACKUP_SECTION_KEYS.includes(k));

    const sections = await captureSections(guild, keys);
    const present = sectionKeysPresent(sections);
    const now = new Date().toISOString();

    // Even with nothing captured we still advance the schedule so we don't
    // re-attempt every tick; just skip the insert.
    if (present.length > 0) {
      const version = await nextVersion(guild.id);
      const label = schedule.frequency === "daily" ? "Daily backup" : "Weekly backup";
      const { data: inserted, error } = await supabase
        .from("server_backups")
        .insert({
          guild_id: guild.id,
          name: `${label} — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
          type: schedule.frequency,
          version,
          format_version: CURRENT_BACKUP_VERSION,
          sections,
          section_keys: present,
          size_bytes: sizeOf(sections),
          created_by: null,
          created_by_name: "Pulse (scheduled)",
        })
        .select("id")
        .single();

      if (!error && inserted) {
        await supabase.from("recovery_logs").insert({
          guild_id: guild.id,
          action: "backup_created",
          status: "success",
          backup_id: inserted.id,
          backup_name: `${label}`,
          backup_type: schedule.frequency,
          section_keys: present,
          actor_name: "Pulse (scheduled)",
          detail: `Automatic ${schedule.frequency} backup — ${present.length} section${present.length === 1 ? "" : "s"}.`,
        });
        await prune(guild.id, schedule.frequency, schedule.retention ?? 10);
      } else if (error) {
        console.warn(`[Pulse] scheduled backup failed for ${guild.id}:`, error.message);
      }
    }

    await supabase
      .from("backup_schedules")
      .update({ last_backup_at: now, next_backup_at: computeNextRun(schedule.frequency) })
      .eq("guild_id", guild.id);
  }

  // ── Tick ─────────────────────────────────────────────────────────────────────
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const { data: due } = await supabase
        .from("backup_schedules")
        .select("*")
        .eq("enabled", true)
        .lte("next_backup_at", new Date().toISOString());
      for (const schedule of due ?? []) {
        const guild = client.guilds.cache.get(schedule.guild_id);
        if (!guild) continue; // bot not in the guild (anymore) — leave the row.
        try {
          await runBackup(guild, schedule);
        } catch (err) {
          console.warn(`[Pulse] backup tick error for ${schedule.guild_id}:`, err.message);
        }
      }
    } catch (err) {
      console.warn("[Pulse] backup tick failed:", err.message);
    } finally {
      ticking = false;
    }
  }

  // ── Manual backups via /backup (PULSIFY-61) ────────────────────────────────

  /** Trim old backups down to the hard per-guild cap (oldest first). Manual
   *  backups aren't pruned by retention, but the absolute cap still applies. */
  async function enforceHardCap(guildId) {
    const { data: all } = await supabase
      .from("server_backups")
      .select("id")
      .eq("guild_id", guildId)
      .order("created_at", { ascending: false });
    const overflow = (all ?? []).slice(LIMITS.maxBackupsPerGuild).map((r) => r.id);
    if (overflow.length) await supabase.from("server_backups").delete().in("id", overflow);
  }

  /** Capture + store a MANUAL backup (all sections). Mirrors the dashboard's
   *  manual-backup path: type 'manual', attributed to the invoker, logged. */
  async function createManualBackup(guild, { actorId, actorName, name } = {}) {
    const sections = await captureSections(guild, BACKUP_SECTION_KEYS);
    const present = sectionKeysPresent(sections);
    if (present.length === 0) return { ok: false, reason: "empty" };

    const version = await nextVersion(guild.id);
    const backupName =
      (name && name.trim().slice(0, 80)) ||
      `Manual backup — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    const size = sizeOf(sections);

    const { data: inserted, error } = await supabase
      .from("server_backups")
      .insert({
        guild_id: guild.id,
        name: backupName,
        type: "manual",
        version,
        format_version: CURRENT_BACKUP_VERSION,
        sections,
        section_keys: present,
        size_bytes: size,
        created_by: actorId ?? null,
        created_by_name: actorName ?? "Discord command",
      })
      .select("id")
      .single();
    if (error || !inserted) return { ok: false, reason: "error", error: error?.message };

    await supabase.from("recovery_logs").insert({
      guild_id: guild.id,
      action: "backup_created",
      status: "success",
      backup_id: inserted.id,
      backup_name: backupName,
      backup_type: "manual",
      section_keys: present,
      actor_id: actorId ?? null,
      actor_name: actorName ?? null,
      detail: `Manual backup via command — ${present.length} section${present.length === 1 ? "" : "s"}.`,
    });
    await enforceHardCap(guild.id);

    return { ok: true, id: inserted.id, name: backupName, version, sections: present, size };
  }

  async function listBackups(guildId, limit = 10) {
    const { data, error } = await supabase
      .from("server_backups")
      .select("id, name, type, version, section_keys, size_bytes, created_at, created_by_name")
      .eq("guild_id", guildId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  function formatBytes(n) {
    const b = Number(n) || 0;
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function renderBackup(interaction, guild, { title, body, footer }) {
    const colorHex = await getPulseColor(supabase, guild.id);
    const icon = await loadPulseIcon("safety", colorHex);
    await interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components: [
        buildPulseContainer({
          iconUrl: icon ? `attachment://${icon.name}` : null,
          colorHex,
          title,
          subtitle: `Pulse — ${guild.name}`,
          body,
          footer,
          actions: [
            { type: 1, components: [{ type: 2, style: 5, label: "Open Backups", url: `${getDashboardUrl(guild.id)}/backups` }] },
          ],
        }),
      ],
      files: icon ? [icon] : [],
    });
  }

  async function handleBackupCreate({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : 0 });
    const name = interaction.options.getString("name");
    let res;
    try {
      res = await createManualBackup(guild, {
        actorId: interaction.user.id,
        actorName: interaction.member?.displayName ?? interaction.user.username,
        name,
      });
    } catch (err) {
      console.error(`[Pulse] /backup create failed in ${guild.id}:`, err.message);
      return editNotice(interaction, "I couldn't create the backup. Try again shortly.");
    }
    if (!res.ok) {
      return editNotice(
        interaction,
        res.reason === "empty"
          ? "There's nothing to back up yet — configure some features first."
          : "I couldn't create the backup. Try again shortly.",
      );
    }
    await renderBackup(interaction, guild, {
      title: "Backup created",
      body: [
        text(`**${res.name}**`),
        divider(),
        text(
          [
            `**Version** — v${res.version}`,
            `**Sections** — ${res.sections.length}`,
            `**Size** — ${formatBytes(res.size)}`,
          ].join("\n"),
        ),
        text("-# Restore or download it from the dashboard."),
      ],
      footer: "Pulse — Backups",
    });
  }

  async function handleBackupList({ interaction, guild, ephemeral }) {
    await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : 0 });
    let backups;
    try {
      backups = await listBackups(guild.id, 10);
    } catch (err) {
      console.error(`[Pulse] /backup list failed in ${guild.id}:`, err.message);
      return editNotice(interaction, "I couldn't load the backups. Try again shortly.");
    }

    const body = [];
    if (backups.length === 0) {
      body.push(text("No backups yet. Create one with `/backup create`, or schedule automatic backups from the dashboard."));
    } else {
      body.push(text(`The ${backups.length} most recent backup${backups.length === 1 ? "" : "s"}.`));
      body.push(divider());
      const lines = backups.map((b) => {
        const when = `<t:${Math.floor(new Date(b.created_at).getTime() / 1000)}:D>`;
        const secs = Array.isArray(b.section_keys) ? b.section_keys.length : 0;
        return `**${b.name}**\n-# v${b.version} — ${b.type} — ${secs} section${secs === 1 ? "" : "s"} — ${formatBytes(b.size_bytes)} — ${when}`;
      });
      body.push(text(lines.join("\n\n")));
    }
    await renderBackup(interaction, guild, {
      title: "Server Backups",
      body,
      footer: "Pulse — Backups",
    });
  }

  async function start() {
    // First check shortly after ready so the guild/channel caches are warm,
    // then hourly. unref so the timer never keeps the process alive on its own.
    setTimeout(() => {
      void tick();
      tickTimer = setInterval(() => void tick(), TICK_MS);
      if (tickTimer.unref) tickTimer.unref();
    }, 30_000);
    console.log("[Pulse] Backup system started.");
  }

  return { start, tick, createManualBackup, listBackups, handleBackupCreate, handleBackupList };
}

module.exports = { createBackups };
