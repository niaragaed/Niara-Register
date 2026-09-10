# Niara-Register — Indexer (Registro PMEs)

Worker de longa duração que lê eventos reais do `niara-contracts-PMEs` na Sepolia
(via Alchemy) e grava no Postgres do Niara-Register. Não é a fonte de verdade —
só espelha o que já aconteceu on-chain.

## O que ele indexa

Escuta os endereços de `OfertaCaptacao` (as ofertas reais já configuradas no
Vercel do niara-PMEs, `NEXT_PUBLIC_OFERTAS_ONCHAIN`) e decodifica estes eventos
(ver `niara-contracts-PMEs/src/captacao/OfertaCaptacao.sol`):

- `Aporte` — investimento de um investidor
- `OfertaEncerrada` — oferta encerrada (sucesso ou falha na meta)
- `OfertaCancelada`
- `CotasResgatadas` — resgate de cotas
- `RecursosLiberados` — recursos liberados ao emissor
- `Reembolso`

Cada evento vira uma linha em `registro_transacoes`, idempotente por
`(tx_hash, log_index)` — pode cair e reiniciar sem duplicar nem perder nada,
o checkpoint em `registro_checkpoints` garante a retomada correta.

## Rodando

```bash
cd indexer
npm install
cp .env.example .env
# preencher .env com: ALCHEMY_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
# OFERTAS_ONCHAIN (mesmos valores do Vercel do niara-PMEs)
npm start
```

Antes de rodar, aplicar `../supabase/schema.sql` no projeto Supabase do Register
(SQL editor do Supabase, ou `supabase db push` se estiver usando a CLI).

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

`POLL_INTERVAL_MS` (padrão 15s) — não precisa ser agressivo, a Sepolia produz
um bloco a cada ~12s e o Register não tem requisito de tempo real.

## Extensões futuras (fora do escopo desta primeira versão)

- Indexar `EmissaoGateway` (mint de cotas) e `LiquidacaoSecundaria` (mercado
  secundário) — mesma lógica, ABI e endereço diferentes
- Área "Registro Global" (Exchange) — aguardando a Exchange ter transações
  reais na Sepolia antes de escrever qualquer indexer pra ela (ver
  `app/registro-global/page.tsx` no site)
