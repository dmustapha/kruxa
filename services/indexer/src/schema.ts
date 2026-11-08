/** SQLite schema. Derived tables are rebuilt from `events`; `events` and `blocks` are the only inputs. */
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
  launch_id INTEGER PRIMARY KEY, creator TEXT NOT NULL, payout_recipient TEXT NOT NULL, symbol TEXT NOT NULL,
  charter_hash TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER, opens_at INTEGER, commit_end INTEGER, walk_end INTEGER,
  total_active TEXT NOT NULL, funders INTEGER NOT NULL, soft_cap TEXT, min_funders INTEGER, stream_days INTEGER, token_decimals INTEGER NOT NULL,
  book_hash TEXT NOT NULL, verdict TEXT, inputs_hash TEXT, reasons TEXT NOT NULL, allocation TEXT, settled_at INTEGER,
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
  creator_bps INTEGER, creator_claimed TEXT NOT NULL, creator_fees TEXT NOT NULL, fees_total TEXT NOT NULL, source TEXT NOT NULL
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
CREATE TABLE IF NOT EXISTS flags (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`;

export const DERIVED_TABLES = ["launches", "positions", "balances", "pools", "trades", "candles", "payouts", "flags"] as const;

/** Hash order and row order for the canonical state dump. */
export const HASH_ORDER: Record<string, string> = {
  launches: "launch_id",
  positions: "launch_id, holder",
  balances: "launch_id, holder",
  pools: "launch_id",
  trades: "launch_id, block_height, ord, log_index",
  candles: "launch_id, interval, t",
  payouts: "launch_id, block_height, ord, log_index",
  flags: "k",
  events: "block_height, ord, log_index",
};
