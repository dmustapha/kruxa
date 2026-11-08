#!/usr/bin/env python3
"""Solana-side genesis verification (S1-D 6 / ARCHITECTURE 5.2): checks C3 to C28 that need only a public ceremony record and
Solana RPC. Standard library only. Exit codes follow the E-4 contract (ARCHITECTURE 4.6):
  0 every check ok | 2 ONLY a MISMATCH (always with a `MISMATCH <field>` line) | 3 pending (no mint recorded)
  4 infrastructure (RPC down, non-JSON, two RPCs disagree) | 64 usage | 1 --tamper-all found an undetected tamper
Checks that need the NEAR core genesis views (C1 C2 C23 C24 C26 C30) or off-chain content (C10, C22, C25) print SKIP with the reason.
usage: verify_solana.py --record FILE --rpc URL [--rpc2 URL] [--charter FILE] [--commitment finalized|confirmed] [--production]
                        [--tamper [FIELD] | --tamper-all] [--evidence-out FILE | --evidence FILE]"""
import base64, copy, dataclasses, hashlib, json, os, struct, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "tools", "genesis", "ref"))
sys.path.insert(0, os.path.join(HERE, "..", "tools", "genesis"))
import compile as gc  # noqa: E402
import f0_derive  # noqa: E402
import merkle  # noqa: E402
import sol  # noqa: E402

PRODUCTION_TIME_LOCK = 172_800
G_DUST_MAX = 890_880 + 5_000
TAMPER_FIELDS = ["mint", "g_pub", "launch_id", "name", "symbol", "decimals", "reserve_amount", "max_total_claim", "max_num_nodes",
                 "merkle_root", "reserve_owner", "spec_hash"]
SKIPS = {"C1": "needs core genesis views (Task 4.4)", "C2": "needs core ledger views (Task 4.4)", "C10": "needs the hosted metadata JSON",
         "C22": "no creator allocation in this record", "C23": "needs core genesis events", "C24": "needs core PASS block time",
         "C25": "no Verdict Rail attestation in this record", "C26": "needs core ceremony hash view", "C30": "PASS launch (FAIL path is a core check)"}


class Infra(Exception):
    pass


class Usage(Exception):
    pass


class Rpc:
    """One or two live RPCs (agreement required), or a recorded evidence file."""
    def __init__(self, urls, commitment, replay=None):
        self.urls, self.commitment, self.replay, self.log = urls, commitment, replay, []

    def _post(self, url, method, params):
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
        try:
            req = urllib.request.Request(url, body, {"content-type": "application/json"})
            raw = urllib.request.urlopen(req, timeout=30).read()
            j = json.loads(raw)
        except Exception as e:  # network, non-200, non-JSON
            raise Infra("rpc %s %s: %s" % (url, method, e))
        if "error" in j or "result" not in j:
            raise Infra("rpc %s %s: %s" % (url, method, str(j.get("error", j))[:160]))
        return j["result"]

    def call(self, method, params):
        key = json.dumps([method, params], sort_keys=True)
        if self.replay is not None:
            if key in self.replay:
                return self.replay[key]
            if method == "getAccountInfo":
                return {"value": None}
            if method in ("getTokenAccountsByOwner", "getSignaturesForAddress"):
                return {"value": []} if method == "getTokenAccountsByOwner" else []
            raise Infra("evidence has no recorded response for %s" % method)
        results = [self._post(u, method, params) for u in self.urls]
        norm = [r.get("value") if isinstance(r, dict) and "value" in r else r for r in results]
        if len(norm) == 2 and norm[0] != norm[1]:
            raise Infra("the two RPCs disagree on %s" % method)
        self.log.append((key, results[0]))
        return results[0]

    def account(self, pubkey):
        r = self.call("getAccountInfo", [pubkey, {"encoding": "base64", "commitment": self.commitment}])["value"]
        if r is None:
            return None
        return {"owner": r["owner"], "lamports": r["lamports"], "data": base64.b64decode(r["data"][0]), "executable": r["executable"]}


class Report:
    def __init__(self):
        self.lines, self.mismatch = [], []

    def ok(self, c, msg):
        self.lines.append("PASS %s %s" % (c, msg))

    def bad(self, c, field, exp, act):
        self.lines.append("MISMATCH %s C=%s expected=%s actual=%s" % (field, c, exp, act))
        self.mismatch.append(field)

    def skip(self, c, why):
        self.lines.append("SKIP %s (%s)" % (c, why))


def u32(b, o): return struct.unpack_from("<I", b, o)[0]
def u64(b, o): return struct.unpack_from("<Q", b, o)[0]
def i64(b, o): return struct.unpack_from("<q", b, o)[0]


def coption(b, o):
    return sol.b58e(b[o + 4:o + 36]) if u32(b, o) == 1 else None


def load_spec(rec):
    try:
        raw = bytes.fromhex(rec["spec_hex"])
        return raw, gc.decode_spec(raw), gc.params_from_json(rec["params"])
    except Exception as e:
        raise ValueError("record spec unparsable: %s" % e)


def amount_of(spec, role):
    return dict(spec.buckets).get(role, 0)


def has_distributor(spec):
    return spec.max_num_nodes > 0 or spec.max_total_claim > 0


def c_derivations(rec, raw, spec, params, r):
    out = gc.compile_genesis(raw, params, rec["blockhash"], rec["price"])
    if out["mint"] == sol.b58d(rec["mint"]):
        r.ok("C5", "mint == createWithSeed(g_pub, seed %s, Tokenkeg): no private key exists" % spec.mint_seed)
    else:
        r.bad("C5", "mint", sol.b58e(out["mint"]), rec["mint"])
    if sol.b58e(spec.genesis_key_pubkey) != rec["g_pub"]:
        r.bad("C5", "g_pub", sol.b58e(spec.genesis_key_pubkey), rec["g_pub"])
    if out["spec_hash"].hex() == rec.get("spec_hash"):
        r.ok("C3", "spec re-hash %s (sha256 of the committed borsh GenesisSpec)" % rec["spec_hash"][:16])
    else:
        r.bad("C3", "spec_hash", out["spec_hash"].hex(), rec.get("spec_hash"))
    return out


def c_mint(rpc, rec, spec, r):
    m = rpc.account(rec["mint"])
    if m is None:
        r.bad("C4", "mint", rec["mint"], "no account")
        return
    if m["owner"] != sol.TOKENKEG:
        r.bad("C4", "mint", "owner " + sol.TOKENKEG, m["owner"])
    elif len(m["data"]) != 82:
        r.bad("C8", "mint", "82 bytes, no extensions", len(m["data"]))
    else:
        r.ok("C4", "mint %s owner Tokenkeg space 82 (no extensions: C8)" % rec["mint"])
    d = m["data"]
    if len(d) != 82:
        return
    ma, fa = coption(d, 0), coption(d, 46)
    if ma is None and fa is None:
        r.ok("C7", "mint_authority=None freeze_authority=None")
    else:
        r.bad("C7", "mint", "authorities None", "mint_authority=%s freeze_authority=%s" % (ma, fa))
    if d[44] != spec.decimals:
        r.bad("C6", "decimals", spec.decimals, d[44])
    elif u64(d, 36) != spec.supply_total:
        r.bad("C6", "supply_total", spec.supply_total, u64(d, 36))
    else:
        r.ok("C6", "decimals %d supply %d == sum of buckets" % (d[44], spec.supply_total))


def c_metadata(rpc, rec, spec, params, out, r):
    a = rpc.account(sol.b58e(out["accounts"]["metadata"]))
    if a is None or a["owner"] != sol.METAPLEX or a["data"][:1] != b"\x04":
        r.bad("C9", "mint", "metaplex metadata account", "absent or wrong owner")
        return
    d = a["data"]
    o = 65

    def s(o):
        n = u32(d, o)
        return d[o + 4:o + 4 + n].rstrip(b"\0").decode(), o + 4 + n
    name, o = s(o)
    sym, o = s(o)
    uri, o = s(o)
    fee, o = struct.unpack_from("<H", d, o)[0], o + 2
    creators, o = d[o], o + 1
    o += 1
    mutable = d[o]
    for f, got, want in (("name", name, spec.name), ("symbol", sym, spec.symbol), ("metadata_uri", uri, params.metadata_uri)):
        if got != want:
            r.bad("C9", f, want, got)
    if mutable != 0 or fee != 0 or creators != 0:
        r.bad("C9", "metadata", "is_mutable=0 fee=0 creators=None", "mutable=%d fee=%d creators=%d" % (mutable, fee, creators))
    elif (name, sym, uri) == (spec.name, spec.symbol, params.metadata_uri):
        r.ok("C9", "metadata is_mutable=false, name/symbol/uri == spec, fee 0, no creators")


def c_buckets(rpc, rec, spec, out, r):
    good = True
    want = amount_of(spec, gc.ROLE_RESERVE)
    a = rpc.account(sol.b58e(out["accounts"]["reserve_ata"]))
    got = u64(a["data"], 64) if a and len(a["data"]) >= 72 and a["owner"] == sol.TOKENKEG else None
    if got is None:
        r.bad("C11", "reserve_owner", "reserve ATA of the Squads vault", "absent"); good = False
    elif got != want:
        r.bad("C11", "reserve_amount", want, got); good = False
    if has_distributor(spec):
        v = rpc.account(sol.b58e(out["accounts"]["vault"]))
        vbal = u64(v["data"], 64) if v and len(v["data"]) >= 72 else None
        if vbal is None or vbal != spec.max_total_claim - claimed_total(rpc, out):
            r.bad("C11", "max_total_claim", spec.max_total_claim, vbal); good = False
    if good:
        r.ok("C11", "reserve bucket %d%s" % (want, ", distributor vault holds the unclaimed rest" if has_distributor(spec) else ", no distributor (no Solana buyers)"))


def claimed_total(rpc, out):
    d = rpc.account(sol.b58e(out["accounts"]["distributor"]))
    return u64(d["data"], 129) if d and len(d["data"]) >= 234 else 0


def c_distributor(rpc, rec, spec, params, out, r):
    if not has_distributor(spec):
        r.ok("C13", "no distributor: zero Solana buyers, zero claim total")
        return
    a = rpc.account(sol.b58e(out["accounts"]["distributor"]))
    jito = sol.b58e(params.jito_program)
    if a is None or a["owner"] != jito or len(a["data"]) < 234:
        r.bad("C13", "launch_id", "distributor PDA owned by " + jito, "absent or wrong owner")
        return
    d = a["data"]
    st, en, cl = out["timestamps"]
    f = {"launch_id": (u64(d, 9), int(spec.launch_id)), "merkle_root": (d[17:49].hex(), spec.merkle_root.hex()),
         "mint": (sol.b58e(d[49:81]), rec["mint"]), "max_total_claim": (u64(d, 113), spec.max_total_claim),
         "max_num_nodes": (u64(d, 121), spec.max_num_nodes), "distributor_start": (i64(d, 145), st), "distributor_end": (i64(d, 153), en),
         "clawback_ts": (i64(d, 161), cl), "reserve_owner": (sol.b58e(d[169:201]), sol.b58e(out["accounts"]["reserve_ata"]))}
    admin = sol.b58e(d[201:233])
    good = True
    for k, (got, want) in f.items():
        if got != want:
            r.bad("C13", k, want, got); good = False
    if admin != gc.NULL_ADMIN:
        r.bad("C13", "distributor_admin", gc.NULL_ADMIN, admin); good = False
    if good:
        r.ok("C13", "distributor %s root/max_total_claim/max_num_nodes/timestamps/clawback receiver match, admin NULL (%s)" % (jito[:6], admin[:8]))


def c_squads(rpc, rec, spec, out, charter, production, r):
    sq = rec.get("squads")
    if not sq or not charter:
        r.skip("C12", "no Squads vault in this record" if not sq else "no --charter given")
        return
    if sol.b58d(sq["multisig"]) != spec.reserve_squads_multisig_hash:
        r.bad("C12", "reserve_owner", sq["multisig"], sol.b58e(spec.reserve_squads_multisig_hash)); return
    a = rpc.account(sq["multisig"])
    if a is None:
        r.bad("C12", "reserve_owner", sq["multisig"], "no multisig account"); return
    d = a["data"]
    cfg_auth, threshold, tl = sol.b58e(d[40:72]), struct.unpack_from("<H", d, 72)[0], u32(d, 74)
    o = 74 + 4 + 8 + 8
    o += 33 if d[o] == 1 else 1
    o += 1
    members = sorted(sol.b58e(d[o + 4 + 33 * i:o + 36 + 33 * i]) for i in range(u32(d, o)))
    good = True
    if cfg_auth != "11111111111111111111111111111111":
        r.bad("C12", "config_authority", "None", cfg_auth); good = False
    if threshold < 2:
        r.bad("C12", "threshold", ">=2", threshold); good = False
    if tl != charter["time_lock"] or (production and tl < PRODUCTION_TIME_LOCK):
        r.bad("C12", "time_lock", charter["time_lock"] if not production else ">=%d" % PRODUCTION_TIME_LOCK, tl); good = False
    if members != sorted(charter["reserve_members"]):
        r.bad("C12", "members", sorted(charter["reserve_members"]), members); good = False
    if good:
        tag = "" if tl >= PRODUCTION_TIME_LOCK else " REHEARSAL time lock (production %d s = 48 h)" % PRODUCTION_TIME_LOCK
        r.ok("C12", "squads %d-of-%d time_lock %d == charter, config_authority None, reserve owner is vault %s%s" % (threshold, len(members), tl, sol.b58e(out["accounts"]["reserve_owner"])[:8], tag))


def c_g(rpc, rec, r):
    g = rec["g_pub"]
    toks = rpc.call("getTokenAccountsByOwner", [g, {"programId": sol.TOKENKEG}, {"encoding": "base64", "commitment": rpc.commitment}])["value"]
    if toks:
        r.bad("C14", "g_pub", "no token accounts", len(toks))
    else:
        r.ok("C14", "G holds no token accounts")
    sigs = {s["signature"] for s in rpc.call("getSignaturesForAddress", [g, {"commitment": rpc.commitment, "limit": 20}])}
    if not set(rec["sigs"]) <= sigs or len(sigs) > 3:
        r.bad("C15", "g_pub", "ceremony txs only (fund, tx1, tx2)", "%d signatures, ceremony txs present: %s" % (len(sigs), set(rec["sigs"]) <= sigs))
    else:
        r.ok("C15", "G history is the ceremony only (%d signatures)" % len(sigs))
    a = rpc.account(g)
    lam = a["lamports"] if a else 0
    if lam > G_DUST_MAX:
        r.bad("C16", "g_pub", "<=%d lamports" % G_DUST_MAX, lam)
    else:
        r.ok("C16", "G lamports %d <= %d (rent-exempt floor 890,880 + 5,000; a system account cannot be left lower without a sweep)" % (lam, G_DUST_MAX))


def c_txs(rpc, rec, raw, params, out, r):
    allow = {sol.SYSTEM, sol.COMPUTE_BUDGET, sol.TOKENKEG, sol.ATA, sol.METAPLEX, sol.b58e(params.jito_program)}
    good = True
    for name, sig in zip(("tx1", "tx2"), rec["sigs"]):
        t = rpc.call("getTransaction", [sig, {"encoding": "base64", "maxSupportedTransactionVersion": 0, "commitment": rpc.commitment}])
        if not t or t["meta"]["err"] is not None:
            r.bad("C17", "g_pub", name + " succeeded", "missing or failed"); return
        msg = base64.b64decode(t["transaction"][0])[65:]
        # each transaction carries its own blockhash (the MPC signer can take a minute); recompile with the one it used
        want = gc.compile_genesis(raw, params, sol.parse_message(msg)["blockhash"], rec["price"])[name]
        if msg != want:
            r.bad("C17", "spec_hash", "compile() bytes", "on-chain %s message differs" % name); good = False
        pm = sol.parse_message(msg)
        for i in pm["instructions"]:
            if pm["keys"][i["program"]] not in allow:
                r.bad("C18", "jito_program", "allowlisted programs", pm["keys"][i["program"]]); good = False
    if good:
        r.ok("C17", "on-chain tx1 and tx2 message bytes == compile(spec, blockhash, price)")
        r.ok("C18", "program allowlist holds")
    pm = sol.parse_message(out["tx2"])
    datas = [d for d in ((pm["keys"][i["program"]], i["data"]) for i in pm["instructions"]) if d[0] == sol.TOKENKEG]
    mint_idx = [n for n, (_, d) in enumerate(datas) if d[:1] == b"\x07"]
    if datas[-1][1] == bytes([6, 0, 0]) and (not mint_idx or max(mint_idx) < len(datas) - 1):
        r.ok("C19", "SetAuthority(MintTokens, None) is the last token instruction, after every MintTo")
    else:
        r.bad("C19", "spec_hash", "SetAuthority last", "order violated")


def c_merkle(rec, spec, r):
    leaves = [(sol.b58d(x["claimant"]), int(x["unlocked"]), int(x["locked"])) for x in rec["leaves"]]
    root, proofs, ls = merkle.build(leaves) if leaves else (bytes(32), [], [])
    total = sum(a + b for _, a, b in leaves)
    if root != spec.merkle_root:
        r.bad("C20", "merkle_root", spec.merkle_root.hex(), root.hex())
    elif total != spec.max_total_claim:
        r.bad("C20", "max_total_claim", spec.max_total_claim, total)
    elif len(leaves) != spec.max_num_nodes:
        r.bad("C20", "max_num_nodes", spec.max_num_nodes, len(leaves))
    else:
        r.ok("C20", "rebuilt merkle root == spec == on-chain; sum %d, leaves %d" % (total, len(leaves)))
        bad = [i for i, l in enumerate(ls) if not merkle.verify(proofs[i], spec.merkle_root, merkle.leaf(*l))]
        r.ok("C21", "all %d proofs verify against the root" % len(ls)) if not bad else r.bad("C21", "merkle_root", "valid proofs", bad)


def c_f0(rec, r):
    f = rec.get("f0")
    if rec["mode"] != "F0":
        r.skip("C27", "F1 record: no derived key")
    elif not f or not f.get("signer_root"):
        r.skip("C27", "F0 sandbox record: no live signer root")
    else:
        want = f0_derive.derive(f["signer_root"], f["predecessor"], f["path"])
        got = "ed25519:" + rec["g_pub"]
        r.ok("C27", "g_pub == derive(%s, %s)" % (f["predecessor"], f["path"])) if want == got else r.bad("C27", "g_pub", want, got)


def run_checks(rpc, rec, charter, production):
    r = Report()
    raw, spec, params = load_spec(rec)
    out = c_derivations(rec, raw, spec, params, r)
    c_mint(rpc, rec, spec, r)
    c_metadata(rpc, rec, spec, params, out, r)
    c_buckets(rpc, rec, spec, out, r)
    c_distributor(rpc, rec, spec, params, out, r)
    c_squads(rpc, rec, spec, out, charter, production, r)
    c_g(rpc, rec, r)
    c_txs(rpc, rec, raw, params, out, r)
    c_merkle(rec, spec, r)
    c_f0(rec, r)
    r.ok("C28", "two-RPC agreement enforced on every read (2 RPCs)") if len(rpc.urls) == 2 else r.skip("C28", "single RPC; pass --rpc2")
    for c, why in SKIPS.items():
        r.skip(c, why)
    return r


def encode_spec(s):
    ws = lambda x: struct.pack("<I", len(x.encode())) + x.encode()
    b = bytes([s.spec_version]) + ws(s.compiler_version) + ws(s.chain) + s.cluster_genesis_hash + ws(s.launch_id) + ws(s.near_contract)
    b += struct.pack("<Q", s.near_block_height) + bytes([s.mode]) + s.genesis_key_pubkey + ws(s.mint_seed) + s.mint_address + s.token_program
    b += bytes([s.decimals]) + struct.pack("<Q", s.supply_total) + ws(s.name) + ws(s.symbol) + s.metadata_uri_sha256 + s.metadata_hash
    b += bytes([s.mint_authority_none, s.freeze_authority_none, s.extensions_allowed]) + struct.pack("<I", len(s.buckets))
    b += b"".join(bytes([r]) + struct.pack("<Q", a) for r, a in s.buckets)
    return b + s.reserve_squads_multisig_hash + bytes([s.reserve_vault_index, s.reserve_disclosure]) + s.merkle_root + struct.pack("<QIH", s.max_total_claim, s.max_num_nodes, s.clawback_days)


def tamper(rec, field):
    t = copy.deepcopy(rec)
    spec = gc.decode_spec(bytes.fromhex(rec["spec_hex"]))
    rep = dataclasses.replace
    flip = lambda h: ("0" if h[0] != "0" else "1") + h[1:]
    other = sol.sha256(b"tamper", field.encode())
    if field == "mint": t["mint"] = sol.b58e(other)
    elif field == "g_pub": t["g_pub"] = sol.b58e(other)
    elif field == "spec_hash": t["spec_hash"] = flip(t["spec_hash"])
    else:
        new = {"launch_id": lambda: rep(spec, launch_id=str(int(spec.launch_id) + 1)),
               "name": lambda: rep(spec, name=spec.name + "x"), "symbol": lambda: rep(spec, symbol=spec.symbol + "x"),
               "decimals": lambda: rep(spec, decimals=9),
               "reserve_amount": lambda: rep(spec, buckets=tuple((r, a + 1 if r == gc.ROLE_RESERVE else a) for r, a in spec.buckets), supply_total=spec.supply_total + 1),
               "max_total_claim": lambda: rep(spec, max_total_claim=spec.max_total_claim + 1),
               "max_num_nodes": lambda: rep(spec, max_num_nodes=spec.max_num_nodes + 1),
               "merkle_root": lambda: rep(spec, merkle_root=bytes.fromhex(flip(spec.merkle_root.hex()))),
               "reserve_owner": lambda: rep(spec, reserve_squads_multisig_hash=other)}[field]()
        t["spec_hex"] = encode_spec(new).hex()
    return t


def parse_args(argv):
    spec = {"--record": 1, "--rpc": 1, "--rpc2": 1, "--charter": 1, "--commitment": 1, "--evidence-out": 1, "--evidence": 1,
            "--production": 0, "--tamper": "opt", "--tamper-all": 0}
    a, i = {}, 0
    while i < len(argv):
        k = argv[i]
        if k not in spec:
            raise Usage("unknown argument %s" % k)
        kind = spec[k]
        nxt = argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith("--") else None
        if kind == 1:
            if nxt is None: raise Usage("%s needs a value" % k)
            a[k], i = nxt, i + 2
        elif kind == "opt":
            a[k], i = nxt or "mint", i + (2 if nxt else 1)
        else:
            a[k], i = True, i + 1
    if "--tamper" in a and "--tamper-all" in a:
        raise Usage("--tamper and --tamper-all are exclusive")
    if "--evidence" not in a and ("--record" not in a or "--rpc" not in a):
        raise Usage("need --record FILE and --rpc URL (or --evidence FILE)")
    if a.get("--tamper") and a["--tamper"] not in TAMPER_FIELDS:
        raise Usage("unknown tamper field; one of: " + " ".join(TAMPER_FIELDS))
    return a


def load_json(path):
    try:
        return json.load(open(path))
    except Exception as e:
        raise Usage("cannot read %s: %s" % (path, e))


def main(argv):
    try:
        a = parse_args(argv)
        charter = load_json(a["--charter"]) if "--charter" in a else None
        if "--evidence" in a:
            ev = load_json(a["--evidence"])
            rec, rpc = ev["record"], Rpc([], ev.get("commitment", "finalized"), replay={k: v for k, v in ev["responses"]})
            charter = charter or ev.get("charter")
            print("RECORDED, not live (evidence %s)" % a["--evidence"])
        else:
            rec = load_json(a["--record"])
            urls = [a["--rpc"]] + ([a["--rpc2"]] if "--rpc2" in a else [])
            rpc = Rpc(urls, a.get("--commitment", "finalized"))
        if not rec.get("mint"):
            print("PENDING: no mint recorded (genesis not confirmed)")
            return 3
        try:
            base = run_checks(rpc, rec, charter, "--production" in a)
        except ValueError as e:
            print("MISMATCH spec (%s)" % e)
            return 2
        if "--evidence-out" in a:
            json.dump({"record": rec, "charter": charter, "commitment": rpc.commitment, "responses": rpc.log}, open(a["--evidence-out"], "w"))
        return finish(a, rpc, rec, charter, base)
    except Usage as e:
        print("usage error: %s\n%s" % (e, __doc__.split("usage:")[1].strip()), file=sys.stderr)
        return 64
    except Infra as e:
        print("infrastructure error: %s" % e, file=sys.stderr)
        return 4


def finish(a, rpc, rec, charter, base):
    print("\n".join(base.lines))
    if base.mismatch:
        return 2
    if "--tamper" in a or "--tamper-all" in a:
        fields = TAMPER_FIELDS if "--tamper-all" in a else [a["--tamper"]]
        undetected = False
        for f in fields:
            try:
                rep = run_checks(rpc, tamper(rec, f), charter, "--production" in a)
            except (ValueError, KeyError, IndexError):
                rep = Report(); rep.bad("parse", f, "valid", "unparsable")
            hit = f in rep.mismatch
            print(("MISMATCH %s (tamper detected)" % f) if hit else "TAMPER NOT DETECTED %s" % f)
            undetected |= not hit
        return 1 if undetected else 2
    n_ok = sum(1 for l in base.lines if l.startswith("PASS"))
    print("ALL CHECKS OK (%d passed, %d skipped)" % (n_ok, len(base.lines) - n_ok))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
