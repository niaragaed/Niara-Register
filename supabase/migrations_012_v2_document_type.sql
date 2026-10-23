-- Public document type for v2 records (fixed list, see lib/document-types.ts).
--
-- The code comes from the chain: SignatureRegistryV2.register(..., documentType, ...)
-- on EVM and register_v2(..., document_type, ...) on Solana. Only the type is
-- public; the document name stays inside the salted metadata commitment.
--
-- The table has no rows yet (the indexer only writes v2 rows once the new
-- registries are live), so the column can be NOT NULL straight away.
-- integer, not smallint: the on-chain field is a u16 (up to 65535).
alter table registro_assinaturas_v2
  add column if not exists tipo_documento integer not null
    check (tipo_documento between 1 and 65535);
