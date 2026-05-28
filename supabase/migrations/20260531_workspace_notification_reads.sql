-- ============================================================
-- Pulsify — Workspace notifications: per-user read state
--
-- Adds the read/unread layer the workspace bell + notifications page need to
-- match the server dashboard's notifications UX (per-item read, mark all
-- read, unread badge).
--
-- The workspace feed is synthesised from three sources (workspace_activity,
-- moderation_logs, notifications), so we can't attach reads to a single
-- source PK. Instead we key on the synthesised feed item id ("item_key")
-- emitted by /api/workspace/[id]/feed: a bare uuid for workspace_activity
-- rows, `mod-<uuid>` for moderation_logs, `notif-<uuid>` for notifications.
--
-- Like every other Pulsify table this uses RLS allow-all and relies on the
-- server-side authorize helpers (lib/workspace-auth.ts) for real
-- enforcement — keep consistent with siblings.
-- ============================================================

create table if not exists public.workspace_notification_reads (
  workspace_id uuid        not null references public.workspaces(id) on delete cascade,
  user_id      text        not null,
  -- Synthesised feed id from /api/workspace/[id]/feed. Text, not uuid, because
  -- moderation/notification keys are prefixed.
  item_key     text        not null,
  read_at      timestamptz not null default now(),
  primary key (workspace_id, user_id, item_key)
);

-- Lookups join (workspace_id, user_id) → set of read keys for the visible page.
create index if not exists workspace_notification_reads_user
  on public.workspace_notification_reads (workspace_id, user_id);

alter table public.workspace_notification_reads enable row level security;
create policy "Allow all access to workspace_notification_reads"
  on public.workspace_notification_reads for all using (true) with check (true);

-- ---------------------------------------------------------------
-- Retention helper. Workspace activity is treated like notifications:
-- worth keeping for ~a month, not forever. The function deletes rows older
-- than 30 days and is safe to call repeatedly. Schedule it from pg_cron
-- (see project docs) — kept here so it travels with the schema.
create or replace function public.prune_workspace_activity()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.workspace_activity
   where created_at < now() - interval '30 days';
  -- Drop orphan read rows whose target rows are gone — they only ever exist
  -- to suppress an unread badge, and the row they referenced is no longer
  -- in the feed. We can't enforce a hard FK because item_key joins three
  -- sources, but a periodic cleanup is cheap.
  delete from public.workspace_notification_reads r
   where r.item_key not like 'mod-%'
     and r.item_key not like 'notif-%'
     and not exists (
       select 1 from public.workspace_activity a where a.id::text = r.item_key
     );
$$;
