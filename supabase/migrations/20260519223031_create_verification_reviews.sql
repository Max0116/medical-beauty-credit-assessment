create table if not exists public.verification_reviews (
  id uuid primary key default gen_random_uuid(),
  assessment_record_id text references public.assessment_records(id) on delete cascade,
  verification_log_id uuid references public.verification_logs(id) on delete set null,
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
  created_at timestamptz not null default now(),
  constraint verification_reviews_action_check
    check (action in ('accept_suggestion', 'manual_override', 'mark_reviewed')),
  constraint verification_reviews_decision_check
    check (reviewer_decision in ('normal', 'unknown', 'medium', 'serious'))
);

create index if not exists verification_reviews_record_created_idx
  on public.verification_reviews (assessment_record_id, created_at desc);

alter table public.verification_reviews enable row level security;

grant select, insert, update, delete on table public.verification_reviews to service_role;
