const { expect } = require("chai");
const { ethers } = require("hardhat");
describe("Member 2: CoreWorkflow", function () {
  let admin, verifier, borrower, lender, stranger, registry, workflow, escrow;
  const kyc = ethers.keccak256(ethers.toUtf8Bytes("test-kyc"));
  beforeEach(async function () {
    [admin, verifier, borrower, lender, stranger] = await ethers.getSigners();
    registry = await ethers.deployContract("Registry", [admin.address]); await registry.waitForDeployment();
    await registry.assignRole(verifier.address, 4);
    await registry.connect(borrower).register(16, kyc);
    await registry.connect(lender).register(8, kyc);
    await registry.connect(verifier).verifyUser(borrower.address);
    await registry.connect(verifier).verifyUser(lender.address);
    workflow = await ethers.deployContract("CoreWorkflow", [await registry.getAddress()]); await workflow.waitForDeployment();
    escrow = await ethers.deployContract("MockWorkflowEscrow", [await workflow.getAddress()]); await escrow.waitForDeployment();
    await workflow.setEscrow(await escrow.getAddress());
  });
  async function request() { await workflow.connect(borrower).requestLoan(ethers.parseEther("1")); return 1; }
  it("borrower requests, verifier approves, escrow funds and repays", async function () {
    const id = await request();
    expect((await workflow.getLoan(id)).state).to.equal(1n);
    await expect(workflow.connect(verifier).approveLoan(id)).to.emit(workflow, "LoanApproved");
    await escrow.funded(id, lender.address);
    expect((await workflow.getLoan(id)).state).to.equal(5n);
    await escrow.repaid(id);
    expect((await workflow.getLoan(id)).state).to.equal(6n);
  });
  it("rejects zero value and unverified / wrong-role users", async function () {
    await expect(workflow.connect(borrower).requestLoan(0)).to.be.revertedWithCustomError(workflow, "InvalidAmount");
    await expect(workflow.connect(stranger).requestLoan(1)).to.be.reverted;
    await request();
    await expect(workflow.connect(borrower).approveLoan(1)).to.be.reverted;
  });
  it("prevents replayed approval, skipped funding and direct financial changes", async function () {
    await request();
    await expect(escrow.funded(1, lender.address)).to.be.revertedWithCustomError(workflow, "InvalidState");
    await workflow.connect(verifier).approveLoan(1);
    await expect(workflow.connect(verifier).approveLoan(1)).to.be.revertedWithCustomError(workflow, "InvalidState");
    await expect(workflow.connect(stranger).markFunded(1, lender.address)).to.be.revertedWithCustomError(workflow, "EscrowOnly");
    await expect(escrow.repaid(1)).to.be.revertedWithCustomError(workflow, "InvalidState");
  });
  it("allows rejection or cancellation, but not later funding", async function () {
    await request(); await workflow.connect(verifier).rejectLoan(1);
    await expect(escrow.funded(1, lender.address)).to.be.revertedWithCustomError(workflow, "InvalidState");
    await workflow.connect(borrower).requestLoan(100);
    await workflow.connect(borrower).cancelLoan(2);
    expect((await workflow.getLoan(2)).state).to.equal(4n);
  });
  it("blocks financial and request actions when registry paused", async function () {
    await request(); await workflow.connect(verifier).approveLoan(1);
    await registry.pause();
    await expect(workflow.connect(borrower).requestLoan(1)).to.be.revertedWithCustomError(workflow, "EnforcedPause");
    await expect(escrow.funded(1, lender.address)).to.be.revertedWithCustomError(workflow, "EnforcedPause");
  });
  it("escrow can only be configured once and only by admin", async function () {
    await expect(workflow.setEscrow(await escrow.getAddress())).to.be.revertedWithCustomError(workflow, "EscrowAlreadySet");
    await expect(workflow.connect(stranger).setEscrow(await escrow.getAddress())).to.be.reverted;
  });
  it("supports a dispute state after funding", async function () {
    await request(); await workflow.connect(verifier).approveLoan(1); await escrow.funded(1, lender.address);
    await escrow.disputed(1); expect((await workflow.getLoan(1)).state).to.equal(7n);
  });
});
