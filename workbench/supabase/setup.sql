-- Automation Workbench: one cloud save per signed-in user.
-- Run once in Supabase: SQL Editor > New query > paste > Run.
create table if not exists public.workbench_saves (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.workbench_saves enable row level security;
-- each user can only read and write their own row
drop policy if exists "own save select" on public.workbench_saves;
drop policy if exists "own save insert" on public.workbench_saves;
drop policy if exists "own save update" on public.workbench_saves;
drop policy if exists "own save delete" on public.workbench_saves;
create policy "own save select" on public.workbench_saves for select using (auth.uid() = user_id);
create policy "own save insert" on public.workbench_saves for insert with check (auth.uid() = user_id);
create policy "own save update" on public.workbench_saves for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own save delete" on public.workbench_saves for delete using (auth.uid() = user_id);
