// Real off-chain component: reads on-chain events and serves a JSON feed, no DB or private keys.
// Start after workflow deployment: node offchain/workflow-listener.js
const http = require("http"); const fs = require("fs"); const path = require("path");
const { ethers } = require("ethers");
const root = path.resolve(__dirname, "..");
const cfg = JSON.parse(fs.readFileSync(path.join(root, "deployments", "localhost.json")));
const abi = JSON.parse(fs.readFileSync(path.join(root, "frontend", "abi", "CoreWorkflow.json")));
const provider = new ethers.JsonRpcProvider(process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545");
const contract = new ethers.Contract(cfg.workflow, abi, provider);
const names = new Set(["LoanRequested", "LoanApproved", "LoanRejected", "LoanCancelled", "LoanFunded", "LoanRepaid", "LoanDisputed"]);
const server = http.createServer(async (req, res) => {
 res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:5173");
 res.setHeader("Content-Type", "application/json; charset=utf-8");
 if (req.url !== "/events") { res.writeHead(404); return res.end(JSON.stringify({error:"Not found"})); }
 try {
  const logs = await provider.getLogs({address:cfg.workflow, fromBlock:cfg.workflowDeployBlock || 0, toBlock:"latest"});
  const events = logs.map(x => { try { const p = contract.interface.parseLog(x); return p && names.has(p.name) ? {name:p.name, loanId:p.args[0].toString(), block:x.blockNumber, txHash:x.transactionHash, actor:typeof p.args[1] === "string" && ethers.isAddress(p.args[1]) ? p.args[1] : null} : null; } catch { return null; } }).filter(Boolean).slice(-100);
  res.end(JSON.stringify({source:"on-chain events", events}));
 } catch(e) { res.writeHead(503); res.end(JSON.stringify({error:e.message})); }
});
server.listen(8788,"127.0.0.1",()=>console.log("Workflow event feed: http://127.0.0.1:8788/events"));
