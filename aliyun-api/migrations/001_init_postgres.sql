create table if not exists assessment_records (
  id text primary key,
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

create index if not exists assessment_records_client_created_idx
  on assessment_records (client_instance_id, created_at desc);

create table if not exists assessment_drafts (
  client_instance_id text primary key,
  form_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists verification_logs (
  id uuid primary key default gen_random_uuid(),
  assessment_record_id text references assessment_records(id) on delete cascade,
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

create index if not exists verification_logs_record_created_idx
  on verification_logs (assessment_record_id, created_at desc);

create index if not exists verification_logs_client_created_idx
  on verification_logs (client_instance_id, created_at desc);

create table if not exists verification_reviews (
  id uuid primary key default gen_random_uuid(),
  assessment_record_id text references assessment_records(id) on delete cascade,
  verification_log_id uuid references verification_logs(id) on delete set null,
  client_instance_id text not null,
  action text not null,
  reviewer_name text not null,
  reviewer_decision text not null,
  previous_public_credit_status text,
  suggested_public_credit_status text,
  evidence_url text,
  evidence_note text,
  verification_snapshot jsonb not null default '{}'::jsonb,
  applied_fields jsonb not null default '{}'::jsonb,
  evidence_attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint verification_reviews_action_check
    check (action in ('accept_suggestion', 'manual_override', 'mark_reviewed')),
  constraint verification_reviews_decision_check
    check (reviewer_decision in ('normal', 'unknown', 'medium', 'serious'))
);

create index if not exists verification_reviews_record_created_idx
  on verification_reviews (assessment_record_id, created_at desc);
