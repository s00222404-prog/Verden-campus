-- CampusFlow LIVE — run in Supabase SQL Editor.
-- Keep the service-role key on the backend only. Never put it in the browser.

create extension if not exists pgcrypto;

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  pin_hash text not null unique,
  teacher_token_hash text not null,
  status text not null default 'active' check (status in ('active', 'closed')),
  assignment_name text,
  assignment_path text,
  assignment_mime text,
  assignment_size integer,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '8 hours'),
  closed_at timestamptz
);

create index if not exists sessions_status_expiry_idx
  on public.sessions (status, expires_at desc);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  student_name text not null default 'Student',
  answer_text text,
  file_path text,
  file_mime text,
  file_size integer,
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  constraint submission_has_content check (
    nullif(trim(coalesce(answer_text, '')), '') is not null or file_path is not null
  )
);

create index if not exists submissions_session_created_idx
  on public.submissions (session_id, created_at asc);

alter table public.sessions enable row level security;
alter table public.submissions enable row level security;

-- All application data access goes through the trusted Node API.
-- No anon/authenticated table policies are intentionally created.
revoke all on public.sessions from anon, authenticated;
revoke all on public.submissions from anon, authenticated;

-- Private bucket. Backend validates MIME, extension and 5 MiB size before upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'assignments',
  'assignments',
  false,
  5242880,
  array['application/pdf', 'image/png', 'image/jpeg']
)
on conflict (id) do update set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg'];

-- Do not add broad storage.objects policies. Browser uploads/downloads are not allowed.
