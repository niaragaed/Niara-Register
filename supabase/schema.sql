-- Niara-Register schema: the Register's OWN Supabase project (e.g. niara-register-dev),
-- separate from niara-pmes-dev. The Register is an indexer: it mirrors what already happened
-- on-chain and is never the source of truth. Table and column names are kept as they are.

create table if not exists registro_transacoes (
  id uuid primary key default gen_random_uuid(),
  numero_sequencial serial,
  fonte text check (fonte in ('pmes', 'exchange')) not null,
  tipo_evento text not null,
  descricao text not null,
  tx_hash text not null,
  log_index integer not null default 0,
  endereco_contrato text not null,
  bloco integer not null,
  ocorrido_em timestamptz not null,
  confirmado boolean not null default false,
  -- guarantees idempotency: if the indexer reprocesses an already written block
  -- range (e.g. after crashing and restarting), it does not duplicate the ledger row.
  constraint registro_transacoes_tx_log_unique unique (tx_hash, log_index)
);

create index if not exists registro_transacoes_fonte_idx
  on registro_transacoes (fonte, numero_sequencial desc);

-- Stores how far each source (pmes / exchange) has been processed, so the worker
-- resumes from the right point after a restart, without rescanning everything or
-- missing events.
create table if not exists registro_checkpoints (
  fonte text primary key,
  ultimo_bloco bigint not null,
  atualizado_em timestamptz not null default now()
);

create table if not exists registro_assinaturas (
  id uuid primary key default gen_random_uuid(),
  documento_nome text not null,
  hash_sha256 text not null,
  assinante_endereco text,
  tx_hash text,
  assinado_em timestamptz,
  status text check (status in ('pendente', 'assinado_onchain')) not null default 'pendente'
);
