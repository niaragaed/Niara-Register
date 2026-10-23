-- Migration 011: v2 of the signature registry and the transferable records.
--
-- v2 stores no document name or type: only the record hash, the hash scheme,
-- a salted commitment to the metadata and the soulbound receipt id. It lives
-- in its own table so the v1 table (and its indexer) stays untouched.
--
-- Run ONCE in the Supabase SQL Editor (niara-register-dev) BEFORE enabling the
-- v2 sources of the indexer. Idempotent.

create table if not exists registro_assinaturas_v2 (
  id uuid primary key default gen_random_uuid(),
  rede text not null
    check (rede in ('sepolia', 'base-sepolia', 'robinhood-testnet', 'hyperevm-testnet', 'tempo-testnet', 'solana-devnet')),
  -- "0x" + 64 lowercase hex
  hash_registro text not null check (hash_registro ~ '^0x[0-9a-f]{64}$'),
  -- 0 = SHA-256 of a PAdES-signed PDF; 1 = salted SHA-256
  esquema_hash smallint not null check (esquema_hash in (0, 1)),
  compromisso_metadados text not null check (compromisso_metadados ~ '^0x[0-9a-f]{64}$'),
  assinante_endereco text not null,
  -- EVM: ERC-721 token id (decimal); Solana: cNFT asset id
  recibo_id text not null,
  tx_hash text not null,
  log_index integer not null,
  endereco_contrato text not null,
  bloco bigint,
  slot bigint,
  assinado_em timestamptz not null,
  criado_em timestamptz not null default now(),
  constraint registro_assinaturas_v2_rede_hash_unique unique (rede, hash_registro)
);

create index if not exists registro_assinaturas_v2_assinado_em_idx
  on registro_assinaturas_v2 (assinado_em desc);

create table if not exists registro_transferiveis_eventos (
  id uuid primary key default gen_random_uuid(),
  rede text not null
    check (rede in ('sepolia', 'base-sepolia', 'robinhood-testnet', 'hyperevm-testnet', 'tempo-testnet', 'solana-devnet')),
  -- EVM: token id as "0x" + 64 hex (= hash of the original document); Solana: record account
  registro text not null,
  tipo_evento text not null check (tipo_evento in (
    'emitido', 'controle_transferido', 'aditamento_proposto', 'aditamento_cancelado',
    'aditado', 'apresentado', 'extinto'
  )),
  dados jsonb not null default '{}'::jsonb,
  tx_hash text not null,
  log_index integer not null,
  endereco_contrato text not null,
  bloco bigint,
  slot bigint,
  ocorrido_em timestamptz,
  criado_em timestamptz not null default now(),
  constraint registro_transferiveis_eventos_unique unique (rede, tx_hash, log_index)
);

create index if not exists registro_transferiveis_eventos_registro_idx
  on registro_transferiveis_eventos (rede, registro);

-- Public read (the site uses the anon key); writes only with the service role
-- (the indexer), which bypasses RLS.
alter table registro_assinaturas_v2 enable row level security;
alter table registro_transferiveis_eventos enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'registro_assinaturas_v2' and policyname = 'registro_assinaturas_v2_leitura_publica') then
    create policy registro_assinaturas_v2_leitura_publica on registro_assinaturas_v2 for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'registro_transferiveis_eventos' and policyname = 'registro_transferiveis_eventos_leitura_publica') then
    create policy registro_transferiveis_eventos_leitura_publica on registro_transferiveis_eventos for select to anon, authenticated using (true);
  end if;
end $$;

-- registro_checkpoints gains the sources '<network>-v2' and 'solana-v2'. No schema change.
