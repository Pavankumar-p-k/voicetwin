-- VOICETWIN multi-user MVP schema — run ONCE in Supabase SQL editor.
-- Identity comes from auth.users (no custom users table, no passwords here).
-- Every row belongs to exactly one user; RLS enforces it as a second layer
-- behind the backend's own ownership checks.
create table if not exists public.interviews (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_description text not null,
  difficulty text not null default 'medium',
  score integer null,
  total_earned integer null,
  total_possible integer null,
  questions_asked integer not null default 0,
  report jsonb null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);

create table if not exists public.interview_answers (
  id bigserial primary key,
  interview_id text not null references public.interviews(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  question text not null,
  answer text not null default '',
  specificity integer null,
  evidence_earned integer null,
  evidence_total integer null,
  created_at timestamptz not null default now()
);

create index if not exists interviews_user_idx on public.interviews (user_id, created_at desc);
create index if not exists answers_interview_idx on public.interview_answers (interview_id);

alter table public.interviews enable row level security;
alter table public.interview_answers enable row level security;

drop policy if exists "own interviews" on public.interviews;
create policy "own interviews" on public.interviews
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own answers" on public.interview_answers;
create policy "own answers" on public.interview_answers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
