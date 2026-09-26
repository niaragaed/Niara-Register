# Niara Register

Livro de registro de transações e assinaturas do Grupo Niara — o visual (fase atual do projeto) já está ligado à estrutura do Supabase, mesmo sem dados on-chain reais fluindo ainda.

## Rodando localmente

```bash
npm install
cp .env.local.example .env.local   # preencher com o projeto Supabase do Register (ex.: niara-register-dev)
npm run dev
```

## Idioma

O site é bilíngue com **inglês como padrão**. O idioma vem do cookie
`niara_locale` (`en` | `pt`), gravado pelo seletor EN·PT no cabeçalho; o
`Accept-Language` **não** é consultado, então quem chega sem cookie vê inglês.
As rotas são as mesmas nos dois idiomas. Todo texto visível fica em
`lib/i18n/dictionaries.ts` — o tipo sai do inglês e o português tem que
satisfazê-lo, então os dois não divergem sem quebrar o build.

As rotas em português (`/registro-pmes`, `/registro-global`, `/assinatura`)
respondem com 308 para as novas, em `next.config.ts`. Não remover sem dar tempo
de os links antigos saírem de circulação.

## Pendências

- **`tipo_documento` como select, não texto livre.** Hoje é um input aberto em
  `/signatures`, então o valor gravado on-chain é o que a pessoa digitou e a
  tradução na exibição depende de um mapa que cobre só os valores já vistos.
  Trocar por um select com códigos neutros (`nda`, `lease_agreement`,
  `minutes`, `articles_of_association`, `other` + texto livre para o `other`),
  traduzidos na exibição. Exige mudança no formulário e decisão sobre os
  registros já gravados.

## Áreas

- `/sme-registry` — lê a tabela `registro_transacoes` (fonte = `pmes`), indexada dos contratos reais do Niara-PMEs na Sepolia. Hoje mostra estado vazio até o indexer ser conectado.
- `/global-registry` — Niara Exchange. **Intencionalmente sem indexer ligado**: a Exchange só tem contratos deployados/testados localmente, sem transação real ainda. Não preencher com dados de demonstração aqui — só quando houver uso real.
- `/signatures` — cálculo de hash SHA-256 no navegador (já funcional, não simulado) + área de registro on-chain (desabilitada até o contrato `niara-contracts-Register` existir).

## Schema do Supabase e indexer

O schema canônico (com `log_index` e checkpoints, pra idempotência) está em
`supabase/schema.sql` — aplicar no projeto Supabase do Register antes de rodar
o indexer.

O indexer que popula `/sme-registry` de verdade — lendo eventos reais do
`niara-contracts-PMEs` na Sepolia via Alchemy — está em `indexer/` (worker de
longa duração, não serverless; ver `indexer/README.md` para rodar e hospedar).

## Design

Ver token system em `app/globals.css` (`@theme`): paleta sóbria (marinho/osso/bronze/musgo), serifada Fraunces para display, Inter para corpo, IBM Plex Mono para hashes/endereços. Sem gradientes, sem cards com sombra — layout de livro-razão com numeração sequencial real.
