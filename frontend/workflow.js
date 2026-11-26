(() => {
 "use strict";
 const $ = id => document.getElementById(id); const { ethers } = window;
 let cfg, contract, provider;
 const states = ["None","Requested","Approved","Rejected","Cancelled","Funded","Repaid","Disputed"];
 let decoders = [];
 const show = msg => { $("status").textContent = String(msg); };
 const explain = e => window.TLMessages.explain(e, decoders);
 function fail(e) { const m = explain(e); show(`Failed: ${m}`); window.TLMessages.toast("error", m); return m; }
 function done(m) { show(m); window.TLMessages.toast("ok", m); }
 let watchingWallet = false;
 function watchWallet() {
  if (!window.ethereum || watchingWallet) return;
  watchingWallet = true;
  window.ethereum.on?.("accountsChanged", () => location.reload());
  window.ethereum.on?.("chainChanged", () => location.reload());
 }
 async function connect(request = false) {
  try {
   if (!window.ethereum) {
    if (request) throw new Error("MetaMask not found.");
    return;
   }
   watchWallet();
   let accounts = await window.ethereum.request({method:"eth_accounts"});
   if (!accounts.length && request) accounts = await window.ethereum.request({method:"eth_requestAccounts"});
   if (!accounts.length) {
    if (request) fail(new Error("No account connected."));
    return;
   }
   provider = new ethers.BrowserProvider(window.ethereum);
   const net = await provider.getNetwork();
   const signer = await provider.getSigner(accounts[0]);
   $("who").textContent = await signer.getAddress();
   if (Number(net.chainId) !== Number(cfg.chainId)) throw new Error("Wrong network. Switch MetaMask to the Hardhat Local network.");
   const abi = await (await fetch("abi/CoreWorkflow.json")).json();
   contract = new ethers.Contract(cfg.workflow, abi, signer);
   decoders = [new ethers.Interface(abi)];
   show("Connected");
  } catch(e) { fail(e); }
 }
 const OK = { requestLoan: "Loan requested.", approveLoan: "Loan approved.", rejectLoan: "Loan rejected.", cancelLoan: "Loan cancelled." };
 async function tx(fn,args) {
  try {
   if (!contract) throw new Error("Connect your wallet first.");
   show("Checking...");
   await contract[fn].staticCall(...args);
   const t = await contract[fn](...args); show("Submitted. Waiting for confirmation...");
   const rc = await t.wait(); done(OK[fn] || "Done.");
  } catch(e) { fail(e); }
 }
 function id(el) { const n=Number($(el).value); if ($(el).value.trim()==="" || !Number.isSafeInteger(n) || n<1) throw new Error("Enter a valid loan ID."); return n; }
 function bind(el,fn) { $(el).onclick=async()=>{ try { await fn(); } catch(e) { fail(e); } }; }
 async function load() { if(!contract) throw new Error("Connect your wallet first."); let l; try { l=await contract.getLoan(id("loanId")); } catch(e) { $("loanResult").textContent="Error: "+explain(e); throw e; } $("loanResult").textContent=JSON.stringify({borrower:l.borrower,amountETH:ethers.formatEther(l.amountWei),lender:l.lender,state:states[Number(l.state)]},null,2); }
 async function events() { try {const r=await fetch("http://127.0.0.1:8788/events"); const d=await r.json(); if(!r.ok) throw new Error(d.error); $("eventResult").textContent=JSON.stringify(d.events,null,2);} catch(e) { $("eventResult").textContent="Event service unavailable."; window.TLMessages.toast("info","Event service unavailable."); } }
 async function init() {
  try {cfg=await(await fetch("deployment.json")).json(); if(!cfg.workflow) throw new Error("Workflow not available.");}catch(e){fail(e);return;}
  bind("connect",()=>connect(true));
  bind("request",()=>tx("requestLoan",[ethers.parseEther($("amount").value)]));
  bind("approve",()=>tx("approveLoan",[id("reviewId")]));
  bind("reject",()=>tx("rejectLoan",[id("reviewId")]));
  bind("cancel",()=>tx("cancelLoan",[id("loanId")]));
  bind("load",load); bind("events",events);
  watchWallet();
  await connect(false);
 }
 init();
})();
