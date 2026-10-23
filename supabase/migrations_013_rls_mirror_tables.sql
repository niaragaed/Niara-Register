-- Row level security on the mirror tables created before RLS was used
-- (schema.sql), and no writes for the public roles anywhere.
--
-- Why: registro_transacoes, registro_assinaturas and registro_checkpoints had
-- RLS off. With Supabase's default grants, a table in the public schema without
-- RLS can be written through the Data API with the anon key, not only read.
-- The site needs public reads of the mirror; only the indexer (service role,
-- which bypasses RLS) may write. registro_checkpoints is internal: no public
-- read either (a checkpoint moved ahead would make the indexer skip events).
--
-- Safe to run more than once. The indexer is unaffected (service role).

alter table registro_transacoes enable row level security;
alter table registro_assinaturas enable row level security;
alter table registro_checkpoints enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'registro_transacoes' and policyname = 'registro_transacoes_leitura_publica'
  ) then
    create policy registro_transacoes_leitura_publica
      on registro_transacoes for select to anon, authenticated using (true);
  end if;
  if not exists (
    select 1 from pg_policies where tablename = 'registro_assinaturas' and policyname = 'registro_assinaturas_leitura_publica'
  ) then
    create policy registro_assinaturas_leitura_publica
      on registro_assinaturas for select to anon, authenticated using (true);
  end if;
end $$;

-- Defence in depth: even if a policy is ever added by mistake, the public roles
-- hold no write privilege on any mirror table.
revoke insert, update, delete, truncate on
  registro_transacoes,
  registro_assinaturas,
  registro_checkpoints,
  registro_ofertas,
  registro_assinaturas_v2,
  registro_transferiveis_eventos
from anon, authenticated;

-- Check after running (every row must show rowsecurity = true):
--   select tablename, rowsecurity from pg_tables
--   where schemaname = 'public' and tablename like 'registro_%' order by 1;
