// TrustLend frontend (Member 1): wallet connect, role-based UI shell, transaction status / error handling.
// All dynamic text is written with textContent (never innerHTML) so chain data cannot inject markup.
(() => {
  "use strict";
  const { ethers } = window;
  const ROLE = { ADMIN: 1, PAUSER: 2, VERIFIER: 4, LENDER: 8, BORROWER: 16, ARBITER: 32 };
  const ROLE_NAMES = Object.keys(ROLE);
  const STATUS = ["None", "Pending", "Active", "Suspended"];
  const $ = (id) => document.getElementById(id);
  const state = { cfg: null, abi: null, browser: null, signer: null, account: null, registry: null, reader: null, profile: null, admin: null, paused: false, serviceUp: true, kyc: null };

  const rolesOf = (mask) => ROLE_NAMES.filter((n) => (mask & ROLE[n]) !== 0);
  const short = (s) => (s ? `${s.slice(0, 6)}…${s.slice(-4)}` : "");
  const fmtTime = (sec) => (Number(sec) ? new Date(Number(sec) * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "-");

  // ───────────── friendly messages for the contract's custom errors ─────────────
  const ERR = {
    Unauthorized: (a) => `Not allowed: your wallet does not hold the required role (${rolesOf(Number(a[1])).join(" or ") || "n/a"}), or your account is not Active.`,
    EnforcedPause: () => "The system is paused by the emergency switch.",
    ExpectedPause: () => "The system is not paused.",
    ZeroAddress: () => "The zero address is not allowed.",
    AlreadyRegistered: () => "This wallet is already registered.",
    NotRegistered: () => "That wallet is not registered yet.",
    InvalidRole: () => "That role cannot be used here (self-registration allows only Lender and/or Borrower).",
    InvalidKycRef: () => "A KYC reference is required.",
    InvalidStatus: (a) => `Not possible while the account is ${STATUS[Number(a[1])] || "in this state"}.`,
    RoleAlreadyAssigned: () => "The wallet already has that role.",
    RoleNotAssigned: () => "The wallet does not have that role.",
    SelfAction: () => "You cannot do that to yourself.",
    CannotSuspendAdmin: () => "The admin account cannot be suspended.",
    NotPendingAdmin: () => "Only the wallet nominated as the new admin can accept.",
    NoPendingAdmin: () => "There is no pending admin transfer.",
  };

  // Wallets nest the revert bytes in different places (e.data, e.error.data.data, e.info.error.data.originalError.data ...).
  function findRevertData(x, depth = 0) {
    if (!x || depth > 6) return null;
    if (typeof x === "string") return /^0x[0-9a-fA-F]{8,}$/.test(x) ? x : null;
    if (typeof x !== "object") return null;
    for (const k of ["data", "error", "info", "originalError", "revert"]) {
      const hit = findRevertData(x[k], depth + 1);
      if (hit) return hit;
    }
    return null;
  }

  function decodeError(e) {
    if (e && (e.code === 4001 || e.code === "ACTION_REJECTED")) return "You rejected the request in your wallet.";
    const raw = findRevertData(e);
    if (state.registry && typeof raw === "string" && raw.startsWith("0x") && raw.length >= 10) {
      try {
        const parsed = state.registry.interface.parseError(raw);
        if (parsed && ERR[parsed.name]) return ERR[parsed.name](parsed.args);
        if (parsed) return `Rejected by the contract: ${parsed.name}`;
      } catch { /* fall through */ }
    }
    if (e?.revert?.name && ERR[e.revert.name]) return ERR[e.revert.name](e.revert.args || []);
    return (e?.shortMessage || e?.message || "Unknown error").slice(0, 220);
  }

  // ───────────── transaction log ─────────────
  function addLog(title, kind, msg) {
    const ul = $("txLog");
    if (ul.firstElementChild && ul.firstElementChild.classList.contains("hint")) ul.innerHTML = "";
    const li = document.createElement("li");
    const t = document.createElement("div"); t.className = "t";
    const m = document.createElement("div"); m.className = "m";
    li.append(t, m);
    ul.prepend(li);
    setLog(li, title, kind, msg);
    return li;
  }
  function setLog(li, title, kind, msg) {
    li.className = kind;
    li.children[0].textContent = `${kind === "ok" ? "✔" : kind === "fail" ? "✖" : "…"} ${title}`;
    li.children[1].textContent = msg;
  }

  async function sendTx(title, fn, args) {
    const li = addLog(title, "pending", "Checking the transaction…");
    try {
      if (!state.registry) throw new Error("Connect your wallet first.");
      await state.registry[fn].staticCall(...args); // pre-flight: shows contract rejections before the wallet pops up
      setLog(li, title, "pending", "Waiting for you to confirm in your wallet…");
      const tx = await state.registry[fn](...args);
      setLog(li, title, "pending", `Submitted ${short(tx.hash)}. Waiting for confirmation…`);
      const rc = await tx.wait();
      if (!rc || rc.status !== 1) throw new Error("Transaction failed on-chain.");
      setLog(li, title, "ok", `Confirmed in block ${rc.blockNumber} · gas used ${rc.gasUsed.toString()} · tx ${short(tx.hash)}`);
      await refresh();
    } catch (e) {
      setLog(li, title, "fail", decodeError(e));
    }
  }

  // ───────────── off-chain service ─────────────
  async function svc(path) {
    try {
      const r = await fetch(state.cfg.serviceUrl + path);
      if (!r.ok) throw new Error(String(r.status));
      state.serviceUp = true;
      $("serviceBanner").hidden = true;
      return await r.json();
    } catch {
      state.serviceUp = false;
      $("serviceBanner").hidden = false;
      return null;
    }
  }

  // ───────────── wallet ─────────────
  async function connect() {
    if (!window.ethereum) { addLog("Wallet", "fail", "No wallet found. Install MetaMask (or another EIP-1193 wallet)."); return; }
    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });
      state.browser = new ethers.BrowserProvider(window.ethereum);
      state.signer = await state.browser.getSigner();
      state.account = ethers.getAddress(await state.signer.getAddress());
      state.registry = new ethers.Contract(state.cfg.registry, state.abi, state.signer);
      state.reader = state.registry;
      window.ethereum.on?.("accountsChanged", () => location.reload());
      window.ethereum.on?.("chainChanged", () => location.reload());
      await refresh();
    } catch (e) { addLog("Connect wallet", "fail", decodeError(e)); }
  }

  async function switchNetwork() {
    try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x" + state.cfg.chainId.toString(16) }] }); location.reload(); }
    catch (e) { addLog("Switch network", "fail", decodeError(e)); }
  }

  // ───────────── read state + render ─────────────
  async function refresh() {
    if (!state.registry) return;
    const net = await state.browser.getNetwork();
    const wrong = Number(net.chainId) !== Number(state.cfg.chainId);
    $("wrongNet").hidden = !wrong;
    $("netBadge").hidden = false;
    $("netBadge").textContent = wrong ? `Chain ${net.chainId} (wrong)` : `${state.cfg.network} · chain ${net.chainId}`;
    $("accountBadge").hidden = false;
    $("accountBadge").textContent = short(state.account);
    $("connectBtn").hidden = true;
    if (wrong) { render(); return; }
    try {
      const [p, paused, admin, pending] = await Promise.all([
        state.registry.getProfile(state.account), state.registry.paused(), state.registry.admin(), state.registry.pendingAdmin(),
      ]);
      state.profile = { status: Number(p.status), roles: Number(p.roles), registeredAt: p.registeredAt, verifiedAt: p.verifiedAt, kycRef: p.kycRef };
      state.paused = paused; state.admin = admin; state.pending = pending;
    } catch (e) { addLog("Load profile", "fail", decodeError(e)); return; }
    render();
    if (!$("verifierCard").hidden) loadQueue();
    if (!$("adminCard").hidden) loadStaff();
  }

  function render() {
    const p = state.profile;
    const connected = !!state.account;
    $("welcome").hidden = connected;
    $("profileCard").hidden = !connected || !p;
    $("lookupCard").hidden = !connected;
    $("pausedBanner").hidden = !state.paused;
    if (!p) return;

    $("pAddr").textContent = state.account;
    const st = STATUS[p.status];
    const pill = $("pStatus"); pill.textContent = st; pill.className = `pill ${st}`;
    const rolesEl = $("pRoles"); rolesEl.textContent = "";
    const names = rolesOf(p.roles);
    if (!names.length) rolesEl.textContent = "none";
    names.forEach((n) => { const s = document.createElement("span"); s.className = "role"; s.textContent = n; rolesEl.append(s); });
    $("pReg").textContent = fmtTime(p.registeredAt);
    $("pVer").textContent = fmtTime(p.verifiedAt);
    $("pKyc").textContent = p.kycRef === ethers.ZeroHash ? "-" : p.kycRef;
    $("statusHelp").textContent = {
      None: "You are not registered yet. Use the form below to join.",
      Pending: "Registered. A verifier must approve your KYC before you can act.",
      Active: "Verified and active.",
      Suspended: "Your account is suspended. Contact the administrator.",
    }[st];

    const active = p.status === 2;
    const has = (r) => active && (p.roles & r) !== 0;
    $("registerCard").hidden = p.status !== 0;
    $("verifierCard").hidden = !(has(ROLE.VERIFIER) || has(ROLE.ADMIN));
    $("adminCard").hidden = !has(ROLE.ADMIN);
    $("pauseCard").hidden = !(has(ROLE.PAUSER) || has(ROLE.ADMIN));
    $("pauseBtn").disabled = state.paused;
    $("unpauseBtn").hidden = !has(ROLE.ADMIN);
    $("unpauseBtn").disabled = !state.paused;
    $("pendingAdmin").textContent = state.pending && state.pending !== ethers.ZeroAddress ? state.pending : "-";
    $("slotBorrower").hidden = !has(ROLE.BORROWER);
    $("slotLender").hidden = !has(ROLE.LENDER);
    $("slotArbiter").hidden = !has(ROLE.ARBITER);
    $("slots").hidden = $("slotBorrower").hidden && $("slotLender").hidden && $("slotArbiter").hidden;
    // The pending admin sees an accept button inside the profile area
    let acc = $("acceptAdminBtn");
    const isPendingAdmin = state.pending && state.pending !== ethers.ZeroAddress && state.pending === state.account;
    if (isPendingAdmin && !acc) {
      acc = document.createElement("button"); acc.id = "acceptAdminBtn"; acc.className = "primary"; acc.textContent = "Accept admin role";
      acc.onclick = () => sendTx("Accept admin role", "acceptAdmin", []);
      $("statusHelp").after(acc);
    } else if (!isPendingAdmin && acc) acc.remove();
  }

  // ───────────── verifier desk / staff list ─────────────
  async function loadQueue() {
    const data = await svc("/v1/users?status=Pending");
    const tb = $("queueTable").querySelector("tbody");
    tb.textContent = "";
    $("queueEmpty").hidden = true;
    if (!data) return;
    if (!data.users.length) { $("queueEmpty").hidden = false; return; }
    for (const u of data.users) {
      const tr = document.createElement("tr");
      const mk = (txt, cls) => { const td = document.createElement("td"); td.textContent = txt; if (cls) td.className = cls; return td; };
      tr.append(mk(short(u.address), "mono"), mk(short(u.kycRef), "mono small"), mk(fmtTime(u.registeredAt)));
      const act = document.createElement("td"); const row = document.createElement("div"); row.className = "row";
      const v = document.createElement("button"); v.textContent = "Verify"; v.className = "primary";
      v.onclick = () => sendTx(`Verify ${short(u.address)}`, "verifyUser", [u.address]);
      const s = document.createElement("button"); s.textContent = "Suspend";
      s.onclick = () => sendTx(`Suspend ${short(u.address)}`, "suspendUser", [u.address]);
      row.append(v, s); act.append(row); tr.append(act); tb.append(tr);
    }
  }
  async function loadStaff() {
    const ul = $("staffList"); ul.textContent = "";
    for (const r of ["PAUSER", "VERIFIER", "ARBITER"]) {
      const data = await svc(`/v1/roles/${r}/members`);
      const li = document.createElement("li");
      li.textContent = data ? `${r}: ${data.members.map((m) => `${short(m.address)} (${m.status})`).join(", ") || "none"}` : `${r}: unavailable`;
      ul.append(li);
    }
  }

  // ───────────── KYC hashing (salted, local only) ─────────────
  async function recomputeKyc() {
    const file = $("kycFile").files[0];
    const text = $("kycText").value.trim();
    if (!file && !text) { state.kyc = null; $("kycHash").textContent = "-"; $("kycSalt").textContent = "-"; return; }
    const content = file ? new Uint8Array(await file.arrayBuffer()) : ethers.toUtf8Bytes(text);
    if (!state.salt) state.salt = ethers.hexlify(ethers.randomBytes(16));
    state.kyc = ethers.keccak256(ethers.concat([content, state.salt]));
    $("kycHash").textContent = state.kyc;
    $("kycSalt").textContent = state.salt;
  }

  // ───────────── wiring ─────────────
  function addrOrFail(id, label) {
    const v = $(id).value.trim();
    if (!ethers.isAddress(v)) { addLog(label, "fail", "Enter a valid wallet address (0x…)."); return null; }
    return ethers.getAddress(v);
  }
  function wire() {
    $("connectBtn").onclick = connect;
    $("switchNetBtn").onclick = switchNetwork;
    $("kycFile").onchange = recomputeKyc;
    $("kycText").oninput = recomputeKyc;
    $("refreshQueueBtn").onclick = loadQueue;
    $("registerBtn").onclick = async () => {
      let mask = 0;
      if ($("regLender").checked) mask |= ROLE.LENDER;
      if ($("regBorrower").checked) mask |= ROLE.BORROWER;
      if (!mask) return addLog("Register", "fail", "Choose Lender and/or Borrower.");
      await recomputeKyc();
      if (!state.kyc) return addLog("Register", "fail", "Add a KYC document or reference text first.");
      sendTx("Register", "register", [mask, state.kyc]);
    };
    $("assignBtn").onclick = () => { const a = addrOrFail("admAddr", "Assign role"); if (a) sendTx(`Assign ${rolesOf(+$("admRole").value)[0]} to ${short(a)}`, "assignRole", [a, +$("admRole").value]); };
    $("revokeBtn").onclick = () => { const a = addrOrFail("admAddr", "Revoke role"); if (a) sendTx(`Revoke ${rolesOf(+$("admRole").value)[0]} from ${short(a)}`, "revokeRole", [a, +$("admRole").value]); };
    $("suspendBtn").onclick = () => { const a = addrOrFail("admAddr", "Suspend"); if (a) sendTx(`Suspend ${short(a)}`, "suspendUser", [a]); };
    $("reinstateBtn").onclick = () => { const a = addrOrFail("admAddr", "Reinstate"); if (a) sendTx(`Reinstate ${short(a)}`, "reinstateUser", [a]); };
    $("transferBtn").onclick = () => { const a = addrOrFail("admNew", "Admin transfer"); if (a) sendTx(`Nominate ${short(a)} as admin`, "transferAdmin", [a]); };
    $("cancelTransferBtn").onclick = () => sendTx("Cancel admin transfer", "cancelAdminTransfer", []);
    $("pauseBtn").onclick = () => sendTx("Pause system", "pause", []);
    $("unpauseBtn").onclick = () => sendTx("Resume system", "unpause", []);
    $("lookBtn").onclick = async () => {
      const a = addrOrFail("lookAddr", "Look up"); if (!a) return;
      try {
        const p = await state.registry.getProfile(a);
        $("lookResult").textContent = `${a}: ${STATUS[Number(p.status)]} · roles: ${rolesOf(Number(p.roles)).join(", ") || "none"}`;
      } catch (e) { $("lookResult").textContent = decodeError(e); }
    };
  }

  async function init() {
    try {
      const [cfg, abi] = await Promise.all([fetch("deployment.json").then((r) => r.json()), fetch("abi/Registry.json").then((r) => r.json())]);
      state.cfg = cfg; state.abi = abi;
    } catch {
      addLog("Setup", "fail", "deployment.json not found. Run the deploy script first (see README).");
      $("connectBtn").disabled = true;
      return;
    }
    wire();
  }
  init();
  window.__trustlend = { state, decodeError }; // handy for debugging / automated UI test
})();
