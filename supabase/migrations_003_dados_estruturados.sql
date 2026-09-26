-- Migração: adiciona a coluna `dados` (jsonb) em registro_transacoes, com a
-- forma estruturada de cada evento. Rodar uma vez no SQL Editor do Supabase
-- (projeto niara-register-dev).
--
-- POR QUÊ: até aqui, a única informação sobre valor, oferta e endereços estava
-- dentro da string `descricao`, escrita em português pelo indexer. Isso deixava
-- a versão em inglês do site sem como dizer quanto, em qual oferta e de quem —
-- restava só o rótulo do evento. Com `dados`, cada idioma monta a própria frase.
--
-- A coluna é NULLABLE de propósito: as linhas já gravadas ficam com null até o
-- backfill (indexer/scripts/backfill-dados.ts) preenchê-las, e a exibição tem
-- fallback para esse caso. `descricao` continua existindo e sendo gravada, sem
-- nenhuma mudança — nada que dependa dela quebra.
--
-- CONTEÚDO: só valores neutros. Endereços, números como string (com 18 casas,
-- já convertidos de wei) e códigos em inglês. Nenhum texto em português.
--
-- Forma por evento (campo `evento` é o discriminador):
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
-- O tipo TypeScript correspondente está em indexer/eventos.ts (produção) e
-- lib/dados-evento.ts (consumo no site).

alter table registro_transacoes
  add column if not exists dados jsonb;

-- Índice parcial: as consultas que interessam são "linhas ainda sem dados"
-- (o backfill) e, no futuro, filtros por tipo de evento. O parcial fica pequeno
-- porque some conforme o backfill avança.
create index if not exists registro_transacoes_dados_nulos
  on registro_transacoes (numero_sequencial)
  where dados is null;

-- Consulta de conferência depois de rodar (deve listar as linhas sem dados):
--   select numero_sequencial, tipo_evento, dados is null as sem_dados
--   from registro_transacoes
--   order by numero_sequencial desc;
