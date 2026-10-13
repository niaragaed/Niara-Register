-- Migration 005: registro_assinaturas starts storing signatures from more than
-- one blockchain (Sepolia + Solana devnet, for now).
--
-- Run ONCE in the Supabase SQL Editor (project niara-register-dev) BEFORE
-- publishing the indexer with the Solana source: the new indexer writes with
-- onConflict (rede, hash_sha256), which only exists after this migration.
--
-- Idempotent: it can run again with no side effects.

-- 1. Network of each record. Every existing row is from Sepolia.
alter table registro_assinaturas
  add column if not exists rede text not null default 'sepolia';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'registro_assinaturas_rede_check'
  ) then
    alter table registro_assinaturas
      add constraint registro_assinaturas_rede_check
      check (rede in ('sepolia', 'solana-devnet'));
  end if;
end $$;

-- 2. Solana slot (the equivalent of the block). `bloco` stays EVM-only.
alter table registro_assinaturas
  add column if not exists slot bigint;

-- 3. Uniqueness becomes per network: the same document can be recorded on
--    Sepolia AND on Solana (they are independent proofs), but never twice on
--    the same network, which is what each contract/program already guarantees
--    on-chain.
alter table registro_assinaturas
  drop constraint if exists registro_assinaturas_hash_unique;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'registro_assinaturas_rede_hash_unique'
  ) then
    alter table registro_assinaturas
      add constraint registro_assinaturas_rede_hash_unique unique (rede, hash_sha256);
  end if;
end $$;

-- 4. registro_checkpoints.fonte gains 'solana-assinaturas' (the checkpoint
--    stores the last processed SLOT, in ultimo_bloco). No schema change: the
--    fonte column is free text and ultimo_bloco is bigint.
