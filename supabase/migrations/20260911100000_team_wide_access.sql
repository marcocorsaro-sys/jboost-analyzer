-- Team-wide access to V4 audits (review Federico 08/09/2026, item 1/4/8:
-- scores visible only to the launcher, colleagues cannot edit or answer
-- decisions). Model chosen by Marco: FULL TEAM — every authenticated user
-- of the tool sees and edits every audit. Deletion stays with the owner
-- (and admins): removing someone else's work is the one destructive act
-- kept personal.
--
-- The child tables (driver_runs, template_configs, content_answers,
-- deliverables, analysis_checkpoints) each re-stated the ownership check
-- inline, so opening analyses alone would not have been enough: their
-- policies are replaced with plain authenticated access.

-- ---------------------------------------------------------------- analyses
drop policy if exists "Users can view own analyses" on public.analyses;
drop policy if exists "Admins can view all analyses" on public.analyses;
drop policy if exists "Users can update own analyses" on public.analyses;

create policy "analyses_team_select" on public.analyses
  for select to authenticated using (true);
create policy "analyses_team_update" on public.analyses
  for update to authenticated using (true);
-- insert (stamps own user_id) and delete (owner only) keep their policies.

-- -------------------------------------------------------------- driver_runs
drop policy if exists "driver_runs_select" on public.driver_runs;
drop policy if exists "driver_runs_update" on public.driver_runs;
drop policy if exists "driver_runs_insert" on public.driver_runs;
drop policy if exists "driver_runs_delete" on public.driver_runs;

create policy "driver_runs_team_select" on public.driver_runs
  for select to authenticated using (true);
create policy "driver_runs_team_update" on public.driver_runs
  for update to authenticated using (true);
create policy "driver_runs_team_insert" on public.driver_runs
  for insert to authenticated with check (true);
create policy "driver_runs_team_delete" on public.driver_runs
  for delete to authenticated
  using (exists (select 1 from public.analyses a
                 where a.id = driver_runs.analysis_id and a.user_id = auth.uid()));

-- --------------------------------------------------------- template_configs
drop policy if exists "template_configs_select" on public.template_configs;
drop policy if exists "template_configs_update" on public.template_configs;
drop policy if exists "template_configs_insert" on public.template_configs;
drop policy if exists "template_configs_delete" on public.template_configs;

create policy "template_configs_team_select" on public.template_configs
  for select to authenticated using (true);
create policy "template_configs_team_update" on public.template_configs
  for update to authenticated using (true);
create policy "template_configs_team_insert" on public.template_configs
  for insert to authenticated with check (true);
create policy "template_configs_team_delete" on public.template_configs
  for delete to authenticated
  using (exists (select 1 from public.analyses a
                 where a.id = template_configs.analysis_id and a.user_id = auth.uid()));

-- ---------------------------------------------------------- content_answers
drop policy if exists "content_answers_select" on public.content_answers;
drop policy if exists "content_answers_update" on public.content_answers;
drop policy if exists "content_answers_insert" on public.content_answers;
drop policy if exists "content_answers_delete" on public.content_answers;

create policy "content_answers_team_select" on public.content_answers
  for select to authenticated using (true);
create policy "content_answers_team_update" on public.content_answers
  for update to authenticated using (true);
create policy "content_answers_team_insert" on public.content_answers
  for insert to authenticated with check (true);
create policy "content_answers_team_delete" on public.content_answers
  for delete to authenticated using (true);

-- ------------------------------------------------------------- deliverables
drop policy if exists "deliverables_select" on public.deliverables;
drop policy if exists "deliverables_update" on public.deliverables;
drop policy if exists "deliverables_insert" on public.deliverables;
drop policy if exists "deliverables_delete" on public.deliverables;

create policy "deliverables_team_select" on public.deliverables
  for select to authenticated using (true);
create policy "deliverables_team_update" on public.deliverables
  for update to authenticated using (true);
create policy "deliverables_team_insert" on public.deliverables
  for insert to authenticated with check (true);
create policy "deliverables_team_delete" on public.deliverables
  for delete to authenticated using (true);

-- ----------------------------------------------------- analysis_checkpoints
drop policy if exists "checkpoints_select" on public.analysis_checkpoints;
drop policy if exists "checkpoints_update_decision" on public.analysis_checkpoints;

create policy "checkpoints_team_select" on public.analysis_checkpoints
  for select to authenticated using (true);
create policy "checkpoints_team_update" on public.analysis_checkpoints
  for update to authenticated using (true);

-- ------------------------------------------------------------------ clients
-- The Clients section is the shared prospect->client funnel: the whole team
-- sees and edits. Ownership (client_members) still governs deletion.
drop policy if exists "clients_select" on public.clients;
drop policy if exists "clients_update" on public.clients;

create policy "clients_team_select" on public.clients
  for select to authenticated using (true);
create policy "clients_team_update" on public.clients
  for update to authenticated using (true);

drop policy if exists "client_members_select" on public.client_members;
create policy "client_members_team_select" on public.client_members
  for select to authenticated using (true);
