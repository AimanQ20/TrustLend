// Smoke test against a RUNNING local deployment (npm run node + npm run deploy:all):  npm run smoke:escrow
// Walks the full money flow through the DEPLOYED contracts using the demo accounts.
const hre = require("hardhat");
const cfg = require("../deployments/localhost.json");
async function main() {
  const { ethers } = hre;
  const s = await ethers.getSigners();
  const by = (a) => s.find((x) => x.address.toLowerCase() === a.toLowerCase());
  const d = cfg.demoAccounts;
  const [verifier, lender, borrower, arbiter] = [d.verifier, d.lender, d.borrower, d.arbiter].map(by);
  const wf = await ethers.getContractAt("CoreWorkflow", cfg.workflow);
  const es = await ethers.getContractAt("EscrowDispute", cfg.escrow);
  const one = ethers.parseEther("1");
  const next = async () => { await (await wf.connect(borrower).requestLoan(one)).wait(); const id = (await wf.nextLoanId()) - 1n; await (await wf.connect(verifier).approveLoan(id)).wait(); return id; };
  let id = await next();
  await (await es.connect(lender).fund(id, { value: one })).wait();
  await (await es.connect(borrower).releaseFunds(id)).wait();
  await (await es.connect(borrower).withdraw()).wait();
  await (await es.connect(borrower).repay(id, { value: one })).wait();
  await (await es.connect(lender).withdraw()).wait();
  console.log("loan", String(id), "workflow state:", (await wf.getLoan(id)).state.toString(), "(6 = Repaid)");
  id = await next();
  await (await es.connect(lender).fund(id, { value: one })).wait();
  await (await es.connect(lender).raiseDispute(id)).wait();
  await (await es.connect(arbiter).resolveDispute(id, true)).wait();
  await (await es.connect(lender).withdraw()).wait();
  console.log("loan", String(id), "workflow state:", (await wf.getLoan(id)).state.toString(), "(7 = Disputed)", "| escrow balance:", (await ethers.provider.getBalance(cfg.escrow)).toString());
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
