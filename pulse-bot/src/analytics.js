// Lightweight analytics collection for the Pulse bot.
//
// Point-in-time events (messages, joins, commands, ...) are buffered and
// flushed to Supabase on an interval so we don't make a DB round-trip on
// every single message. Voice sessions are tracked in memory and written
// as a completed row (with a computed duration) when the user leaves.

const FLUSH_INTERVAL_MS = 15_000;
const MAX_BUFFER = 100;
// Still-active voice sessions are committed on this interval so the dashboard
// reflects ongoing calls without waiting for everyone to disconnect.
const VOICE_CHECKPOINT_MS = 5 * 60_000;

function createAnalytics(supabase) {
  let buffer = [];
  let flushing = false;
  // key: `${guildId}:${userId}` -> { channelId, channelName, userName, joinedAt }
  const voiceSessions = new Map();

  async function flush() {
    if (flushing || buffer.length === 0) return;
    flushing = true;
    const batch = buffer;
    buffer = [];
    try {
      const { error } = await supabase.from('analytics_events').insert(batch);
      if (error) {
        console.error('[Pulse] Analytics flush failed:', error.message);
        // Re-queue (capped) so a transient failure doesn't lose recent events.
        buffer = [...batch.slice(-MAX_BUFFER), ...buffer];
      }
    } catch (err) {
      console.error('[Pulse] Analytics flush threw:', err.message);
      buffer = [...batch.slice(-MAX_BUFFER), ...buffer];
    } finally {
      flushing = false;
    }
  }

  function track(event) {
    if (!event.guildId) return;
    buffer.push({
      guild_id: event.guildId,
      event_type: event.type,
      user_id: event.userId ?? null,
      user_name: event.userName ?? null,
      channel_id: event.channelId ?? null,
      channel_name: event.channelName ?? null,
      metadata: event.metadata ?? {},
    });
    // Member events drive the live dashboard view — flush immediately so
    // Realtime subscribers see them without waiting for the next batch.
    if (buffer.length >= MAX_BUFFER || event.immediate) flush();
  }

  function voiceJoin(guildId, userId, userName, channelId, channelName) {
    voiceSessions.set(`${guildId}:${userId}`, {
      channelId,
      channelName: channelName ?? null,
      userName: userName ?? null,
      joinedAt: Date.now(),
    });
  }

  async function commitVoiceSession(guildId, userId, session, until) {
    const duration = Math.round((until - session.joinedAt) / 1000);
    if (duration < 1) return;

    const { error } = await supabase.from('voice_sessions').insert({
      guild_id: guildId,
      user_id: userId,
      user_name: session.userName,
      channel_id: session.channelId,
      channel_name: session.channelName,
      joined_at: new Date(session.joinedAt).toISOString(),
      left_at: new Date(until).toISOString(),
      duration_seconds: duration,
    });
    if (error) console.error('[Pulse] Voice session insert failed:', error.message);
  }

  async function voiceLeave(guildId, userId) {
    const key = `${guildId}:${userId}`;
    const session = voiceSessions.get(key);
    if (!session) return;
    voiceSessions.delete(key);
    await commitVoiceSession(guildId, userId, session, Date.now());
  }

  // Commit the elapsed time of every still-active session and restart its
  // clock, so long-running calls show up on the dashboard incrementally
  // instead of only when the last person disconnects.
  async function checkpointVoice() {
    const now = Date.now();
    for (const [key, session] of voiceSessions) {
      const [guildId, userId] = key.split(':');
      await commitVoiceSession(guildId, userId, session, now);
      session.joinedAt = now;
    }
  }

  // Close every open voice session — used on graceful shutdown.
  async function flushAllVoice() {
    for (const key of [...voiceSessions.keys()]) {
      const [guildId, userId] = key.split(':');
      await voiceLeave(guildId, userId);
    }
  }

  const timer = setInterval(flush, FLUSH_INTERVAL_MS);
  if (timer.unref) timer.unref();

  const voiceTimer = setInterval(checkpointVoice, VOICE_CHECKPOINT_MS);
  if (voiceTimer.unref) voiceTimer.unref();

  return { track, voiceJoin, voiceLeave, flush, flushAllVoice };
}

module.exports = { createAnalytics };
