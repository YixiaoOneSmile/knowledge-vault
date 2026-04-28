create extension if not exists "pgcrypto";

create table if not exists public.archive_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  kind text not null check (kind in ('url', 'file', 'note')),
  title text,
  source_url text,
  storage_path text,
  mime_type text,
  status text not null default 'queued' check (status in ('queued', 'processing', 'ready', 'failed')),
  summary text,
  content_text text,
  tags text[] default '{}',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists archive_items_user_created_idx on public.archive_items (user_id, created_at desc);
create index if not exists archive_items_status_idx on public.archive_items (status);

alter table public.archive_items enable row level security;

create policy "Users can read own archive items"
  on public.archive_items for select
  using (auth.uid() = user_id);

create policy "Users can create own archive items"
  on public.archive_items for insert
  with check (auth.uid() = user_id);

create policy "Users can update own archive items"
  on public.archive_items for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own archive items"
  on public.archive_items for delete
  using (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists archive_items_set_updated_at on public.archive_items;
create trigger archive_items_set_updated_at
  before update on public.archive_items
  for each row
  execute function public.set_updated_at();

insert into storage.buckets (id, name, public)
values ('archive-files', 'archive-files', false)
on conflict (id) do nothing;

create policy "Users can read own archive files"
  on storage.objects for select
  using (bucket_id = 'archive-files' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can upload own archive files"
  on storage.objects for insert
  with check (bucket_id = 'archive-files' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can update own archive files"
  on storage.objects for update
  using (bucket_id = 'archive-files' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'archive-files' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can delete own archive files"
  on storage.objects for delete
  using (bucket_id = 'archive-files' and auth.uid()::text = (storage.foldername(name))[1]);
