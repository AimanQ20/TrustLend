// Gas measurement for the escrow: BASELINE (EscrowBaseline, recorded before optimizing) vs OPTIMIZED (EscrowDispute).
// Methodology: fresh Registry + CoreWorkflow + escrow per variant, same compiler/optimizer settings, same signers,
// same call order and same inputs (1 ETH loans). Gas comes from receipt.gasUsed (fee independent).
const { ethers } = require("hardhat");
const ONE = ethers.parseEther("1");
const kyc = (s) => ethers.keccak256(ethers.toUtf8Bytes(`gas-escrow-${s}`));

async function runOne(escrowName) {
  const [admin, verifier, arbiter, lender, borrower] = await ethers.getSigners();
  const registry = await ethers.deployContract("Registry", [admin.address]);
  await registry.assignRole(verifier.address, 4);
  await registry.assignRole(arbiter.address, 32);
  await registry.connect(lender).register(8, kyc("lender"));
  await registry.connect(borrower).register(16, kyc("borrower"));
  await registry.connect(verifier).verifyUser(lender.address);
  await registry.connect(verifier).verifyUser(borrower.address);
  const workflow = await ethers.deployContract("CoreWorkflow", [await registry.getAddress()]);
  const escrow = await ethers.deployContract(escrowName, [await registry.getAddress(), await workflow.getAddress()]);
  await workflow.setEscrow(await escrow.getAddress());

  const out = { fund: [], releaseFunds: [], repay: [], raiseDispute: [], resolveDispute: [], withdraw: [] };
  const gas = async (p) => (await (await p).wait()).gasUsed;
  const approved = async () => {
    await workflow.connect(borrower).requestLoan(ONE);
    const id = (await workflow.nextLoanId()) - 1n;
    await workflow.connect(verifier).approveLoan(id);
    return id;
  };
  // Path A (3 loans): fund -> release -> repay
  for (let i = 0; i < 3; i++) {
    const id = await approved();
    out.fund.push(await gas(escrow.connect(lender).fund(id, { value: ONE })));
    out.releaseFunds.push(await gas(escrow.connect(borrower).releaseFunds(id)));
    out.repay.push(await gas(escrow.connect(borrower).repay(id, { value: ONE })));
  }
  // Path B (3 loans): fund -> dispute -> resolve (refund the lender)
  for (let i = 0; i < 3; i++) {
    const id = await approved();
    await (await escrow.connect(lender).fund(id, { value: ONE })).wait();
    out.raiseDispute.push(await gas(escrow.connect(lender).raiseDispute(id)));
    out.resolveDispute.push(await gas(escrow.connect(arbiter).resolveDispute(id, true)));
  }
  out.withdraw.push(await gas(escrow.connect(borrower).withdraw()));
  out.withdraw.push(await gas(escrow.connect(lender).withdraw()));
  return out;
}

async function measure() {
  const baseline = await runOne("EscrowBaseline");
  const optimized = await runOne("EscrowDispute");
  return { baseline, optimized };
}
module.exports = { measure };
