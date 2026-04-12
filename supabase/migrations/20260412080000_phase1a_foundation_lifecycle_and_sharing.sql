-- ============================================================================
-- JBoost Analyzer — Phase 1A
-- Adds: pgvector extension, lifecycle columns on clients, client_members
-- sharing with RLS helper functions. Purely additive.
-- ============================================================================

-- 1. Enable pgvector extension (needed for knowledge_chunks embeddings in 1B)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add lifecycle columns to existing clients table (additive, nullable, with defaults)
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT
    DEFAULT 'prospect'
    CHECK (lifecycle_stage IN ('prospect','active','churned','archived'));

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS engagement_started_at TIMESTAMPTZ;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS engagement_ended_at TIMESTAMPTZ;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS pre_sales_notes TEXT;

-- Backfill: all existing clients start as prospects
UPDATE public.clients
SET lifecycle_stage = 'prospect'
WHERE lifecycle_stage IS NULL;

CREATE INDEX IF NOT EXISTS idx_clients_lifecycle_stage
  ON public.clients(lifecycle_stage);

-- 3. client_members — explicit sharing (owner/editor/viewer)
CREATE TABLE IF NOT EXISTS public.client_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  added_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_client_members_user
  ON public.client_members(user_id);
CREATE INDEX IF NOT EXISTS idx_client_members_client
  ON public.client_members(client_id);

-- Backfill: each existing client's user_id becomes its owner
INSERT INTO public.client_members (client_id, user_id, role, added_by)
SELECT id, user_id, 'owner', user_id FROM public.clients
ON CONFLICT (client_id, user_id) DO NOTHING;

-- 4. Helper functions (SECURITY DEFINER to bypass RLS and avoid recursion)
-- These are used by RLS policies on all client-scoped tables going forward.

CREATE OR REPLACE FUNCTION public.user_has_client_access(p_client_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.client_members
    WHERE client_id = p_client_id
      AND user_id = auth.uid()
  );
$fn$;

CREATE OR REPLACE FUNCTION public.user_is_client_owner(p_client_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.client_members
    WHERE client_id = p_client_id
      AND user_id = auth.uid()
      AND role = 'owner'
  );
$fn$;

CREATE OR REPLACE FUNCTION public.user_can_edit_client(p_client_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.client_members
    WHERE client_id = p_client_id
      AND user_id = auth.uid()
      AND role IN ('owner','editor')
  );
$fn$;

GRANT EXECUTE ON FUNCTION public.user_has_client_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_client_owner(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_edit_client(UUID) TO authenticated;

-- 5. Generic updated_at trigger helper (used by all tables with updated_at)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$fn$;

-- 6. RLS on client_members
ALTER TABLE public.client_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_members_select" ON public.client_members;
DROP POLICY IF EXISTS "client_members_insert" ON public.client_members;
DROP POLICY IF EXISTS "client_members_update" ON public.client_members;
DROP POLICY IF EXISTS "client_members_delete" ON public.client_members;

-- Users can see membership rows for any client they themselves have access to
CREATE POLICY "client_members_select"
  ON public.client_members FOR SELECT
  TO authenticated
  USING (public.user_has_client_access(client_id));

-- Only owners can add new members
CREATE POLICY "client_members_insert"
  ON public.client_members FOR INSERT
  TO authenticated
  WITH CHECK (public.user_is_client_owner(client_id));

-- Only owners can update role
CREATE POLICY "client_members_update"
  ON public.client_members FOR UPDATE
  TO authenticated
  USING (public.user_is_client_owner(client_id));

-- Only owners can remove members
CREATE POLICY "client_members_delete"
  ON public.client_members FOR DELETE
  TO authenticated
  USING (public.user_is_client_owner(client_id));
