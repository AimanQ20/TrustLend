// Shared fixture for the Member 3 escrow tests: real Registry + real CoreWorkflow + real EscrowDispute.
const { ethers } = require("hardhat");
const kyc = (s) => ethers.keccak256(ethers.toUtf8Bytes(`kyc-record:${s}`));
const ST = { None: 0n, Held: 1n, Released: 2n, Repaid: 3n, Disputed: 4n, Resolved: 5n };
const WF = { Requested: 1n, Approved: 2n, Funded: 5n, Repaid: 6n, Disputed: 7n };
const ONE = ethers.parseEther("1");

async function deployEscrowFixture(escrowName = "EscrowDispute") {
  const [admin, pauser, verifier, arbiter, lender, lender2, borrower, stranger] = await ethers.getSigners();
  const registry = await ethers.deployContract("Registry", [admin.address]);
  await registry.assignRole(pauser.address, 2);
  await registry.assignRole(verifier.address, 4);
  await registry.assignRole(arbiter.address, 32);
  for (const [s, role, tag] of [[lender, 8, "l1"], [lender2, 8, "l2"], [borrower, 16, "b"]]) {
    await registry.connect(s).register(role, kyc(tag));
    await registry.connect(verifier).verifyUser(s.address);
  }
  const workflow = await ethers.deployContract("CoreWorkflow", [await registry.getAddress()]);
  const escrow = await ethers.deployContract(escrowName, [await registry.getAddress(), await workflow.getAddress()]);
  await workflow.setEscrow(await escrow.getAddress());
  /** borrower requests, verifier approves; returns the loan id */
  async function approvedLoan(amount = ONE) {
    await workflow.connect(borrower).requestLoan(amount);
    const id = (await workflow.nextLoanId()) - 1n;
    await workflow.connect(verifier).approveLoan(id);
    return id;
  }
  return { admin, pauser, verifier, arbiter, lender, lender2, borrower, stranger, registry, workflow, escrow, approvedLoan };
}
module.exports = { deployEscrowFixture, kyc, ST, WF, ONE };
