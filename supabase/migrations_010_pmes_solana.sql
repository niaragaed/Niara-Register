-- Migration 010: the Niara-PMEs ledger (registro_transacoes, fonte 'pmes') and
-- the offering catalog (registro_ofertas) also start receiving Niara-PMEs on
-- Solana devnet (program niara-pmes-solana, niaragaed/niara-pmes-solana).
--
-- Run ONCE in the Supabase SQL Editor (project niara-register-dev) BEFORE
-- publishing the indexer with the pmes-solana source. Idempotent: it can run again.
--
-- 1. registro_transacoes: a `rede` column (every existing row is from
--    Sepolia), the Solana `slot`, and `bloco` accepts null (there is no EVM
--    block there).
-- 2. registro_ofertas: a `rede` column; the lowercase CHECKs only apply to
--    Sepolia (base58 is case-sensitive); origem gains 'solana'; and the
--    offering number becomes unique PER NETWORK: Solana has its own numbering
--    (Solana offering 1, 2…), and the indexer's two loops never compete for a
--    number.

-- 1. registro_transacoes ------------------------------------------------------------
alter table registro_transacoes
  add column if not exists rede text not null default 'sepolia';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'registro_transacoes_rede_check') then
    alter table registro_transacoes
      add constraint registro_transacoes_rede_check check (rede in ('sepolia', 'solana-devnet'));
  end if;
end $$;

alter table registro_transacoes add column if not exists slot bigint;
alter table registro_transacoes alter column bloco drop not null;

-- 2. registro_ofertas ---------------------------------------------------------------
alter table registro_ofertas
  add column if not exists rede text not null default 'sepolia';

alter table registro_ofertas
  drop constraint if exists registro_ofertas_endereco_check,
  drop constraint if exists registro_ofertas_token_check,
  drop constraint if exists registro_ofertas_emissor_check,
  drop constraint if exists registro_ofertas_moeda_check,
  drop constraint if exists registro_ofertas_origem_check,
  drop constraint if exists registro_ofertas_numero_key;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'registro_ofertas_rede_check') then
    alter table registro_ofertas
      add constraint registro_ofertas_rede_check check (rede in ('sepolia', 'solana-devnet')),
      add constraint registro_ofertas_enderecos_minusculos check (
        rede <> 'sepolia'
        or (endereco = lower(endereco) and token = lower(token) and emissor = lower(emissor) and moeda = lower(moeda))
      ),
      add constraint registro_ofertas_origem_check_v2 check (
        (rede = 'sepolia' and origem in ('legado', 'orquestrador'))
        or (rede = 'solana-devnet' and origem = 'solana')
      ),
      add constraint registro_ofertas_rede_numero_unique unique (rede, numero);
  end if;
end $$;

-- 3. checkpoint of the new source: registro_checkpoints.fonte gains
--    'pmes-solana' (the last processed SLOT, in ultimo_bloco). No schema change.
