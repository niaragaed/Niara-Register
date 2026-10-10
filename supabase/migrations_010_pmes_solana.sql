-- Migração 010: o livro do Niara-PMEs (registro_transacoes, fonte 'pmes') e o
-- catálogo de ofertas (registro_ofertas) passam a receber também o Niara-PMEs
-- na Solana devnet (programa niara-pmes-solana, niaragaed/niara-pmes-solana).
--
-- Rodar UMA vez no SQL Editor do Supabase (projeto niara-register-dev) ANTES de
-- publicar o indexer com a fonte pmes-solana. Idempotente: pode rodar de novo.
--
-- 1. registro_transacoes: coluna `rede` (toda linha existente é da Sepolia),
--    `slot` da Solana e `bloco` passa a aceitar null (não existe bloco EVM lá).
-- 2. registro_ofertas: coluna `rede`; os CHECKs de minúsculas valem só para a
--    Sepolia (base58 diferencia maiúsculas); origem ganha 'solana'; e o número
--    da oferta passa a ser único POR REDE — a Solana tem numeração própria
--    (oferta 1, 2… da Solana), e os dois laços do indexador nunca disputam número.

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

-- 3. checkpoint da nova fonte: registro_checkpoints.fonte ganha 'pmes-solana' (o
--    último SLOT processado, em ultimo_bloco). Sem mudança de schema.
