-- Migração 009: registro_assinaturas aceita a Tempo Testnet (Moderato).
--
-- Rodar UMA vez no SQL Editor do Supabase (niara-register-dev) ANTES de
-- publicar o indexer com a fonte tempo-testnet. Idempotente.

alter table registro_assinaturas
  drop constraint if exists registro_assinaturas_rede_check;

alter table registro_assinaturas
  add constraint registro_assinaturas_rede_check
  check (rede in ('sepolia', 'base-sepolia', 'robinhood-testnet', 'hyperevm-testnet', 'tempo-testnet', 'solana-devnet'));

-- registro_checkpoints ganha a fonte 'tempo-testnet-assinaturas'. Sem
-- mudança de schema.
