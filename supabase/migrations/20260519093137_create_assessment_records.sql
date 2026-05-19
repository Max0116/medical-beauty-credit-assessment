create extension if not exists pgcrypto;

create table if not exists public.assessment_records (
  id text primary key default gen_random_uuid()::text,
  client_instance_id text not null,
  institution_name text not null,
  final_grade text not null,
  final_decision text not null,
  total_score integer not null,
  max_term_days integer not null,
  suggested_limit numeric(14, 2) not null default 0,
  stable_monthly_average numeric(14, 2) not null default 0,
  needs_approval boolean not null default false,
  redline_reasons jsonb not null default '[]'::jsonb,
  cap_reasons jsonb not null default '[]'::jsonb,
  approval_reasons jsonb not null default '[]'::jsonb,
  form_snapshot jsonb not null,
  result_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assessment_drafts (
  client_instance_id text primary key,
  form_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.verification_logs (
  id uuid primary key default gen_random_uuid(),
  assessment_record_id text references public.assessment_records(id) on delete cascade,
  client_instance_id text not null,
  provider text not null default 'zhipu_web_search',
  status text not null default 'pending',
  query_keywords jsonb not null default '[]'::jsonb,
  raw_results jsonb not null default '[]'::jsonb,
  extracted_flags jsonb not null default '{}'::jsonb,
  risk_tags jsonb not null default '[]'::jsonb,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint verification_logs_status_check
    check (status in ('pending', 'running', 'completed', 'failed', 'skipped'))
);

create index if not exists assessment_records_client_created_idx
  on public.assessment_records (client_instance_id, created_at desc);

create index if not exists verification_logs_record_created_idx
  on public.verification_logs (assessment_record_id, created_at desc);

alter table public.assessment_records enable row level security;
alter table public.assessment_drafts enable row level security;
alter table public.verification_logs enable row level security;

grant select, insert, update, delete on table public.assessment_records to service_role;
grant select, insert, update, delete on table public.assessment_drafts to service_role;
grant select, insert, update, delete on table public.verification_logs to service_role;
