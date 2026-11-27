-- Migration 016: Niara Exchange settlements (Global Registry).
--
-- An independent on-chain record of Niara Exchange settlements, written only
-- by the Register indexer (indexer/exchange-*.ts), which reads each network
-- directly: the `Settled` event of the niara_exchange program on Solana
-- devnet, and NiaraSettlement's `Settled` plus the CashbackDistributor's
-- `FeeRecorded` on the EVM testnets. Nothing here comes from the Exchange's
-- own database or API.
--
-- Run ONCE in the Supabase SQL Editor of the Register's project
-- (niara-register-dev), BEFORE deploying the indexer version with the
-- exchange sources. Idempotent. Cursors reuse registro_checkpoints
-- (fonte = 'exchange-<network>').

create table if not exists exchange_settlements (
  id bigint generated always as identity primary key,
  network text not null
    check (network in ('solana-devnet', 'base-sepolia', 'robinhood-testnet', 'tempo-testnet', 'hyperevm-testnet')),
  -- EVM: 0x-prefixed lowercase transaction hash. Solana: base58 signature.
  tx_hash text not null,
  -- EVM: the log's index in its block. Solana: position of the Settled event in the transaction.
  log_index integer not null check (log_index >= 0),
  block_number bigint,
  slot bigint,
  block_time timestamptz not null,
  -- The match UUID's 16 bytes, 32 lowercase hex characters.
  match_id text not null check (match_id ~ '^[0-9a-f]{32}$'),
  -- NiaraSettlement (EVM, lowercase) or the program id (Solana).
  contract_address text not null,
  asset_address text not null,
  -- From the token itself: ERC-20 symbol() / Token-2022 metadata. Null if it has none.
  asset_symbol text,
  asset_decimals smallint not null check (asset_decimals between 0 and 36),
  payment_address text not null,
  payment_symbol text,
  payment_decimals smallint not null check (payment_decimals between 0 and 36),
  -- Integers in base units (uint256 fits in numeric(78,0)).
  base_quantity numeric(78, 0) not null check (base_quantity > 0),
  -- base_quantity / 10^asset_decimals: one lot = one whole token (the lot size
  -- is an off-chain market parameter and is not on-chain).
  lots numeric not null,
  -- notional per lot, in payment base units.
  price numeric not null,
  -- What the buyer paid (the event's payment amount), fee included.
  notional numeric(78, 0) not null check (notional > 0),
  fee numeric(78, 0) not null check (fee >= 0 and fee <= notional),
  -- Share of the fee credited to the asset issuer.
  cashback numeric(78, 0) not null check (cashback >= 0 and cashback <= fee),
  buyer text not null,
  seller text not null,
  indexed_at timestamptz not null default now(),
  constraint exchange_settlements_network_tx_log_unique unique (network, tx_hash, log_index),
  constraint exchange_settlements_block_or_slot check (
    (network = 'solana-devnet' and slot is not null and block_number is null)
    or (network <> 'solana-devnet' and block_number is not null and slot is null)
  )
);

create index if not exists exchange_settlements_time_idx
  on exchange_settlements (block_time desc, id desc);
create index if not exists exchange_settlements_network_time_idx
  on exchange_settlements (network, block_time desc, id desc);

-- Public, read-only mirror (same rules as migration 013): anyone may read,
-- only the indexer (service role, which bypasses RLS) writes.
alter table exchange_settlements enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'exchange_settlements' and policyname = 'exchange_settlements_public_read'
  ) then
    create policy exchange_settlements_public_read
      on exchange_settlements for select to anon, authenticated using (true);
  end if;
end $$;

revoke insert, update, delete, truncate on exchange_settlements from anon, authenticated;

-- ── Single-instance lease ────────────────────────────────────────────────────────
-- Railway can run two replicas (and overlaps deployments): only the lease
-- holder runs the exchange sources. Internal: no access for the public roles.

create table if not exists exchange_indexer_lease (
  name text primary key,
  holder text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table exchange_indexer_lease enable row level security;
revoke all on exchange_indexer_lease from anon, authenticated;

-- Takes the lease if it is free or expired, or renews it for its holder.
-- Returns true when p_holder holds it until now() + p_ttl_seconds.
create or replace function exchange_indexer_try_lease(p_name text, p_holder text, p_ttl_seconds integer)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  taken boolean;
begin
  insert into exchange_indexer_lease as l (name, holder, expires_at, updated_at)
  values (p_name, p_holder, now() + make_interval(secs => p_ttl_seconds), now())
  on conflict (name) do update
    set holder = excluded.holder, expires_at = excluded.expires_at, updated_at = now()
    where l.holder = excluded.holder or l.expires_at < now()
  returning true into taken;
  return coalesce(taken, false);
end;
$$;

-- Frees the lease on shutdown, so the next deployment takes it at once.
create or replace function exchange_indexer_release_lease(p_name text, p_holder text)
returns void
language sql
set search_path = public
as $$
  delete from exchange_indexer_lease where name = p_name and holder = p_holder;
$$;

-- Functions in public are executable by PUBLIC by default: only the service role may call these.
revoke all on function exchange_indexer_try_lease(text, text, integer) from public, anon, authenticated;
revoke all on function exchange_indexer_release_lease(text, text) from public, anon, authenticated;
grant execute on function exchange_indexer_try_lease(text, text, integer) to service_role;
grant execute on function exchange_indexer_release_lease(text, text) to service_role;

-- Check after running:
--   select tablename, rowsecurity from pg_tables
--   where schemaname = 'public' and tablename like 'exchange_%' order by 1;
--   select has_function_privilege('anon', 'exchange_indexer_try_lease(text,text,integer)', 'execute');  -- false
