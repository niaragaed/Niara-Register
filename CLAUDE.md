@AGENTS.md

## Language

English is the default for all new code, comments, docs, logs, commit messages and file names in this repository.

Kept in Portuguese on purpose (external interfaces):
- On-chain names: contracts, functions, events, errors and their fields (`RegistroAssinaturas`, `DocumentoRegistrado`, `OfertaCaptacao`, `Aporte`, `verificar`, ...), PDA seeds and program error names.
- Supabase table and column names (`registro_transacoes`, `registro_ofertas`, `registro_assinaturas`, `tipo_evento`, ...), the keys of the stored `dados` JSON, and values already stored in the database (`tipo_evento`, `descricao`, `fonte`, `status`, `origem`).
- The indexer's environment variable names (some are Portuguese, e.g. `SOLANA_DESATIVADO`), so existing deployments keep working.
- The Portuguese UI copy in `lib/i18n/dictionaries.ts` (the `pt` dictionary) and the old Portuguese route redirects in `next.config.ts`.
