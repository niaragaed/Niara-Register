-- Migração 007: registro_assinaturas aceita a Robinhood Chain Testnet.
--
-- Rodar UMA vez no SQL Editor do Supabase (niara-register-dev) ANTES de
-- publicar o indexer com a fonte robinhood-testnet. Idempotente.

alter table registro_assinaturas
  drop constraint if exists registro_assinaturas_rede_check;

alter table registro_assinaturas
  add constraint registro_assinaturas_rede_check
  check (rede in ('sepolia', 'base-sepolia', 'robinhood-testnet', 'solana-devnet'));

-- registro_checkpoints ganha a fonte 'robinhood-testnet-assinaturas' (último
-- bloco processado). Sem mudança de schema.
