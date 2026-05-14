-- Welcome banner images (uploaded when user applies an embed welcome message)
insert into storage.buckets (id, name, public)
values ('welcome-banners', 'welcome-banners', true)
on conflict (id) do nothing;

-- Authenticated users can upload / overwrite banners
create policy "Authenticated users can upload welcome banners"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'welcome-banners');

create policy "Authenticated users can update welcome banners"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'welcome-banners');

-- Anyone (including Discord CDN fetches) can read
create policy "Public read welcome banners"
  on storage.objects for select
  using (bucket_id = 'welcome-banners');
