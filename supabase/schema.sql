-- Schema do Niara-Register — projeto Supabase PRÓPRIO do Register (ex.: niara-register-dev),
-- separado do niara-pmes-dev. O Register é um indexador: espelha o que já aconteceu on-chain,
-- nunca é a fonte de verdade.

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
  -- garante idempotência: se o indexer reprocessar um range de blocos já gravado
  -- (ex.: depois de cair e reiniciar), não duplica a linha no ledger.
  constraint registro_transacoes_tx_log_unique unique (tx_hash, log_index)
);

create index if not exists registro_transacoes_fonte_idx
  on registro_transacoes (fonte, numero_sequencial desc);

-- Guarda até onde cada fonte (pmes / exchange) já foi processada, pra o worker
-- retomar do ponto certo depois de reiniciar, sem reescanear tudo nem perder eventos.
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
