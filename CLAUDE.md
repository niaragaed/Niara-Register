@AGENTS.md

## Language

English is the default for all new code, comments, docs, logs, commit messages and file names in this repository.

Kept in Portuguese on purpose (external interfaces):
- On-chain names: contracts, functions, events, errors and their fields (`RegistroAssinaturas`, `DocumentoRegistrado`, `OfertaCaptacao`, `Aporte`, `verificar`, ...), PDA seeds and program error names.
- Supabase table and column names (`registro_transacoes`, `registro_ofertas`, `registro_assinaturas`, `tipo_evento`, ...), the keys of the stored `dados` JSON, and values already stored in the database (`tipo_evento`, `descricao`, `fonte`, `status`, `origem`).
- The indexer's environment variable names (some are Portuguese, e.g. `SOLANA_DESATIVADO`), so existing deployments keep working.
- The Portuguese UI copy in `lib/i18n/dictionaries.ts` (the `pt` dictionary) and the old Portuguese route redirects in `next.config.ts`.

## v2 invariants

- `lib/commitments.ts` must stay byte-identical to `SignatureRegistryV2.sol`'s test and to the Solana program's recipes; `tests/commitments.test.ts` pins the reference values.
- The document, the salt and the name/type never leave the browser except in `POST /api/credentials`, which uses them once to check the on-chain commitments and stores nothing. Do not add logging there.
- Hand-encoded Solana instructions/accounts (`lib/register-v2-solana.ts`, `indexer/v2.ts`) follow `idl/niara_register_solana.json` in niara-register-solana; update both when the program interface changes.
- Describe transferable records as "aligned with MLETR", never "MLETR compliant".

## No AI attribution (hard rule)

Nothing in this repository credits an AI tool, anywhere:

- no `Co-Authored-By: Claude` or `Claude-Session:` trailers, and no "Generated with Claude Code"
  line, in commit messages;
- no AI tool as a commit author or committer: commits use the project identity
  (`git config user.name`/`user.email` = `Niara <niaragaed@gmail.com>`, set in every clone and
  environment before the first commit — some environments default to `Claude <noreply@anthropic.com>`);
- no "Generated with/by Claude Code" footer in pull request descriptions, comments, issues or files.

It's enforced in two layers: the versioned `.claude/settings.json` turns Claude Code's commit
and PR attribution off (`"attribution": {"commit": "", "pr": ""}`), and the `No AI attribution`
GitHub Actions check (`.github/workflows/no-ai-attribution.yml`) fails on any commit or pull
request description that carries it. Some hosted environments append a footer to PR
descriptions by themselves; if the check flags one, delete that line in the GitHub UI. The rule
applies to every Niara repository, including new ones: copy both files when creating a repo.

