-- Migration: adds the columns the indexer needs to fill registro_assinaturas
-- from the RegistroAssinaturas events, plus an idempotency constraint. Run once
-- in the Supabase SQL Editor (project niara-register-dev).

alter table registro_assinaturas
  add column if not exists tipo_documento text;

alter table registro_assinaturas
  add column if not exists log_index integer;

alter table registro_assinaturas
  add column if not exists endereco_contrato text;

alter table registro_assinaturas
  add column if not exists bloco integer;

-- A hash can only be recorded once in the contract (it rejects duplicates
-- itself); we mirror that guarantee here so the indexer never duplicates a row
-- if it reprocesses the same block range.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'registro_assinaturas_hash_unique'
  ) then
    alter table registro_assinaturas
      add constraint registro_assinaturas_hash_unique unique (hash_sha256);
  end if;
end $$;
