// Frontend test: loads the REAL index.html + app.js in a DOM (jsdom), with a wallet mock (EIP-1193) that signs through
// the in-process Hardhat chain, the REAL registry contract and the REAL role-lookup service. No browser extension needed.
const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
const nodeCrypto = require("crypto");
const { JSDOM } = require("jsdom");
const { createService } = require("../offchain/role-service/service");
const { ROLE, kyc } = require("./helpers");

const FRONT = path.join(__dirname, "..", "frontend");
const html = fs.readFileSync(path.join(FRONT, "index.html"), "utf8");
const ethersJs = fs.readFileSync(path.join(FRONT, "vendor", "ethers.umd.min.js"), "utf8");
const appJs = fs.readFileSync(path.join(FRONT, "app.js"), "utf8");
const abi = fs.readFileSync(path.join(FRONT, "abi", "Registry.json"), "utf8");

async function waitFor(fn, what, ms = 8000) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for: " + what);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("Frontend (role-based UI shell, wallet connect, tx status/errors)", function () {
  this.timeout(60000);
  let registry, signers, svc, cfg;
  const windows = [];

  before(async () => {
    signers = await ethers.getSigners();
    const [admin, pauser, verifier, arbiter, lender] = signers;
    registry = await (await ethers.getContractFactory("Registry")).deploy(admin.address);
    await registry.assignRole(pauser.address, ROLE.PAUSER);
    await registry.assignRole(verifier.address, ROLE.VERIFIER);
    await registry.assignRole(arbiter.address, ROLE.ARBITER);
    await registry.connect(lender).register(ROLE.LENDER, kyc("lender"));
    await registry.connect(verifier).verifyUser(lender.address);
    svc = createService({ provider: ethers.provider, registryAddress: await registry.getAddress(), rateLimitPerMinute: 10000 });
    const port = await svc.listen(0);
    cfg = { network: "hardhat", chainId: 31337, registry: await registry.getAddress(), serviceUrl: `http://127.0.0.1:${port}` };
  });
  after(async () => { windows.forEach((w) => w.close()); await svc.close(); });

  /** Opens the app as `signer` (or not connected). */
  async function openApp({ signer, reportedChainId, serviceUrl } = {}) {
    const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/", pretendToBeVisual: true });
    const w = dom.window;
    windows.push(w);
    w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
    w.crypto = { getRandomValues: (a) => nodeCrypto.randomFillSync(a) };
    w.fetch = async (url) => {
      if (url === "deployment.json") return { ok: true, json: async () => ({ ...cfg, serviceUrl: serviceUrl || cfg.serviceUrl }) };
      if (url === "abi/Registry.json") return { ok: true, json: async () => JSON.parse(abi) };
      const r = await fetch(url);
      return { ok: r.ok, status: r.status, json: () => r.json() };
    };
    if (signer) {
      w.ethereum = {
        on() {},
        request: async ({ method, params }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [signer.address];
          if (method === "eth_chainId" && reportedChainId) return "0x" + reportedChainId.toString(16);
          return hre.network.provider.request({ method, params });
        },
      };
    }
    w.eval(ethersJs);
    w.eval(appJs);
    await waitFor(() => w.__trustlend.state.cfg, "app init");
    return w;
  }
  const $ = (w, id) => w.document.getElementById(id);
  const connect = async (w) => { $(w, "connectBtn").click(); await waitFor(() => w.__trustlend.state.profile, "profile loaded"); };
  const logHas = (w, text) => [...w.document.querySelectorAll("#txLog li")].some((li) => li.textContent.includes(text));

  it("before connecting: shows welcome + connect button, no role panels", async () => {
    const w = await openApp();
    expect($(w, "welcome").hidden).to.equal(false);
    expect($(w, "connectBtn").hidden).to.equal(false);
    for (const id of ["registerCard", "verifierCard", "adminCard", "pauseCard", "profileCard"]) expect($(w, id).hidden).to.equal(true);
  });

  it("without a wallet extension: a clear error, not a crash", async () => {
    const w = await openApp();
    $(w, "connectBtn").click();
    await waitFor(() => logHas(w, "No wallet found"), "no-wallet message");
  });

  it("new wallet sees ONLY the registration form; registering succeeds and shows Pending", async () => {
    const newcomer = signers[10];
    const w = await openApp({ signer: newcomer });
    await connect(w);
    expect($(w, "pStatus").textContent).to.equal("None");
    expect($(w, "registerCard").hidden).to.equal(false);
    for (const id of ["verifierCard", "adminCard", "pauseCard", "slots"]) expect($(w, id).hidden).to.equal(true);
    // nothing chosen -> friendly validation message, no tx
    $(w, "registerBtn").click();
    await waitFor(() => logHas(w, "Choose Lender and/or Borrower"), "validation");
    // fill the form
    $(w, "regBorrower").checked = true;
    $(w, "kycText").value = "passport ref 123";
    $(w, "kycText").dispatchEvent(new w.Event("input"));
    await waitFor(() => $(w, "kycHash").textContent.startsWith("0x"), "kyc hash");
    expect($(w, "kycSalt").textContent).to.match(/^0x[0-9a-f]{32}$/);
    $(w, "registerBtn").click();
    await waitFor(() => logHas(w, "Confirmed in block"), "register confirmed");
    await waitFor(() => $(w, "pStatus").textContent === "Pending", "status pending");
    expect($(w, "registerCard").hidden).to.equal(true);
    expect($(w, "pRoles").textContent).to.contain("BORROWER");
    // on-chain truth matches, and the raw document text is NOT what was stored
    const p = await registry.getProfile(newcomer.address);
    expect(Number(p.status)).to.equal(1);
    expect(p.kycRef).to.equal($(w, "kycHash").textContent);
    expect(p.kycRef).to.not.equal(ethers.keccak256(ethers.toUtf8Bytes("passport ref 123"))); // salted: not guessable from the text
  });

  it("verifier sees the desk and the pending queue, and can verify", async () => {
    const verifier = signers[2];
    const w = await openApp({ signer: verifier });
    await connect(w);
    expect($(w, "verifierCard").hidden).to.equal(false);
    expect($(w, "adminCard").hidden).to.equal(true);
    expect($(w, "pauseCard").hidden).to.equal(true);
    await waitFor(() => $(w, "queueTable").querySelectorAll("tbody tr").length === 1, "queue row");
    [...$(w, "queueTable").querySelectorAll("button")].find((b) => b.textContent === "Verify").click();
    await waitFor(() => logHas(w, "Confirmed in block"), "verify confirmed");
    await waitFor(() => !$(w, "queueEmpty").hidden, "queue emptied");
    expect(Number(await registry.statusOf(signers[10].address))).to.equal(2);
  });

  it("admin console: assign role works; an invalid action shows a decoded contract error", async () => {
    const admin = signers[0];
    const w = await openApp({ signer: admin });
    await connect(w);
    expect($(w, "adminCard").hidden).to.equal(false);
    expect($(w, "pauseCard").hidden).to.equal(false);
    // bad input is caught in the UI
    $(w, "assignBtn").click();
    await waitFor(() => logHas(w, "valid wallet address"), "address validation");
    // contract-level rejection: LENDER for an unregistered wallet
    $(w, "admAddr").value = signers[12].address;
    $(w, "admRole").value = String(ROLE.LENDER);
    $(w, "assignBtn").click();
    await waitFor(() => logHas(w, "not registered yet"), "decoded NotRegistered");
    // success path: make signers[12] an arbiter
    $(w, "admRole").value = String(ROLE.ARBITER);
    $(w, "assignBtn").click();
    await waitFor(() => logHas(w, "Confirmed in block"), "assign confirmed");
    expect(await registry.hasActiveRole(signers[12].address, ROLE.ARBITER)).to.equal(true);
    await waitFor(() => $(w, "staffList").textContent.includes("ARBITER:") && $(w, "staffList").textContent.includes(signers[12].address.slice(0, 6)), "staff directory");
  });

  it("pause flow: pauser pauses, banner appears for everyone, only admin sees the resume button", async () => {
    const wp = await openApp({ signer: signers[1] });
    await connect(wp);
    expect($(wp, "unpauseBtn").hidden).to.equal(true);
    $(wp, "pauseBtn").click();
    await waitFor(() => $(wp, "pausedBanner").hidden === false, "paused banner");
    expect(await registry.paused()).to.equal(true);
    // while paused a registration shows the decoded EnforcedPause message
    const wn = await openApp({ signer: signers[11] });
    await connect(wn);
    expect($(wn, "pausedBanner").hidden).to.equal(false);
    $(wn, "regLender").checked = true;
    $(wn, "kycText").value = "x"; $(wn, "kycText").dispatchEvent(new wn.Event("input"));
    await waitFor(() => $(wn, "kycHash").textContent.startsWith("0x"), "hash");
    $(wn, "registerBtn").click();
    await waitFor(() => logHas(wn, "paused by the emergency switch"), "pause error shown");
    // admin resumes
    const wa = await openApp({ signer: signers[0] });
    await connect(wa);
    expect($(wa, "unpauseBtn").hidden).to.equal(false);
    $(wa, "unpauseBtn").click();
    await waitFor(() => $(wa, "pausedBanner").hidden === true, "resumed");
    expect(await registry.paused()).to.equal(false);
  });

  it("active lender sees the lender workspace slot only; a suspended user sees a clear status", async () => {
    const w = await openApp({ signer: signers[4] });
    await connect(w);
    expect($(w, "slotLender").hidden).to.equal(false);
    expect($(w, "slotBorrower").hidden).to.equal(true);
    expect($(w, "verifierCard").hidden).to.equal(true);
    await registry.connect(signers[0]).suspendUser(signers[4].address);
    const w2 = await openApp({ signer: signers[4] });
    await connect(w2);
    expect($(w2, "pStatus").textContent).to.equal("Suspended");
    expect($(w2, "slots").hidden).to.equal(true);
    expect($(w2, "statusHelp").textContent).to.contain("suspended");
  });

  it("wrong network: shows the warning and does not read contract data", async () => {
    const w = await openApp({ signer: signers[0], reportedChainId: 1 });
    $(w, "connectBtn").click();
    await waitFor(() => $(w, "wrongNet").hidden === false, "wrong network banner");
    expect(w.__trustlend.state.profile).to.equal(null);
  });

  it("off-chain service down: banner appears, on-chain actions still work", async () => {
    const w = await openApp({ signer: signers[2], serviceUrl: "http://127.0.0.1:1" });
    await connect(w);
    await waitFor(() => $(w, "serviceBanner").hidden === false, "service banner");
    expect($(w, "pStatus").textContent).to.equal("Active"); // profile came straight from the chain
  });

  it("renders chain data as text, never as HTML", async () => {
    const w = await openApp({ signer: signers[2] });
    await connect(w);
    const assignments = (appJs.match(/\.innerHTML\s*=\s*[^;]+/g) || []).map((a) => a.split("=")[1].trim());
    expect(assignments.every((v) => v === '""')).to.equal(true); // the only allowed use is clearing a list with ""
  });
});
