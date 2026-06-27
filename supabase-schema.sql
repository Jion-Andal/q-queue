create table if not exists public.q_queue_sessions (
  id text primary key,
  payload jsonb not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.q_queue_sessions enable row level security;

create policy "Anyone can read active q queue sessions"
on public.q_queue_sessions
for select
using (expires_at > now());

create policy "Anyone can create q queue sessions"
on public.q_queue_sessions
for insert
with check (expires_at > now());

create policy "Anyone can update active q queue sessions"
on public.q_queue_sessions
for update
using (expires_at > now())
with check (expires_at > now());

create or replace function public.touch_q_queue_sessions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_q_queue_sessions_updated_at on public.q_queue_sessions;

create trigger touch_q_queue_sessions_updated_at
before update on public.q_queue_sessions
for each row
execute function public.touch_q_queue_sessions_updated_at();
