(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const { ethers } = window;
  let cfg, escrow, workflow, provider, signer, decoders = [];
  const ESCROW_STATUS = ["None", "Held", "Released", "Repaid", "Disputed", "Resolved"];
  const WF_STATE = ["None", "Requested", "Approved", "Rejected", "Cancelled", "Funded", "Repaid", "Disputed"];
  const show = (m) => { $("status").textContent = String(m); };
  const eth = (v) => ethers.formatEther(v) + " ETH";

  const explain = (e) => window.TLMessages.explain(e, decoders);
  // Every failure is shown twice: pop-up at the top (always visible) and the status box at the bottom.
  function fail(e) {
    const msg = explain(e);
    show(`Failed: ${msg}`);
    window.TLMessages.toast("error", msg);
    return msg;
  }
  function done(msg) { show(msg); window.TLMessages.toast("ok", msg); }

  let watching = false;
  function watchWallet() {
    if (!window.ethereum || watching) return;
    watching = true;
    window.ethereum.on?.("accountsChanged", () => location.reload());
    window.ethereum.on?.("chainChanged", () => location.reload());
  }

  async function connect(request = false) {
    try {
      if (!window.ethereum) { if (request) throw new Error("MetaMask not found."); return; }
      watchWallet();
      let accounts = await window.ethereum.request({ method: "eth_accounts" });
      if (!accounts.length && request) accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      if (!accounts.length) return;
      provider = new ethers.BrowserProvider(window.ethereum);
      const net = await provider.getNetwork();
      signer = await provider.getSigner(accounts[0]);
      $("who").textContent = await signer.getAddress();
      if (Number(net.chainId) !== Number(cfg.chainId)) throw new Error("Wrong network. Switch MetaMask to the Hardhat Local network.");
      const [eAbi, wAbi, rAbi] = await Promise.all(["EscrowDispute", "CoreWorkflow", "Registry"].map(async (n) => (await fetch(`abi/${n}.json`)).json()));
      escrow = new ethers.Contract(cfg.escrow, eAbi, signer);
      workflow = new ethers.Contract(cfg.workflow, wAbi, signer);
      decoders = [new ethers.Interface(eAbi), new ethers.Interface(wAbi), new ethers.Interface(rAbi)];
      show("Connected");
      await refreshCredit();
    } catch (e) { fail(e); }
  }

  function loanId() {
    const n = Number($("loanId").value);
    if ($("loanId").value.trim() === "" || !Number.isSafeInteger(n) || n < 1) throw new Error("Enter a valid loan ID.");
    return n;
  }

  // Pre-flight with staticCall so a failing transaction shows the decoded contract error instead of wasting gas.
  const OK = { fund: "Loan funded.", releaseFunds: "Funds released.", repay: "Loan repaid.", raiseDispute: "Dispute raised.", resolveDispute: "Dispute resolved.", withdraw: "Funds withdrawn." };
  async function tx(title, fn, args, value) {
    try {
      if (!escrow) throw new Error("Connect your wallet first.");
      show("Checking...");
      const overrides = value !== undefined ? { value } : {};
      await escrow[fn].staticCall(...args, overrides);
      const t = await escrow[fn](...args, overrides);
      show("Submitted. Waiting for confirmation...");
      const rc = await t.wait();
      done(OK[fn] || "Done.");
      await refreshCredit();
      if ($("loanResult").textContent.length > 2) await load().catch(() => {});
    } catch (e) { fail(e); }
  }

  async function loanAmount(id) { const l = await workflow.getLoan(id); return l.amountWei; }

  async function load() {
    if (!escrow) throw new Error("Connect your wallet first.");
    const id = loanId();
    let l;
    try { l = await workflow.getLoan(id); }
    catch (e) { $("loanResult").textContent = "Error: " + explain(e); throw e; }
    const d = await escrow.depositOf(id);
    $("loanResult").textContent = JSON.stringify({
      loan: { borrower: l.borrower, amount: eth(l.amountWei), lender: l.lender, workflowState: WF_STATE[Number(l.state)] },
      escrow: { depositLender: d.lender, held: eth(d.amountWei), escrowStatus: ESCROW_STATUS[Number(d.status)] },
    }, null, 2);
  }

  async function refreshCredit() {
    if (!escrow || !signer) return;
    $("credit").textContent = eth(await escrow.balances(await signer.getAddress()));
  }

  // History is read directly from chain logs. No indexer needed: if the off-chain service is down nothing breaks.
  async function events() {
    try {
      if (!escrow) throw new Error("Connect your wallet first.");
      const logs = await escrow.queryFilter("*", cfg.escrowDeployBlock || 0);
      const out = logs.map((l) => ({ block: l.blockNumber, event: l.fragment?.name, args: l.args ? Object.fromEntries(l.fragment.inputs.map((inp, i) => [inp.name, typeof l.args[i] === "bigint" ? l.args[i].toString() : l.args[i]])) : {} }));
      $("eventResult").textContent = out.length ? JSON.stringify(out, null, 2) : "No escrow events yet";
    } catch (e) { $("eventResult").textContent = "Could not read events: " + explain(e); fail(e); }
  }

  const bind = (id, fn) => { $(id).onclick = async () => { try { await fn(); } catch (e) { fail(e); } }; };

  async function init() {
    try {
      cfg = await (await fetch("deployment.json")).json();
      if (!cfg.escrow) throw new Error("Escrow not available.");
    } catch (e) { fail(e); return; }
    bind("connect", () => connect(true));
    bind("fund", async () => { const id = loanId(); await tx("fund", "fund", [id], await loanAmount(id)); });
    bind("release", () => tx("releaseFunds", "releaseFunds", [loanId()]));
    bind("repay", async () => { const id = loanId(); await tx("repay", "repay", [id], await loanAmount(id)); });
    bind("dispute", () => tx("raiseDispute", "raiseDispute", [loanId()]));
    bind("resolve", () => tx("resolveDispute", "resolveDispute", [loanId(), $("payLender").checked]));
    bind("withdraw", () => tx("withdraw", "withdraw", []));
    bind("refreshCredit", refreshCredit);
    bind("load", load);
    bind("events", events);
    watchWallet();
    await connect(false);
  }
  init();
})();
