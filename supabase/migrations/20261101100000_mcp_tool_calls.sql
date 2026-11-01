-- MCP connector: usage log (one row per tools/call). Written with the service
-- role by /api/mcp; read server-side by Settings. RLS on, no policies = no
-- direct client access.
create table if not exists public.mcp_tool_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  email text,
  tool text not null,
  analysis_id uuid,
  ok boolean not null default true,
  error text,
  client_id text,
  duration_ms integer,
  created_at timestamptz not null default now()
);
alter table public.mcp_tool_calls enable row level security;
create index if not exists mcp_tool_calls_created_at_idx on public.mcp_tool_calls (created_at desc);
create index if not exists mcp_tool_calls_user_idx on public.mcp_tool_calls (user_id, created_at desc);
