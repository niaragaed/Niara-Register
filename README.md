# Niara Register

Livro de registro de transações e assinaturas do Grupo Niara — o visual (fase atual do projeto) já está ligado à estrutura do Supabase, mesmo sem dados on-chain reais fluindo ainda.

## Rodando localmente

```bash
npm install
cp .env.local.example .env.local   # preencher com o projeto Supabase do Register (ex.: niara-register-dev)
npm run dev
```

## Áreas

- `/registro-pmes` — lê a tabela `registro_transacoes` (fonte = `pmes`), indexada dos contratos reais do Niara-PMEs na Sepolia. Hoje mostra estado vazio até o indexer ser conectado.
- `/registro-global` — Niara Exchange. **Intencionalmente sem indexer ligado**: a Exchange só tem contratos deployados/testados localmente, sem transação real ainda. Não preencher com dados de demonstração aqui — só quando houver uso real.
- `/assinatura` — cálculo de hash SHA-256 no navegador (já funcional, não simulado) + área de registro on-chain (desabilitada até o contrato `niara-contracts-Register` existir).

## Schema do Supabase e indexer

O schema canônico (com `log_index` e checkpoints, pra idempotência) está em
`supabase/schema.sql` — aplicar no projeto Supabase do Register antes de rodar
o indexer.

O indexer que popula `/registro-pmes` de verdade — lendo eventos reais do
`niara-contracts-PMEs` na Sepolia via Alchemy — está em `indexer/` (worker de
longa duração, não serverless; ver `indexer/README.md` para rodar e hospedar).

## Design

Ver token system em `app/globals.css` (`@theme`): paleta sóbria (marinho/osso/bronze/musgo), serifada Fraunces para display, Inter para corpo, IBM Plex Mono para hashes/endereços. Sem gradientes, sem cards com sombra — layout de livro-razão com numeração sequencial real.
