/** SQLite schema. Derived tables are rebuilt from `events`; `events` and `blocks` are the only inputs. */
/** Bump when a derived table changes; the store drops derived tables and refolds the kept events on open. */
export const SCHEMA_VERSION = 4;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS blocks (height INTEGER PRIMARY KEY, hash TEXT NOT NULL, prev_hash TEXT NOT NULL, time INTEGER NOT NULL, source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id TEXT NOT NULL, log_index INTEGER NOT NULL, ord INTEGER NOT NULL,
  block_height INTEGER NOT NULL, block_hash TEXT NOT NULL, time INTEGER NOT NULL,
  contract TEXT NOT NULL, kind TEXT NOT NULL, event TEXT NOT NULL, data TEXT NOT NULL, source TEXT NOT NULL,
  UNIQUE (receipt_id, log_index)
);
CREATE INDEX IF NOT EXISTS events_order ON events (block_height, ord, log_index);
CREATE TABLE IF NOT EXISTS launches (
  launch_id INTEGER PRIMARY KEY, creator TEXT NOT NULL, payout_recipient TEXT NOT NULL, symbol TEXT NOT NULL, name TEXT, total_supply TEXT, mode TEXT NOT NULL DEFAULT 'trial',
  charter_hash TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER, opens_at INTEGER, commit_end INTEGER, walk_end INTEGER,
  total_active TEXT NOT NULL, funders INTEGER NOT NULL, soft_cap TEXT, min_funders INTEGER, stream_days INTEGER, token_decimals INTEGER NOT NULL,
  book_hash TEXT NOT NULL, book_hash_recomputed TEXT NOT NULL DEFAULT '', book_events INTEGER NOT NULL DEFAULT 0, book_funders INTEGER NOT NULL DEFAULT 0, book_mismatch_at INTEGER, verdict TEXT, inputs_hash TEXT, reasons TEXT NOT NULL, allocation TEXT, settled_at INTEGER,
  contributed_total TEXT NOT NULL, walked_total TEXT NOT NULL, stream_total TEXT NOT NULL, stream_drawn TEXT NOT NULL,
  last_block INTEGER NOT NULL, source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS positions (
  launch_id INTEGER NOT NULL, holder TEXT NOT NULL, contributed TEXT NOT NULL, walked TEXT NOT NULL, tokens_claimed TEXT NOT NULL,
  source TEXT NOT NULL, PRIMARY KEY (launch_id, holder)
);
CREATE TABLE IF NOT EXISTS balances (launch_id INTEGER NOT NULL, holder TEXT NOT NULL, balance TEXT NOT NULL, PRIMARY KEY (launch_id, holder));
CREATE TABLE IF NOT EXISTS pools (
  launch_id INTEGER PRIMARY KEY, opened_at INTEGER NOT NULL, quote_reserve TEXT, token_reserve TEXT, fee_bps INTEGER,
  paused INTEGER NOT NULL, payout_recipient TEXT, token_decimals INTEGER NOT NULL, mint_authority_null INTEGER, freeze_authority_null INTEGER,
  creator_bps INTEGER, creator_claimed TEXT NOT NULL, creator_fees TEXT NOT NULL, fees_total TEXT NOT NULL, source TEXT NOT NULL,
  token TEXT, market TEXT, terms TEXT, mode TEXT, creator TEXT, fees_platform TEXT NOT NULL DEFAULT '0', fees_holders TEXT NOT NULL DEFAULT '0',
  fees_lp TEXT NOT NULL DEFAULT '0', fees_referral TEXT NOT NULL DEFAULT '0'
);
CREATE TABLE IF NOT EXISTS trades (
  launch_id INTEGER NOT NULL, block_height INTEGER NOT NULL, ord INTEGER NOT NULL, log_index INTEGER NOT NULL,
  receipt_id TEXT NOT NULL, time INTEGER NOT NULL, side TEXT NOT NULL, trader TEXT NOT NULL,
  amount_in TEXT NOT NULL, amount_out TEXT NOT NULL, quote_amount TEXT NOT NULL, token_amount TEXT NOT NULL, price_e12 TEXT NOT NULL,
  fee_total TEXT NOT NULL, fee_slices TEXT, qr_after TEXT, tr_after TEXT, source TEXT NOT NULL,
  PRIMARY KEY (launch_id, block_height, ord, log_index)
);
CREATE TABLE IF NOT EXISTS candles (
  launch_id INTEGER NOT NULL, interval TEXT NOT NULL, t INTEGER NOT NULL,
  o TEXT NOT NULL, h TEXT NOT NULL, l TEXT NOT NULL, c TEXT NOT NULL, v TEXT NOT NULL, n INTEGER NOT NULL, source TEXT NOT NULL,
  PRIMARY KEY (launch_id, interval, t)
);
CREATE TABLE IF NOT EXISTS payouts (
  launch_id INTEGER NOT NULL, block_height INTEGER NOT NULL, ord INTEGER NOT NULL, log_index INTEGER NOT NULL,
  receipt_id TEXT NOT NULL, time INTEGER NOT NULL, kind TEXT NOT NULL, amount TEXT NOT NULL, ok INTEGER NOT NULL, recipient TEXT, source TEXT NOT NULL,
  PRIMARY KEY (launch_id, block_height, ord, log_index)
);
CREATE TABLE IF NOT EXISTS genesis (
  launch_id INTEGER PRIMARY KEY, stage TEXT NOT NULL, network TEXT, path TEXT, spec_hash TEXT, mint TEXT, tx_create TEXT, tx_authority TEXT,
  distributor TEXT, root TEXT, mint_authority TEXT NOT NULL, freeze_authority TEXT NOT NULL, checks TEXT NOT NULL, updated_at INTEGER, source TEXT NOT NULL,
  signatures TEXT NOT NULL DEFAULT '[]', slot TEXT, ceremony_hash TEXT, leaf_count INTEGER,
  reopen_count INTEGER NOT NULL DEFAULT 0, reopened_at INTEGER, abort_reason TEXT, abort_by TEXT, max_total_claim TEXT,
  f0_messages TEXT NOT NULL DEFAULT '[]', f0_sign_requests TEXT NOT NULL DEFAULT '[]', attestations TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS instants (
  launch_id INTEGER PRIMARY KEY, token TEXT, creator_alloc TEXT NOT NULL, pool_tokens TEXT NOT NULL, cliff_days INTEGER NOT NULL, vest_days INTEGER NOT NULL,
  seed_q TEXT NOT NULL, launch_fee TEXT NOT NULL, supply_model TEXT, terms TEXT, opened_at INTEGER, failure TEXT,
  alloc_claimed TEXT NOT NULL DEFAULT '0', fee_credited TEXT NOT NULL DEFAULT '0', source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS external_pools (launch_id INTEGER NOT NULL, venue TEXT NOT NULL, pool TEXT NOT NULL, url TEXT NOT NULL, source TEXT NOT NULL, PRIMARY KEY (launch_id, venue, pool));
CREATE TABLE IF NOT EXISTS flags (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS halts (
  launch_id INTEGER PRIMARY KEY, halted INTEGER NOT NULL, halted_by TEXT, reason TEXT, halted_at INTEGER, resumed_at INTEGER, halt_count INTEGER NOT NULL, source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS upgrades (
  block_height INTEGER NOT NULL, ord INTEGER NOT NULL, log_index INTEGER NOT NULL, code_hash TEXT NOT NULL, status TEXT NOT NULL,
  queued_at INTEGER NOT NULL, effective_at INTEGER, resolved_at INTEGER, resolved_by TEXT, source TEXT NOT NULL,
  PRIMARY KEY (block_height, ord, log_index)
);
CREATE TABLE IF NOT EXISTS force_resolves (
  block_height INTEGER NOT NULL, ord INTEGER NOT NULL, log_index INTEGER NOT NULL, launch_id INTEGER NOT NULL, amount TEXT NOT NULL, ok INTEGER NOT NULL,
  state TEXT NOT NULL, queued_at INTEGER, effective_at INTEGER, executed_at INTEGER, evidence TEXT, source TEXT NOT NULL,
  PRIMARY KEY (block_height, ord, log_index)
);
CREATE TABLE IF NOT EXISTS solvency_reports (
  block_height INTEGER NOT NULL, ord INTEGER NOT NULL, log_index INTEGER NOT NULL, time INTEGER NOT NULL, at INTEGER, ok INTEGER NOT NULL, intents_alert INTEGER NOT NULL,
  native_balance TEXT, native_liability TEXT, native_ok INTEGER, intents_balance TEXT, intents_liability TEXT, intents_ok INTEGER, receipt_id TEXT NOT NULL, source TEXT NOT NULL,
  PRIMARY KEY (block_height, ord, log_index)
);
CREATE TABLE IF NOT EXISTS owed (
  scope TEXT NOT NULL, account TEXT NOT NULL, token TEXT NOT NULL, credited TEXT NOT NULL, claimed TEXT NOT NULL, updated_at INTEGER NOT NULL, source TEXT NOT NULL,
  PRIMARY KEY (scope, account, token)
);
CREATE TABLE IF NOT EXISTS launch_custody (
  launch_id INTEGER PRIMARY KEY, alloc_claimed TEXT NOT NULL, swept TEXT NOT NULL, sweep_mode TEXT, stream_end_ns TEXT, stream_unlocked_at_change TEXT, stream_lengthened INTEGER NOT NULL,
  refund_batches INTEGER NOT NULL, refund_handled INTEGER NOT NULL, refund_paid INTEGER NOT NULL, refund_routes INTEGER NOT NULL,
  delivery_refusals INTEGER NOT NULL, orphan_refusals INTEGER NOT NULL, rejected_refundable INTEGER NOT NULL, source TEXT NOT NULL, stream_changed_at INTEGER
);
`;

export const DERIVED_TABLES = ["launches", "positions", "balances", "pools", "trades", "candles", "payouts", "genesis", "instants", "external_pools", "flags", "halts", "upgrades", "force_resolves", "solvency_reports", "owed", "launch_custody"] as const;

/** Hash order and row order for the canonical state dump. */
export const HASH_ORDER: Record<string, string> = {
  launches: "launch_id",
  positions: "launch_id, holder",
  balances: "launch_id, holder",
  pools: "launch_id",
  trades: "launch_id, block_height, ord, log_index",
  candles: "launch_id, interval, t",
  payouts: "launch_id, block_height, ord, log_index",
  genesis: "launch_id",
  instants: "launch_id",
  external_pools: "launch_id, venue, pool",
  flags: "k",
  halts: "launch_id",
  upgrades: "block_height, ord, log_index",
  force_resolves: "block_height, ord, log_index",
  solvency_reports: "block_height, ord, log_index",
  owed: "scope, account, token",
  launch_custody: "launch_id",
  events: "block_height, ord, log_index",
};
