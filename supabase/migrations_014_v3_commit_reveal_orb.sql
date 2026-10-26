-- Migration 014: v3 records (commit-reveal + ORB attestation).
--
-- SignatureRegistryV3 (EVM) and register_v3 (Solana) write the same fields as
-- v2 plus the hash of an attested ORB analysis report (or none). v3 rows go to
-- the same table, tagged with the contract version.
--
-- On EVM, v2 and v3 are separate contracts, so the same hash can have a v2 and
-- a v3 row on one network (for example a copy made on v2, which had no
-- commit-reveal). Uniqueness is therefore per version. On Solana one record
-- per hash still holds across versions (the program checks it).
--
-- Run ONCE in the Supabase SQL Editor (niara-register-dev) BEFORE deploying
-- the indexer version that knows v3. Idempotent.

alter table registro_assinaturas_v2
  add column if not exists versao_contrato smallint not null default 2
    check (versao_contrato in (2, 3));

alter table registro_assinaturas_v2
  add column if not exists hash_relatorio_orb text
    check (hash_relatorio_orb is null or hash_relatorio_orb ~ '^0x[0-9a-f]{64}$');

-- ORB attestations exist only from v3 on.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'registro_assinaturas_v2_orb_only_v3') then
    alter table registro_assinaturas_v2
      add constraint registro_assinaturas_v2_orb_only_v3
        check (hash_relatorio_orb is null or versao_contrato = 3);
  end if;
end $$;

alter table registro_assinaturas_v2
  drop constraint if exists registro_assinaturas_v2_rede_hash_unique;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'registro_assinaturas_v2_rede_hash_versao_unique') then
    alter table registro_assinaturas_v2
      add constraint registro_assinaturas_v2_rede_hash_versao_unique unique (rede, hash_registro, versao_contrato);
  end if;
end $$;
