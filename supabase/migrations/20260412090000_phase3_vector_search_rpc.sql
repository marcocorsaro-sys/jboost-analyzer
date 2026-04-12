-- Phase 3: vector similarity search RPC for knowledge base RAG
-- Function runs as the calling user (SECURITY INVOKER) so RLS on
-- knowledge_chunks is enforced and only chunks the user can read are returned.

create or replace function public.search_knowledge_chunks(
  p_client_id uuid,
  p_query_embedding vector(1536),
  p_limit int default 10
)
returns table (
  id uuid,
  document_id uuid,
  chunk_index int,
  content text,
  metadata jsonb,
  similarity float
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    kc.id,
    kc.document_id,
    kc.chunk_index,
    kc.content,
    kc.metadata,
    1 - (kc.embedding <=> p_query_embedding) as similarity
  from public.knowledge_chunks kc
  where kc.client_id = p_client_id
    and kc.embedding is not null
  order by kc.embedding <=> p_query_embedding
  limit greatest(1, least(coalesce(p_limit, 10), 100));
$$;

revoke all on function public.search_knowledge_chunks(uuid, vector, int) from public;
grant execute on function public.search_knowledge_chunks(uuid, vector, int) to authenticated;
