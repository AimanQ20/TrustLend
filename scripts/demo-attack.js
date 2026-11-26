// Member 3 demo: the failing attack. Run with:  npm run demo:attack   (in-process network, no node needed)
// Shows (1) a naive vault being drained by reentrancy, (2) the same attack failing against EscrowDispute.
const hre = require("hardhat");
const { ethers } = hre;
const eth = (v) => ethers.formatEther(v) + " ETH";

async function main() {
  const [admin, pauser, verifier, arbiter, lender, , borrower, , , attackerOwner] = await ethers.getSigners();
  const ONE = ethers.parseEther("1");

  console.log("\n=== ATTACK 1: naive vault (pays BEFORE zeroing the balance) ===");
  const vault = await ethers.deployContract("VulnerableVault");
  await vault.connect(lender).deposit({ value: ONE * 3n });
  const a1 = await ethers.deployContract("ReentrancyAttacker", [await vault.getAddress()], attackerOwner);
  await a1.exec(await vault.getAddress(), vault.interface.encodeFunctionData("deposit"), { value: ONE });
  console.log("vault holds", eth(await ethers.provider.getBalance(await vault.getAddress())), "(victim 3 + attacker 1)");
  await a1.attack();
  console.log("after attack: vault =", eth(await ethers.provider.getBalance(await vault.getAddress())), "| attacker =", eth(await ethers.provider.getBalance(await a1.getAddress())), "| successful re-entries:", String(await a1.reentries()));
  console.log("RESULT: victim's 3 ETH stolen.\n");

  console.log("=== ATTACK 2: the same reentrancy against EscrowDispute ===");
  const kyc = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
  const registry = await ethers.deployContract("Registry", [admin.address]);
  await registry.assignRole(verifier.address, 4);
  await registry.assignRole(arbiter.address, 32);
  for (const [s, r, t] of [[lender, 8, "l"], [borrower, 16, "b"]]) { await registry.connect(s).register(r, kyc(t)); await registry.connect(verifier).verifyUser(s.address); }
  const workflow = await ethers.deployContract("CoreWorkflow", [await registry.getAddress()]);
  const escrow = await ethers.deployContract("EscrowDispute", [await registry.getAddress(), await workflow.getAddress()]);
  await workflow.setEscrow(await escrow.getAddress());
  const newLoan = async (amt) => { await workflow.connect(borrower).requestLoan(amt); const id = (await workflow.nextLoanId()) - 1n; await workflow.connect(verifier).approveLoan(id); return id; };

  const victimLoan = await newLoan(ONE * 3n);
  await escrow.connect(lender).fund(victimLoan, { value: ONE * 3n });
  const a2 = await ethers.deployContract("ReentrancyAttacker", [await escrow.getAddress()], attackerOwner);
  const aAddr = await a2.getAddress();
  await a2.exec(await registry.getAddress(), registry.interface.encodeFunctionData("register", [8, kyc("attacker")]));
  await registry.connect(verifier).verifyUser(aAddr);
  const loan = await newLoan(ONE);
  await a2.exec(await escrow.getAddress(), escrow.interface.encodeFunctionData("fund", [loan]), { value: ONE });
  await a2.exec(await escrow.getAddress(), escrow.interface.encodeFunctionData("raiseDispute", [loan]));
  await escrow.connect(arbiter).resolveDispute(loan, true);
  console.log("escrow holds", eth(await ethers.provider.getBalance(await escrow.getAddress())), "(victim 3 + attacker 1, attacker is owed 1)");
  await a2.attack();
  console.log("after attack: escrow =", eth(await ethers.provider.getBalance(await escrow.getAddress())), "| attacker =", eth(await ethers.provider.getBalance(aAddr)), "| successful re-entries:", String(await a2.reentries()), "| blocked re-entries:", String(await a2.blockedReentries()));
  console.log("RESULT: attack FAILED. The attacker only received its own 1 ETH; the victim's 3 ETH is intact.\n");
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
