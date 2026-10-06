# Niara-Register — Indexer (Registro PMEs)

Worker de longa duração que lê eventos reais do `niara-contracts-PMEs` na Sepolia
(via Alchemy) e grava no Postgres do Niara-Register. Não é a fonte de verdade —
só espelha o que já aconteceu on-chain.

## O que ele indexa

Três fontes, cada uma com checkpoint próprio em `registro_checkpoints`:

- **`pmes`**: eventos das `OfertaCaptacao` listadas em `registro_ofertas`
  (ver `niara-contracts-PMEs/src/captacao/OfertaCaptacao.sol`): `Aporte`,
  `OfertaEncerrada`, `OfertaCancelada`, `CotasResgatadas`, `RecursosLiberados`,
  `Reembolso`.
- **`orquestrador`**: `OfertaCompletaCriada` do `OfertaOrquestrador` (criação
  self-service, `src/orquestracao/OfertaOrquestrador.sol`). Cada oferta nova é
  gravada em `registro_ofertas` com o próximo número (12, 13… na ordem de
  criação), vira uma linha "Oferta criada" no ledger e entra no lote da fonte
  `pmes`; os eventos dela anteriores a isso são buscados por um backfill, que
  guarda o progresso na própria tabela e retoma se o processo cair.
- **`assinaturas`**: `DocumentoRegistrado` do `RegistroAssinaturas`.

A lista de ofertas vem do banco (`registro_ofertas`, migration 004), não de
variável de ambiente: as 11 legadas entram pelo seed da migration, as do
orquestrador pelo próprio indexer. `OFERTAS_ONCHAIN` não é mais lida.

Cada evento vira uma linha em `registro_transacoes`, idempotente por
`(tx_hash, log_index)` — pode cair e reiniciar sem duplicar nem perder nada.

### Consumo de RPC

Em regime normal, as três fontes estão no mesmo bloco e cada ciclo faz **uma**
chamada `eth_getLogs` com todos os endereços; os eventos são separados pelo
endereço e os três checkpoints são salvos juntos. Uma fonte atrasada (a
varredura inicial do orquestrador, ou um backfill) é recuperada em chamadas
próprias, no máximo `CHUNKS_ATRASO_POR_CICLO` por ciclo.

## Rodando

```bash
cd indexer
npm install
cp .env.example .env
# preencher .env com: ALCHEMY_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
npm start
```

Antes de rodar, aplicar `../supabase/schema.sql` e as migrations
`../supabase/migrations_00*.sql` no projeto Supabase do Register (SQL editor do
Supabase). Sem a 004 o indexer não inicia: a lista de ofertas está nela.

### Dry-run

`npx tsx index.ts --dry-run` (ou `DRY_RUN=1`) lê a chain e o banco de verdade,
mas não grava nada, nem checkpoint. Roda até alcançar a chain e imprime as
ofertas e as linhas que seriam inseridas, com a conferência por oferta (aportes
= total encerrado = valor ao emissor + taxa).

### Variáveis opcionais

| Variável | Padrão | |
|---|---|---|
| `POLL_INTERVAL_MS` | `30000` | intervalo entre ciclos |
| `BLOCK_RANGE_CHUNK` | `500` | blocos por `eth_getLogs` (10 no plano free da Alchemy) |
| `CHUNKS_ATRASO_POR_CICLO` | `200` | teto de chamadas por ciclo para atraso e backfill |
| `START_BLOCK` | `0` | início da fonte `pmes` sem checkpoint |
| `ORQUESTRADOR_ENDERECO` / `START_BLOCK_ORQUESTRADOR` | `0xde9c…96e5` / `11733723` | |
| `REGISTRO_ASSINATURAS_ENDERECO` / `START_BLOCK_ASSINATURAS` | `0x5627…d93a` / `11691290` | |

## Operação contínua (produção)

Este processo precisa ficar sempre rodando (`while (true)` com polling) — não é
serverless/cron. Não roda no Vercel (que não suporta processo de longa duração).
Opções pra hospedar:

- **Railway** ou **Render** (worker service, mais simples de configurar)
- **Fly.io** (`fly launch` com um `Dockerfile` mínimo — não incluído ainda)
- VM própria com `systemd` ou `pm2` reiniciando o processo se cair

Qualquer que seja a opção, configurar as mesmas variáveis do `.env` no ambiente
do serviço, e apontar `npm start` como comando de execução.

## Ajustar o intervalo de polling

`POLL_INTERVAL_MS` (padrão 30s) — não precisa ser agressivo, a Sepolia produz
um bloco a cada ~12s e o Register não tem requisito de tempo real. Cada ciclo
custa uma chamada `eth_getLogs` (mais um `eth_blockNumber`), então o intervalo
é o que define o consumo mensal da Alchemy.

## Extensões futuras (fora do escopo desta primeira versão)

- Indexar `EmissaoGateway` (mint de cotas) e `LiquidacaoSecundaria` (mercado
  secundário) — mesma lógica, ABI e endereço diferentes
- Área "Registro Global" (Exchange) — aguardando a Exchange ter transações
  reais na Sepolia antes de escrever qualquer indexer pra ela (ver
  `app/registro-global/page.tsx` no site)
