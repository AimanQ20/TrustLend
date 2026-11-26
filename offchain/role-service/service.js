// TrustLend - Wallet / Role Lookup Service (Member 1)
//
// WHAT IT IS: a small READ-ONLY HTTP service (no private keys, no writes) that answers
//   "who is this wallet and what may it do?" and "who holds role X?" / "who is waiting for KYC?".
// WHY IT EXISTS: the contract deliberately has no on-chain member lists (that saves gas, see docs/GAS_REGISTRY.md).
//   Lists are rebuilt here from the contract's events.
// TRUST MODEL: events only suggest CANDIDATES. Every answer is re-read from the contract (eth_call at one pinned
//   block) before it is returned, so a stale cache or a bad log can add work but can never produce a wrong role.
//   The UI uses this service for convenience only; the contract still enforces every permission.
// FAILURE HANDLING: RPC down -> HTTP 503 {retryable:true}; bad input -> 400; unknown route -> 404; per-IP rate limit -> 429.
const http = require("http");
const { ethers } = require("ethers");
const ABI = require("./Registry.abi.json");

const ROLE_BITS = { ADMIN: 1, PAUSER: 2, VERIFIER: 4, LENDER: 8, BORROWER: 16, ARBITER: 32 };
const STATUS_NAMES = ["None", "Pending", "Active", "Suspended"];
const rolesFromMask = (m) => Object.entries(ROLE_BITS).filter(([, b]) => (m & b) !== 0).map(([n]) => n);

class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

function createService({ provider, registryAddress, startBlock = 0, corsOrigin = "*", rateLimitPerMinute = 120, logChunk = 5000 }) {
  if (!ethers.isAddress(registryAddress)) throw new Error("registryAddress is not a valid address");
  const registry = new ethers.Contract(registryAddress, ABI, provider);

  // ───────── incremental event index (candidates only) ─────────
  const index = { scannedTo: startBlock - 1, granted: {}, registered: new Set() };
  for (const n of Object.keys(ROLE_BITS)) index.granted[n] = new Set();
  let scanning = null;

  async function sync(latest) {
    if (scanning) return scanning;
    scanning = (async () => {
      // re-scan the last 12 blocks every time: harmless if a reorg happened, because answers are re-verified on-chain
      let from = Math.max(startBlock, index.scannedTo - 11);
      while (from <= latest) {
        const to = Math.min(from + logChunk - 1, latest);
        const [grants, regs] = await Promise.all([
          registry.queryFilter(registry.filters.RoleGranted(), from, to),
          registry.queryFilter(registry.filters.UserRegistered(), from, to),
        ]);
        for (const ev of grants) {
          const roleBit = Number(ev.args.role);
          const name = Object.keys(ROLE_BITS).find((k) => ROLE_BITS[k] === roleBit);
          if (name) index.granted[name].add(ethers.getAddress(ev.args.account));
        }
        for (const ev of regs) index.registered.add(ethers.getAddress(ev.args.user));
        index.scannedTo = to;
        from = to + 1;
      }
    })().finally(() => { scanning = null; });
    return scanning;
  }

  async function readProfile(address, blockTag) {
    const p = await registry.getProfile(address, { blockTag });
    const status = Number(p.status);
    const roleMask = Number(p.roles);
    return {
      address,
      status: STATUS_NAMES[status],
      isActive: status === 2,
      roleMask,
      roles: rolesFromMask(roleMask),
      registeredAt: Number(p.registeredAt),
      verifiedAt: Number(p.verifiedAt),
      kycRef: p.kycRef,
    };
  }

  // ───────── request handling ─────────
  const hits = new Map(); // ip -> {count, windowStart}
  function limit(ip) {
    const now = Date.now();
    const h = hits.get(ip);
    if (!h || now - h.windowStart > 60000) { hits.set(ip, { count: 1, windowStart: now }); return; }
    if (++h.count > rateLimitPerMinute) throw new HttpError(429, "rate limit exceeded", { retryable: true });
  }

  const parseAddress = (s) => {
    if (!ethers.isAddress(s)) throw new HttpError(400, "invalid address");
    return ethers.getAddress(s);
  };

  async function route(method, pathname, query) {
    if (method !== "GET") throw new HttpError(405, "method not allowed");
    const parts = pathname.split("/").filter(Boolean);

    if (pathname === "/health") {
      const [net, blockNumber] = await Promise.all([provider.getNetwork(), provider.getBlockNumber()]);
      return { ok: true, chainId: Number(net.chainId), registry: registryAddress, blockNumber };
    }
    if (pathname === "/v1/roles") return { roles: ROLE_BITS, statuses: STATUS_NAMES };

    const blockNumber = await provider.getBlockNumber();
    const meta = { chainId: Number((await provider.getNetwork()).chainId), blockNumber };

    if (parts[0] === "v1" && parts[1] === "users" && parts.length === 3) {
      const address = parseAddress(parts[2]);
      return { ...(await readProfile(address, blockNumber)), source: meta };
    }
    if (parts[0] === "v1" && parts[1] === "roles" && parts[3] === "members" && parts.length === 4) {
      const name = parts[2].toUpperCase();
      if (!(name in ROLE_BITS)) throw new HttpError(404, "unknown role", { validRoles: Object.keys(ROLE_BITS) });
      await sync(blockNumber);
      const candidates = [...index.granted[name]];
      const profiles = await Promise.all(candidates.map((a) => readProfile(a, blockNumber))); // re-verified on-chain
      const members = profiles.filter((p) => (p.roleMask & ROLE_BITS[name]) !== 0);
      return { role: name, count: members.length, members, source: meta };
    }
    if (parts[0] === "v1" && parts[1] === "users" && parts.length === 2) {
      const want = (query.get("status") || "Pending");
      if (!STATUS_NAMES.includes(want) || want === "None") throw new HttpError(400, "status must be Pending, Active or Suspended");
      await sync(blockNumber);
      const profiles = await Promise.all([...index.registered].map((a) => readProfile(a, blockNumber)));
      const users = profiles.filter((p) => p.status === want);
      return { status: want, count: users.length, users, source: meta };
    }
    throw new HttpError(404, "not found");
  }

  const server = http.createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": corsOrigin,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(JSON.stringify(body));
    };
    try {
      if (req.method === "OPTIONS") return send(204, {});
      limit(req.socket.remoteAddress || "unknown");
      const url = new URL(req.url, "http://localhost");
      send(200, await route(req.method, url.pathname, url.searchParams));
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message, ...e.extra });
      // Anything else = chain/RPC trouble. Do not leak internals.
      send(503, { error: "upstream blockchain node unavailable", retryable: true });
    }
  });

  return {
    server,
    listen: (port = 0, host = "127.0.0.1") => new Promise((r) => server.listen(port, host, () => r(server.address().port))),
    close: () => new Promise((r) => server.close(() => r())),
  };
}

module.exports = { createService, ROLE_BITS, STATUS_NAMES };
