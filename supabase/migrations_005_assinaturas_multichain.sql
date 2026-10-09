-- Migração 005: registro_assinaturas passa a guardar assinaturas de mais de
-- uma blockchain (Sepolia + Solana devnet, por enquanto).
--
-- Rodar UMA vez no SQL Editor do Supabase (projeto niara-register-dev)
-- ANTES de publicar o indexer com a fonte Solana — o indexer novo grava com
-- onConflict (rede, hash_sha256), que só existe depois desta migration.
--
-- Idempotente: pode rodar de novo sem efeito colateral.

-- 1. Rede de cada registro. Todas as linhas existentes são da Sepolia.
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

-- 2. Slot da Solana (equivalente ao bloco). `bloco` continua sendo da EVM.
alter table registro_assinaturas
  add column if not exists slot bigint;

-- 3. Unicidade passa a ser por rede: o mesmo documento pode ser registrado na
--    Sepolia E na Solana (são provas independentes), mas nunca duas vezes na
--    mesma rede — que é o que cada contrato/programa já garante on-chain.
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

-- 4. registro_checkpoints.fonte ganha 'solana-assinaturas' (o checkpoint
--    guarda o último SLOT processado, em ultimo_bloco). Sem mudança de schema:
--    a coluna fonte é texto livre e ultimo_bloco é bigint.
