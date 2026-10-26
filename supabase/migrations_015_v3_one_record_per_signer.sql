-- Migration 015: v3 records are one per (document, signer).
--
-- SignatureRegistryV3 and register_v3 give every wallet that registers a hash
-- its own record (in v2 the first wallet locked everyone else out). So the
-- same (rede, hash_registro, versao_contrato) can now have several rows, one
-- per assinante_endereco.
--
-- Also flags EVM v2 rows written after Niara retired v2 on that network
-- (the indexer's <PREFIX>_V2_RETIRED_AT): v2 cannot be paused, so such a row
-- did not come from the site and may be a copy of a v3 registration taken
-- from the mempool. Readers show it but do not count it.
--
-- Run ONCE in the Supabase SQL Editor (niara-register-dev), after 014 and
-- BEFORE deploying the indexer version that knows v3. Idempotent.

alter table registro_assinaturas_v2
  drop constraint if exists registro_assinaturas_v2_rede_hash_versao_unique;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'registro_assinaturas_v2_rede_hash_versao_assinante_unique') then
    alter table registro_assinaturas_v2
      add constraint registro_assinaturas_v2_rede_hash_versao_assinante_unique
        unique (rede, hash_registro, versao_contrato, assinante_endereco);
  end if;
end $$;

alter table registro_assinaturas_v2
  add column if not exists apos_aposentadoria_v2 boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'registro_assinaturas_v2_aposentadoria_so_v2') then
    alter table registro_assinaturas_v2
      add constraint registro_assinaturas_v2_aposentadoria_so_v2
        check (not apos_aposentadoria_v2 or versao_contrato = 2);
  end if;
end $$;
