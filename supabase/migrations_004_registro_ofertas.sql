-- Migração: tabela registro_ofertas — a lista de ofertas que o indexer monitora
-- passa a viver no banco, não numa env var + mapa fixo em indexer/config.ts.
-- Rodar uma vez no SQL Editor do Supabase (projeto niara-register-dev).
--
-- POR QUÊ: as ofertas self-service criadas pelo OfertaOrquestrador
-- (0xde9cC84d1300b57F640f2d1862900393b82796e5, Sepolia) nascem a qualquer
-- momento, sem passar pela plataforma. O indexer as descobre pelo evento
-- OfertaCompletaCriada e grava aqui; ao reiniciar, carrega a lista daqui.
--
-- NUMERAÇÃO: as 11 legadas mantêm 1–11 (os mesmos números que já estão em
-- `dados.ofertaNumero` e na `descricao` das linhas gravadas). As do
-- orquestrador recebem 12, 13… na ordem (bloco, log_index) do evento de
-- criação, atribuídos pelo indexer uma única vez; `numero` é unique e nunca é
-- reescrito.
--
-- Todos os valores do seed abaixo foram lidos da chain em 2026-10-04
-- (token(), emissorWallet(), moeda() da oferta; name()/symbol()/empresa() do
-- token; bloco de criação = primeiro bloco com código no endereço).

create table if not exists registro_ofertas (
  -- sempre minúsculo, para casar com o que o indexer compara
  endereco text primary key check (endereco = lower(endereco)),
  token text not null check (token = lower(token)),
  emissor text not null check (emissor = lower(emissor)),
  -- token de pagamento declarado pela própria oferta (moeda()). As legadas usam
  -- um MockBRL, as do orquestrador outro.
  moeda text not null check (moeda = lower(moeda)),
  origem text not null check (origem in ('legado', 'orquestrador')),
  numero integer not null unique check (numero > 0),
  -- name() e symbol() do ParticipacaoToken; empresa() idem. Nullable: um token
  -- futuro pode não expor empresa().
  nome text,
  simbolo text,
  empresa text,
  bloco_criacao bigint not null,
  criada_em timestamptz not null,
  -- só para origem = 'orquestrador': tx do OfertaCompletaCriada
  tx_criacao text,
  -- Backfill dos eventos da oferta (só origem = 'orquestrador'). Ao ser
  -- descoberta, a oferta entra no lote normal da fonte pmes a partir do
  -- checkpoint pmes daquele momento (backfill_alvo); os blocos anteriores,
  -- desde bloco_criacao, são varridos pelo backfill, que registra o progresso
  -- em backfill_ate. Concluído quando backfill_ate >= backfill_alvo. Se o
  -- indexer cair no meio, retoma daqui ao reiniciar.
  backfill_alvo bigint,
  backfill_ate bigint,
  registrada_em timestamptz not null default now()
);

create index if not exists registro_ofertas_backfill_pendente
  on registro_ofertas (bloco_criacao)
  where backfill_alvo is not null
    and (backfill_ate is null or backfill_ate < backfill_alvo);

-- Leitura pública (o site lê com a anon key para mostrar número e empresa);
-- escrita só pela service role do indexer, que ignora RLS.
alter table registro_ofertas enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'registro_ofertas' and policyname = 'registro_ofertas_leitura_publica'
  ) then
    create policy registro_ofertas_leitura_publica
      on registro_ofertas for select
      to anon, authenticated
      using (true);
  end if;
end $$;

-- Seed: as 11 ofertas legadas, com os números já usados no ledger.
insert into registro_ofertas
  (endereco, token, emissor, moeda, origem, numero, nome, simbolo, empresa, bloco_criacao, criada_em)
values
  ('0xd4ac69a4c7bfdc5e85c0e0da76ce12a1552b2704', '0x4dddd5def833f9ad3f6f714661a55fdc0d71d18d', '0x0d41059ebde70a46eb5207af0837921594cafc05', '0xb99dda4e4d89f40324a7831970b8f37dbc35668f', 'legado',  1, 'Oferta Niara PMEs Demo', 'nPME', 'Empresa Demo Niara PMEs Ltda', 11496281, '2026-08-15T19:43:36Z'),
  ('0xcb5b8d945996114f781dd729f229638192d18258', '0x42b054aa3a6b4eb4fded2e81e145c4c30268494b', '0x0d41059ebde70a46eb5207af0837921594cafc05', '0xb99dda4e4d89f40324a7831970b8f37dbc35668f', 'legado',  2, 'Oferta Niara PMEs Demo', 'nPME', 'Empresa Demo Niara PMEs Ltda', 11496283, '2026-08-15T19:44:00Z'),
  ('0xdd9a14c221c6d9e2cf33c56d8a4bf7c8bdfaf938', '0xdb7c0a4059384b6dd36354b6897419d968b739be', '0x0d41059ebde70a46eb5207af0837921594cafc05', '0xb99dda4e4d89f40324a7831970b8f37dbc35668f', 'legado',  3, 'Oferta Niara PMEs Demo', 'nPME', 'Empresa Demo Niara PMEs Ltda', 11496286, '2026-08-15T19:44:36Z'),
  ('0x29f10569644871bcd57e442e8802434d963688d9', '0x4f92299b02a677b4b9888da16096763c2d60f1d8', '0x0d41059ebde70a46eb5207af0837921594cafc05', '0xb99dda4e4d89f40324a7831970b8f37dbc35668f', 'legado',  4, 'Oferta Niara PMEs Demo', 'nPME', 'Empresa Demo Niara PMEs Ltda', 11496289, '2026-08-15T19:45:12Z'),
  ('0xfaa7946221f4a1d66c1b172bed79cf37ca003261', '0xa1a2c9f3877ddae6ec5dcede9cf00c3e4cd1a1f6', '0x0d41059ebde70a46eb5207af0837921594cafc05', '0xb99dda4e4d89f40324a7831970b8f37dbc35668f', 'legado',  5, 'Oferta Niara PMEs Demo', 'nPME', 'Empresa Demo Niara PMEs Ltda', 11496292, '2026-08-15T19:45:48Z'),
  ('0xa60119428905fdf66bf967de90a2f892985d99b2', '0x2fa50be34df5c123b4f12b1f12a79c3bc12f4b9d', '0x0d41059ebde70a46eb5207af0837921594cafc05', '0xb99dda4e4d89f40324a7831970b8f37dbc35668f', 'legado',  6, 'Oferta Niara PMEs Demo', 'nPME', 'Empresa Demo Niara PMEs Ltda', 11496294, '2026-08-15T19:46:12Z'),
  ('0xe4e7c347823f648abba73b31855e2fc1d7fe2fb1', '0x076f06668f04cf5bf7fb33a2aaafe58e72881dd9', '0x0d41059ebde70a46eb5207af0837921594cafc05', '0xb99dda4e4d89f40324a7831970b8f37dbc35668f', 'legado',  7, 'Oferta Niara PMEs Demo', 'nPME', 'Empresa Demo Niara PMEs Ltda', 11496297, '2026-08-15T19:46:48Z'),
  ('0x4378e93588603385b1a51b74c06c0a9fcfc66a16', '0x757534f9a0bfef76c1f8532a3561670f481dccc5', '0x0d41059ebde70a46eb5207af0837921594cafc05', '0xb99dda4e4d89f40324a7831970b8f37dbc35668f', 'legado',  8, 'Oferta Niara PMEs Demo', 'nPME', 'Empresa Demo Niara PMEs Ltda', 11496298, '2026-08-15T19:47:00Z'),
  ('0xd720e3e0f53b7ba278a2bee99da7f0edd1f14b9c', '0x944ad3048f9940f53ea68d6546fb7029afe70601', '0x0d41059ebde70a46eb5207af0837921594cafc05', '0xb99dda4e4d89f40324a7831970b8f37dbc35668f', 'legado',  9, 'Oferta Niara PMEs Demo', 'nPME', 'Empresa Demo Niara PMEs Ltda', 11496300, '2026-08-15T19:47:24Z'),
  ('0xaef8c045caabe0f283bd92893031f4f2644d534f', '0x466e066d155724b62e75de340cef7097d3996176', '0x0d41059ebde70a46eb5207af0837921594cafc05', '0xb99dda4e4d89f40324a7831970b8f37dbc35668f', 'legado', 10, 'Oferta Niara PMEs Demo', 'nPME', 'Empresa Demo Niara PMEs Ltda', 11496302, '2026-08-15T19:47:48Z'),
  ('0x7ea155f38acb1b7c119769a21988feeb21388e57', '0xef3c350d2c9c6aeab5ede2a86a54144aaed41775', '0x0d41059ebde70a46eb5207af0837921594cafc05', '0xb99dda4e4d89f40324a7831970b8f37dbc35668f', 'legado', 11, 'Oferta Niara PMEs Demo - Com Taxa', 'nTAXA', 'Empresa Demo Niara PMEs (Taxa) Ltda', 11622512, '2026-09-02T22:31:12Z')
on conflict (endereco) do nothing;

-- Moeda em `dados`: passa a ser o symbol() real do token de pagamento. As duas
-- MockBRL (a das legadas e a do orquestrador) têm symbol() = "mBRL"; "MockBRL"
-- era um literal do indexer, nunca o símbolo on-chain. Só o campo `moeda`
-- dentro de `dados` muda — `descricao` fica intocada. Só as linhas com
-- dados->>'moeda' = 'MockBRL' são tocadas (eventos sem valor monetário, como
-- shares_redeemed, não têm o campo). O site exibe "mBRL" como "MockBRL".
update registro_transacoes
set dados = jsonb_set(dados, '{moeda}', '"mBRL"')
where dados->>'moeda' = 'MockBRL';

-- As ofertas do orquestrador NÃO entram no seed: o indexer as descobre pelo
-- evento, atribui o número e faz o backfill. Assim o caminho de descoberta é
-- exercitado desde a primeira execução e não há duas fontes de verdade.

-- Conferência depois de rodar:
--   -- 11 linhas, números 1–11
--   select numero, endereco, simbolo, origem, bloco_criacao
--   from registro_ofertas order by numero;
--   -- nenhuma linha com 'MockBRL'; as com moeda passam a 'mBRL'
--   select dados->>'moeda' as moeda, count(*)
--   from registro_transacoes group by 1;
