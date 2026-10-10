-- Migração 008: registro_assinaturas aceita a HyperEVM Testnet.
--
-- Rodar UMA vez no SQL Editor do Supabase (niara-register-dev) ANTES de
-- publicar o indexer com a fonte hyperevm-testnet. Idempotente.

alter table registro_assinaturas
  drop constraint if exists registro_assinaturas_rede_check;

alter table registro_assinaturas
  add constraint registro_assinaturas_rede_check
  check (rede in ('sepolia', 'base-sepolia', 'robinhood-testnet', 'hyperevm-testnet', 'solana-devnet'));

-- registro_checkpoints ganha a fonte 'hyperevm-testnet-assinaturas'. Sem
-- mudança de schema.
