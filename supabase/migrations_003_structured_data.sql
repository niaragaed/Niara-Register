-- Migration: adds the `dados` (jsonb) column to registro_transacoes, with the
-- structured form of each event. Run once in the Supabase SQL Editor (project
-- niara-register-dev).
--
-- WHY: until now, the only information about amount, offering and addresses
-- was inside the `descricao` string, written in Portuguese by the indexer. That
-- left the English version of the site with no way to say how much, in which
-- offering and by whom: only the event label was left. With `dados`, each
-- language builds its own sentence.
--
-- The column is NULLABLE on purpose: rows already written stay null until the
-- backfill (indexer/scripts/backfill-data.ts) fills them, and the display has a
-- fallback for that case. `descricao` still exists and is still written, with
-- no change: nothing that depends on it breaks.
--
-- CONTENT: neutral values only. Addresses, numbers as strings (with 18
-- decimals, already converted from wei) and English codes. No Portuguese text.
-- The jsonb keys themselves (ofertaNumero, valor, ...) are the stored format.
--
-- Shape per event (the `evento` field is the discriminator):
--
--   investment          { evento, ofertaNumero, ofertaEndereco, investidor,
--                         valor, moeda, totalArrecadadoAtual }
--   offering_closed     { evento, ofertaNumero, ofertaEndereco,
--                         desfecho: 'success'|'failure'|'unknown',
--                         totalArrecadado, moeda }
--   offering_cancelled  { evento, ofertaNumero, ofertaEndereco }
--   shares_redeemed     { evento, ofertaNumero, ofertaEndereco, investidor, cotas }
--   funds_released      { evento, ofertaNumero, ofertaEndereco, emissor,
--                         valorEmissor, protocolo, taxa, moeda }
--   refund              { evento, ofertaNumero, ofertaEndereco, investidor,
--                         valor, moeda }
--
-- The matching TypeScript type is in indexer/events.ts (producer) and
-- lib/event-data.ts (consumer, on the site).

alter table registro_transacoes
  add column if not exists dados jsonb;

-- Partial index: the queries that matter are "rows still without dados" (the
-- backfill) and, later, filters by event type. The partial index stays small
-- because it shrinks as the backfill moves on.
create index if not exists registro_transacoes_dados_nulos
  on registro_transacoes (numero_sequencial)
  where dados is null;

-- Check query after running (should list the rows without dados):
--   select numero_sequencial, tipo_evento, dados is null as sem_dados
--   from registro_transacoes
--   order by numero_sequencial desc;
