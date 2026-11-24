(() => {
 "use strict";
 const $ = id => document.getElementById(id); const { ethers } = window;
 let cfg, contract, provider;
 const states = ["None","Requested","Approved","Rejected","Cancelled","Funded","Repaid","Disputed"];
 const show = msg => { $("status").textContent = String(msg); };
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
    if (request) throw new Error("Install MetaMask");
    return;
   }
   watchWallet();
   let accounts = await window.ethereum.request({method:"eth_accounts"});
   if (!accounts.length && request) accounts = await window.ethereum.request({method:"eth_requestAccounts"});
   if (!accounts.length) {
    if (request) show("No authorized account was returned by your wallet.");
    return;
   }
   provider = new ethers.BrowserProvider(window.ethereum);
   const net = await provider.getNetwork();
   const signer = await provider.getSigner(accounts[0]);
   $("who").textContent = await signer.getAddress();
   if (Number(net.chainId) !== Number(cfg.chainId)) throw new Error(`Wrong chain: expected ${cfg.chainId}, got ${net.chainId}. Switch wallet network.`);
   const abi = await (await fetch("abi/CoreWorkflow.json")).json();
   contract = new ethers.Contract(cfg.workflow, abi, signer);
   show("Connected");
  } catch(e) { show(e.shortMessage || e.message); }
 }
 async function tx(fn,args) {
  try {
   if (!contract) throw new Error("Connect wallet first");
   show(`Checking ${fn}...`);
   await contract[fn].staticCall(...args);
   const t = await contract[fn](...args); show(`Submitted: ${t.hash}
Waiting for confirmation...`);
   const rc = await t.wait(); show(`Confirmed ${fn} in block ${rc.blockNumber}; gas ${rc.gasUsed}`);
  } catch(e) { show(`Failed: ${e.shortMessage || e.reason || e.message}`); }
 }
 function id(el) { const n=Number($(el).value); if (!Number.isSafeInteger(n) || n<1) throw new Error("Enter a valid loan ID"); return n; }
 function bind(el,fn) { $(el).onclick=async()=>{ try { await fn(); } catch(e) {show(e.message);} }; }
 async function load() { if(!contract) throw new Error("Connect first"); const l=await contract.getLoan(id("loanId")); $("loanResult").textContent=JSON.stringify({borrower:l.borrower,amountETH:ethers.formatEther(l.amountWei),lender:l.lender,state:states[Number(l.state)]},null,2); }
 async function events() { try {const r=await fetch("http://127.0.0.1:8788/events"); const d=await r.json(); if(!r.ok) throw new Error(d.error); $("eventResult").textContent=JSON.stringify(d.events,null,2);} catch(e) { $("eventResult").textContent="Event service unavailable: "+e.message; } }
 async function init() {
  try {cfg=await(await fetch("deployment.json")).json(); if(!cfg.workflow) throw new Error("Deploy workflow first");}catch(e){show(e.message);return;}
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
