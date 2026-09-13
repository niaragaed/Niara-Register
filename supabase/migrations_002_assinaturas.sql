-- Migração: adiciona colunas necessárias para o indexer popular
-- registro_assinaturas a partir dos eventos do RegistroAssinaturas, mais
-- trava de idempotência. Rodar uma vez no SQL Editor do Supabase
-- (projeto niara-register-dev).

alter table registro_assinaturas
  add column if not exists tipo_documento text;

alter table registro_assinaturas
  add column if not exists log_index integer;

alter table registro_assinaturas
  add column if not exists endereco_contrato text;

alter table registro_assinaturas
  add column if not exists bloco integer;

-- Um hash só pode ser registrado uma vez no contrato (ele próprio rejeita
-- duplicata) — replicamos essa garantia aqui pra o indexer nunca duplicar
-- linha se reprocessar o mesmo range de blocos.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'registro_assinaturas_hash_unique'
  ) then
    alter table registro_assinaturas
      add constraint registro_assinaturas_hash_unique unique (hash_sha256);
  end if;
end $$;
