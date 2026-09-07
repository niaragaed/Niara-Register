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

## Schema esperado no Supabase (próximo passo — indexer)

```sql
create table registro_transacoes (
  id uuid primary key default gen_random_uuid(),
  numero_sequencial serial,
  fonte text check (fonte in ('pmes', 'exchange')) not null,
  tipo_evento text not null,
  descricao text not null,
  tx_hash text not null,
  endereco_contrato text not null,
  bloco integer not null,
  ocorrido_em timestamptz not null,
  confirmado boolean not null default false
);

create table registro_assinaturas (
  id uuid primary key default gen_random_uuid(),
  documento_nome text not null,
  hash_sha256 text not null,
  assinante_endereco text,
  tx_hash text,
  assinado_em timestamptz,
  status text check (status in ('pendente', 'assinado_onchain')) not null default 'pendente'
);
```

Este banco deve ser um projeto Supabase **próprio do Register** (ex. `niara-register-dev`), separado do `niara-pmes-dev` — o Register é um indexador, não a fonte de verdade.

## Design

Ver token system em `app/globals.css` (`@theme`): paleta sóbria (marinho/osso/bronze/musgo), serifada Fraunces para display, Inter para corpo, IBM Plex Mono para hashes/endereços. Sem gradientes, sem cards com sombra — layout de livro-razão com numeração sequencial real.
