-- ============================================================
-- Pulsify — activity heatmap aggregation
-- Message volume bucketed by day-of-week × hour-of-day, powering the
-- Insights "Peak Activity Map" (when the community is most active).
-- Hours/days are UTC, matching get_peak_hours. A null p_since = all time.
-- ============================================================

create or replace function public.get_activity_heatmap(
  p_guild_id text,
  p_since    timestamptz
)
returns table (
  -- 0 = Monday … 6 = Sunday (isodow 1-7 shifted to 0-6 for a Mon-first grid).
  dow           int,
  hour          int,   -- 0..23 (UTC)
  message_count bigint
)
language sql
stable
as $$
  select
    (extract(isodow from created_at)::int - 1) as dow,
    extract(hour from created_at)::int          as hour,
    count(*)                                    as message_count
  from public.analytics_events
  where guild_id = p_guild_id
    and event_type = 'message'
    and (p_since is null or created_at >= p_since)
  group by 1, 2
  order by 1, 2;
$$;

grant execute on function public.get_activity_heatmap(text, timestamptz) to anon, authenticated;
