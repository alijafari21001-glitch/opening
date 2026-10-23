-- OpenRung online projects. Run this once in Supabase: SQL Editor > New query > paste > Run.
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

-- Row-level security: each signed-in user can only see and change their own projects.
alter table public.projects enable row level security;

drop policy if exists "own projects: read" on public.projects;
drop policy if exists "own projects: add" on public.projects;
drop policy if exists "own projects: change" on public.projects;
drop policy if exists "own projects: delete" on public.projects;
create policy "own projects: read" on public.projects for select to authenticated using (user_id = auth.uid());
create policy "own projects: add" on public.projects for insert to authenticated with check (user_id = auth.uid());
create policy "own projects: change" on public.projects for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own projects: delete" on public.projects for delete to authenticated using (user_id = auth.uid());

revoke all on public.projects from anon;
