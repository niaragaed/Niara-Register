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
- **`base-sepolia-assinaturas`** e **`robinhood-testnet-assinaturas`**:
  `DocumentoRegistrado` do mesmo `RegistroAssinaturas` na Base Sepolia e na
  Robinhood Chain Testnet. Ver seção abaixo.
- **`solana-assinaturas`** (Solana devnet): `DocumentoRegistrado` do programa
  `niara-register-solana` (`9RPHqLou…`). Ver seção abaixo.

A lista de ofertas vem do banco (`registro_ofertas`, migration 004), não de
variável de ambiente: as 11 legadas entram pelo seed da migration, as do
orquestrador pelo próprio indexer. `OFERTAS_ONCHAIN` não é mais lida.

Cada evento vira uma linha em `registro_transacoes`, idempotente por
`(tx_hash, log_index)` — pode cair e reiniciar sem duplicar nem perder nada.

### Consumo de RPC

Em regime normal, as três fontes estão no mesmo bloco e cada ciclo faz **uma**
chamada `eth_getLogs` com todos os endereços; os eventos são separados pelo
endereço e os três checkpoints são salvos juntos.

Uma fonte atrasada (a varredura inicial do orquestrador, ou um backfill) é
recuperada em chamadas próprias, **depois** do lote normal de cada ciclo: no
máximo `CHUNKS_ATRASO_POR_CICLO` chamadas, espaçadas por `ATRASO_INTERVALO_MS`.
Erro na recuperação não afeta o lote normal — os eventos novos continuam
entrando a cada ciclo, e a recuperação retoma do ponto salvo no ciclo seguinte.

Limite de taxa (HTTP 429 / "compute units per second"): o retry silencioso do
ethers está desligado; cada chamada ao RPC passa por `limite.ts`, que espera
1s, 2s, 4s… (teto 30s, até 6 tentativas) e registra uma linha de log a cada
espera. Esgotadas as tentativas, só aquela parte do ciclo é abortada.

## Redes EVM adicionais (`evm-assinaturas.ts`)

O mesmo `RegistroAssinaturas` (`0x5627…d93a`) em **Base Sepolia**,
**Robinhood Chain Testnet** (chain ID 46630) e **HyperEVM Testnet** (chain ID 998). Cada rede tem
provider próprio (sem o retry silencioso do ethers), checkpoint próprio
(`<rede>-assinaturas`) e laço próprio, em paralelo à Sepolia e à Solana. Por
ciclo: do checkpoint até `topo − confirmações`, em pedaços, até 20 pedaços;
checkpoint salvo a cada pedaço. A data vem do campo `timestamp` do próprio
evento.

| Rede | RPC padrão | Pedaço | Confirmações | Migration |
|---|---|---|---|---|
| `base-sepolia` | `https://sepolia.base.org` (limite de 200 blocos por `eth_getLogs`) | 200 | 5 | 006 |
| `robinhood-testnet` | `https://rpc.testnet.chain.robinhood.com` | 2000 | 20 (blocos de ~250 ms) | 007 |
| `hyperevm-testnet` | `https://rpc.hyperliquid-testnet.xyz/evm` (limite de 50 blocos por `eth_getLogs` e de taxa por IP; 1 s entre pedaços) | 50 | 2 | 008 |

Rodar a migration da rede **antes** de publicar o indexer com ela.

Variáveis por rede, com prefixo `BASE_`, `ROBINHOOD_` ou `HYPEREVM_`:
`REGISTRO_ASSINATURAS_ENDERECO`, `START_BLOCK`, `BLOCK_RANGE_CHUNK`,
`PEDACOS_POR_CICLO`, `INTERVALO_PEDACOS_MS`, `CONFIRMACOES`, `POLL_INTERVAL_MS`, `DESATIVADO=1`.
RPC: `BASE_SEPOLIA_RPC_URL` / `ROBINHOOD_RPC_URL` / `HYPEREVM_RPC_URL`.

## Fonte Solana (`solana.ts`)

Laço próprio, em paralelo ao lote EVM — erro ou lentidão de um RPC nunca atrasa
o outro, e um erro na Solana nunca derruba o processo. A cada
`SOLANA_POLL_INTERVAL_MS`:

1. `getSignaturesForAddress(programa)` (commitment `finalized`) até o slot do
   checkpoint `solana-assinaturas`;
2. para cada transação bem-sucedida, extrai `DocumentoRegistrado` dos logs —
   **só** quando o `Program data:` foi emitido dentro do frame do nosso
   programa (pilha de `invoke`), então outro programa não forja linha citando
   nosso endereço;
3. confere o evento contra a conta PDA `["assinatura", hash]` e grava o que
   está **na conta** em `registro_assinaturas`, com `rede = 'solana-devnet'`,
   `slot`, `bloco = null`, hash `0x…` (mesmo formato da Sepolia);
4. salva o checkpoint com o maior slot processado.

Idempotente por `(rede, hash_sha256)` — exige a
`supabase/migrations_005_assinaturas_multichain.sql`. **Ordem de deploy:**
rodar a migration 005 no Supabase **antes** de publicar este indexer (o upsert
da Sepolia também passou a usar `rede,hash_sha256`).

| Variável | Padrão | |
|---|---|---|
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | RPC público tem limite baixo; Helius/QuickNode free é melhor |
| `SOLANA_PROGRAM_ID` | `9RPHqLouFjoUbPdcmA1GyHMeDoWvjZMuCyYFPBWLmTcR` | |
| `SOLANA_START_SLOT` | `509235000` | slot do deploy; início sem checkpoint |
| `SOLANA_POLL_INTERVAL_MS` | `30000` | |
| `SOLANA_DESATIVADO` | — | `1` desliga só a fonte Solana |

## Teste

`npm run teste` roda `teste/atraso.teste.ts`, `teste/solana.teste.ts` e `teste/base.teste.ts`. O da
Solana testa offline a decodificação e a atribuição de eventos (evento forjado
por outro programa é ignorado) e depois roda um ciclo contra a devnet real com
banco em memória (`SOLANA_TESTE_REDE=0` pula essa parte).

`teste/atraso.teste.ts`: RPC, tokens e banco falsos, em
memória — não usa rede nem o Supabase. Simula uma recuperação longa com 429
intermitente e uma rajada que esgota o backoff, e verifica que o lote normal
grava eventos novos durante a recuperação e que, ao fim, não há lacuna nem
duplicata.

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
| `CHUNKS_ATRASO_POR_CICLO` | `60` | teto de chamadas por ciclo para atraso e backfill |
| `ATRASO_INTERVALO_MS` | `300` | pausa entre chamadas de atraso (~3/s, ~250 CU/s) |
| `BACKOFF_TENTATIVAS` / `BACKOFF_BASE_MS` / `BACKOFF_TETO_MS` | `6` / `1000` / `30000` | backoff em 429 |
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
