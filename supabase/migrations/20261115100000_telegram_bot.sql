-- Telegram bot (@Jboostanalyser_bot): collegamento utente Telegram <-> utente JBA,
-- codici di collegamento monouso, azioni in attesa di conferma, dedupe degli update.
-- Tutte le tabelle: RLS attiva e nessuna policy = accessibili solo con service role
-- (webhook e route server-side). Nessun accesso diretto dal client.

create table if not exists public.telegram_links (
  telegram_user_id bigint primary key,
  chat_id bigint not null,
  user_id uuid not null,
  email text,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.telegram_links enable row level security;
create index if not exists telegram_links_user_idx on public.telegram_links (user_id);

create table if not exists public.telegram_link_codes (
  code_hash text primary key,
  user_id uuid not null,
  email text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.telegram_link_codes enable row level security;

create table if not exists public.telegram_pending (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null,
  tool text not null,
  tool_use_id text not null,
  args jsonb not null default '{}'::jsonb,
  messages jsonb not null default '[]'::jsonb,
  summary text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.telegram_pending enable row level security;
create index if not exists telegram_pending_user_idx on public.telegram_pending (telegram_user_id);

create table if not exists public.telegram_updates (
  update_id bigint primary key,
  received_at timestamptz not null default now()
);
alter table public.telegram_updates enable row level security;
