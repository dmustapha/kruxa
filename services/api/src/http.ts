import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { ApiError, candleJson, launchSummary, one, tradeJson } from "./common.ts";
import type { Ctx, Json } from "./common.ts";
import { creatorClaimsCsv, creatorDesk, launchesCsv, portfolio, tradesCsv, verify } from "./desk.ts";
import * as q from "./queries.ts";
import type { Change } from "../../indexer/src/types.ts";

type Handler = (ctx: Ctx, m: string[], query: URLSearchParams) => Json | { csv: string };

const ROUTES: Array<[RegExp, Handler]> = [
  [/^\/api\/health$/, (c) => q.health(c)],
  [/^\/api\/stats$/, (c) => q.stats(c)],
  [/^\/api\/ops-log$/, (c, _m, s) => q.opsLog(c, s)],
  [/^\/api\/launches$/, (c, _m, s) => q.launches(c, s)],
  [/^\/api\/launch\/([^/]+)$/, (c, m) => q.launchDetail(c, m[1] as string)],
  [/^\/api\/token\/([^/]+)$/, (c, m) => q.tokenPage(c, m[1] as string)],
  [/^\/api\/token\/([^/]+)\/candles$/, (c, m, s) => q.candles(c, m[1] as string, s)],
  [/^\/api\/token\/([^/]+)\/trades$/, (c, m, s) => q.trades(c, m[1] as string, s)],
  [/^\/api\/token\/([^/]+)\/holders$/, (c, m, s) => q.holders(c, m[1] as string, s)],
  [/^\/api\/token\/([^/]+)\/depth$/, (c, m) => q.depth(c, m[1] as string)],
  [/^\/api\/creator\/([^/]+)$/, (c, m) => creatorDesk(c, decodeURIComponent(m[1] as string))],
  [/^\/api\/export\/creator\/([^/]+)\/claims\.csv$/, (c, m) => ({ csv: creatorClaimsCsv(c, decodeURIComponent(m[1] as string)) })],
  [/^\/api\/portfolio\/([^/]+)$/, (c, m) => portfolio(c, decodeURIComponent(m[1] as string))],
  [/^\/api\/verify\/([^/]+)$/, (c, m) => verify(c, m[1] as string)],
  [/^\/api\/export\/launches\.csv$/, (c) => ({ csv: launchesCsv(c) })],
  [/^\/api\/export\/trades\.csv$/, (c, _m, s) => ({ csv: tradesCsv(c, s.get("launch_id")) })],
];

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, HEAD, OPTIONS", "access-control-allow-headers": "last-event-id" };
const RING_SIZE = 1000;
const HEARTBEAT_MS = 15_000;

interface Pushed {
  id: number;
  event: string;
  launchId: number;
  data: Json;
}

export interface App {
  server: Server;
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
  /** Pure request handler, shared by HTTP and the snapshot exporter. */
  handle(path: string, query?: URLSearchParams): { status: number; body: Json | { csv: string } };
}

export function createApp(ctx: Ctx): App {
  const ring: Pushed[] = [];
  const clients = new Set<{ res: ServerResponse; launchId: number | null }>();
  ctx.store.onChange((c) => push(ctx, ring, clients, c));

  const handle: App["handle"] = (path, query = new URLSearchParams()) => {
    try {
      for (const [re, fn] of ROUTES) {
        const m = re.exec(path);
        if (m) return { status: 200, body: fn(ctx, m, query) };
      }
      throw new ApiError(404, "not_found", "no such route");
    } catch (err) {
      return errorBody(err);
    }
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "OPTIONS") return void res.writeHead(204, CORS).end();
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: { code: "method_not_allowed", message: "read-only API" } });
    if (url.pathname === "/api/stream") return openStream(ctx, req, res, url, ring, clients);
    const out = handle(url.pathname, url.searchParams);
    if ("csv" in out.body) return void res.writeHead(out.status, { ...CORS, "content-type": "text/csv; charset=utf-8" }).end(req.method === "HEAD" ? undefined : out.body.csv);
    send(res, out.status, out.body, req.method === "HEAD");
  });

  const beat = setInterval(() => clients.forEach((c) => c.res.write(`event: heartbeat\ndata: {}\n\n`)), HEARTBEAT_MS);
  beat.unref();
  return {
    server, handle,
    listen: (port, host = "127.0.0.1") => new Promise((resolve) => server.listen(port, host, () => resolve((server.address() as { port: number }).port))),
    close: () => new Promise((resolve) => {
      clearInterval(beat);
      clients.forEach((c) => c.res.end());
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

function errorBody(err: unknown): { status: number; body: Json } {
  if (err instanceof ApiError) return { status: err.status, body: { error: { code: err.code, message: err.message } } };
  console.error("api: unexpected error", err);
  return { status: 500, body: { error: { code: "internal", message: "internal error" } } };
}

function send(res: ServerResponse, status: number, body: Json, head = false): void {
  res.writeHead(status, { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" });
  res.end(head ? undefined : JSON.stringify(body));
}

function push(ctx: Ctx, ring: Pushed[], clients: Set<{ res: ServerResponse; launchId: number | null }>, c: Change): void {
  let item: Pushed | null = null;
  if (c.type === "trade") {
    const r = one(ctx.store, "SELECT * FROM trades WHERE launch_id = ? AND receipt_id = ?", c.launchId, String(c.trade.receipt_id));
    if (r) item = { id: c.seq, event: "trade", launchId: c.launchId, data: tradeJson(r, one(ctx.store, "SELECT creator, payout_recipient FROM launches WHERE launch_id = ?", c.launchId)) };
  } else if (c.type === "candle") {
    item = { id: c.seq, event: "candle", launchId: c.launchId, data: { launch_id: String(c.launchId), interval: "1m", ...candleJson(c.candle) } };
  } else {
    const l = one(ctx.store, "SELECT * FROM launches WHERE launch_id = ?", c.launchId);
    if (l) item = { id: c.seq, event: "launch", launchId: c.launchId, data: launchSummary(ctx, l) };
  }
  if (!item) return;
  ring.push(item);
  if (ring.length > RING_SIZE) ring.shift();
  for (const cl of clients) if (cl.launchId === null || cl.launchId === item.launchId) write(cl.res, item);
}

function write(res: ServerResponse, p: Pushed): void {
  res.write(`id: ${p.id}\nevent: ${p.event}\ndata: ${JSON.stringify(p.data)}\n\n`);
}

function openStream(ctx: Ctx, req: IncomingMessage, res: ServerResponse, url: URL, ring: Pushed[], clients: Set<{ res: ServerResponse; launchId: number | null }>): void {
  const lid = url.searchParams.get("launch_id");
  if (lid !== null && !/^[0-9]{1,15}$/.test(lid)) return send(res, 400, { error: { code: "bad_id", message: "launch_id must be a decimal integer" } });
  const launchId = lid === null ? null : Number(lid);
  res.writeHead(200, { ...CORS, "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  res.write(`event: hello\ndata: ${JSON.stringify({ as_of: q.health(ctx).as_of, source: q.health(ctx).source })}\n\n`);
  const lastId = Number(req.headers["last-event-id"] ?? NaN);
  if (Number.isFinite(lastId)) ring.filter((p) => p.id > lastId && (launchId === null || p.launchId === launchId)).forEach((p) => write(res, p));
  const client = { res, launchId };
  clients.add(client);
  req.on("close", () => clients.delete(client));
}

