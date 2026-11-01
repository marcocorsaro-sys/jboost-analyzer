-- Unique, human-citable project code per V4 audit (JBA-0001, ...) + optional
-- JHorizon organization id link. Names are NOT unique (7 audits are "Ariston").
create sequence if not exists public.jba_project_code_seq;

alter table public.analyses add column if not exists project_code text;
alter table public.analyses add column if not exists jh_organization_id text;

-- Backfill the existing V4 audits in creation order.
with ordered as (
  select id, row_number() over (order by created_at, id) as rn
  from public.analyses
  where ref_date is not null and project_code is null
)
update public.analyses a
set project_code = 'JBA-' || lpad(o.rn::text, 4, '0')
from ordered o
where a.id = o.id;

select setval(
  'public.jba_project_code_seq',
  greatest(coalesce((select max(substring(project_code from 5)::int) from public.analyses where project_code ~ '^JBA-[0-9]+$'), 0), 1),
  (select count(*) > 0 from public.analyses where project_code is not null)
);

create or replace function public.assign_jba_project_code() returns trigger
language plpgsql as $$
begin
  if new.ref_date is not null and new.project_code is null then
    new.project_code := 'JBA-' || lpad(nextval('public.jba_project_code_seq')::text, 4, '0');
  end if;
  return new;
end $$;

drop trigger if exists analyses_assign_jba_project_code on public.analyses;
create trigger analyses_assign_jba_project_code
  before insert or update of ref_date on public.analyses
  for each row execute function public.assign_jba_project_code();

create unique index if not exists analyses_project_code_key on public.analyses (project_code) where project_code is not null;
