-- Key/value store for dashboard-configured settings
-- (media_storage_path, report_recipient_phone, ...).
-- Safe to run even if this table already exists in your project.

create table if not exists app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- Service-role only — the app reads/writes this with the service
-- role key from server routes, never from the browser.
alter table app_settings enable row level security;
