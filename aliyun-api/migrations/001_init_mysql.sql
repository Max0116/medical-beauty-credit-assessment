create table if not exists assessment_records (
  id varchar(128) primary key,
  client_instance_id varchar(128) not null,
  institution_name varchar(255) not null,
  final_grade varchar(16) not null,
  final_decision varchar(64) not null,
  total_score int not null,
  max_term_days int not null,
  suggested_limit decimal(14, 2) not null default 0,
  stable_monthly_average decimal(14, 2) not null default 0,
  needs_approval boolean not null default false,
  redline_reasons json not null,
  cap_reasons json not null,
  approval_reasons json not null,
  form_snapshot json not null,
  result_snapshot json not null,
  created_at datetime(3) not null default current_timestamp(3),
  updated_at datetime(3) not null default current_timestamp(3),
  index assessment_records_client_created_idx (client_instance_id, created_at desc)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create table if not exists assessment_drafts (
  client_instance_id varchar(128) primary key,
  form_snapshot json not null,
  created_at datetime(3) not null default current_timestamp(3),
  updated_at datetime(3) not null default current_timestamp(3)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create table if not exists verification_logs (
  id varchar(36) primary key,
  assessment_record_id varchar(128),
  client_instance_id varchar(128) not null,
  provider varchar(64) not null default 'zhipu_web_search',
  status varchar(24) not null default 'pending',
  query_keywords json not null,
  raw_results json not null,
  extracted_flags json not null,
  risk_tags json not null,
  error_message text,
  started_at datetime(3),
  finished_at datetime(3),
  created_at datetime(3) not null default current_timestamp(3),
  updated_at datetime(3) not null default current_timestamp(3),
  constraint verification_logs_record_fk
    foreign key (assessment_record_id) references assessment_records(id) on delete cascade,
  constraint verification_logs_status_check
    check (status in ('pending', 'running', 'completed', 'failed', 'skipped')),
  index verification_logs_record_created_idx (assessment_record_id, created_at desc),
  index verification_logs_client_created_idx (client_instance_id, created_at desc)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;

create table if not exists verification_reviews (
  id varchar(36) primary key,
  assessment_record_id varchar(128),
  verification_log_id varchar(36),
  client_instance_id varchar(128) not null,
  action varchar(32) not null,
  reviewer_name varchar(128) not null,
  reviewer_decision varchar(32) not null,
  previous_public_credit_status varchar(64),
  suggested_public_credit_status varchar(64),
  evidence_url text,
  evidence_note text,
  verification_snapshot json not null,
  applied_fields json not null,
  evidence_attachments json not null,
  created_at datetime(3) not null default current_timestamp(3),
  constraint verification_reviews_record_fk
    foreign key (assessment_record_id) references assessment_records(id) on delete cascade,
  constraint verification_reviews_log_fk
    foreign key (verification_log_id) references verification_logs(id) on delete set null,
  constraint verification_reviews_action_check
    check (action in ('accept_suggestion', 'manual_override', 'mark_reviewed')),
  constraint verification_reviews_decision_check
    check (reviewer_decision in ('normal', 'unknown', 'medium', 'serious')),
  index verification_reviews_record_created_idx (assessment_record_id, created_at desc)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
