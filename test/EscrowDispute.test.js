// Member 3: EscrowDispute tests (normal, boundary, failure, access control, pause, accounting).
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployEscrowFixture, ST, WF, ONE } = require("./escrowFixture");

describe("Member 3: EscrowDispute", function () {
  let f;
  beforeEach(async () => { f = await deployEscrowFixture(); });

  describe("deployment and inheritance", () => {
    it("inherits the shared Registry and knows the workflow", async () => {
      expect(await f.escrow.registry()).to.equal(await f.registry.getAddress());
      expect(await f.escrow.workflow()).to.equal(await f.workflow.getAddress());
      expect(await f.workflow.escrow()).to.equal(await f.escrow.getAddress());
    });
    it("rejects zero addresses", async () => {
      const r = await f.registry.getAddress(), w = await f.workflow.getAddress();
      await expect(ethers.deployContract("EscrowDispute", [ethers.ZeroAddress, w])).to.be.revertedWithCustomError(f.escrow, "ZeroAddress");
      await expect(ethers.deployContract("EscrowDispute", [r, ethers.ZeroAddress])).to.be.revertedWithCustomError(f.escrow, "ZeroAddress");
    });
    it("rejects plain ETH transfers (no receive/fallback)", async () => {
      await expect(f.stranger.sendTransaction({ to: await f.escrow.getAddress(), value: 1n })).to.be.reverted;
    });
  });

  describe("happy path: fund -> release -> repay -> withdraw", () => {
    it("moves ETH correctly and drives the workflow states", async () => {
      const id = await f.approvedLoan();
      await expect(f.escrow.connect(f.lender).fund(id, { value: ONE }))
        .to.emit(f.escrow, "Funded").withArgs(id, f.lender.address, ONE);
      expect((await f.workflow.getLoan(id)).state).to.equal(WF.Funded);
      expect(await ethers.provider.getBalance(await f.escrow.getAddress())).to.equal(ONE);
      const d = await f.escrow.depositOf(id);
      expect([d.lender, d.amountWei, d.status]).to.deep.equal([f.lender.address, ONE, ST.Held]);

      await expect(f.escrow.connect(f.borrower).releaseFunds(id)).to.emit(f.escrow, "Released").withArgs(id, f.borrower.address, ONE);
      expect(await f.escrow.balances(f.borrower.address)).to.equal(ONE);
      await expect(f.escrow.connect(f.borrower).withdraw()).to.changeEtherBalances([f.borrower, f.escrow], [ONE, -ONE]);

      await expect(f.escrow.connect(f.borrower).repay(id, { value: ONE })).to.emit(f.escrow, "Repaid").withArgs(id, f.lender.address, ONE);
      expect((await f.workflow.getLoan(id)).state).to.equal(WF.Repaid);
      await expect(f.escrow.connect(f.lender).withdraw()).to.changeEtherBalances([f.lender, f.escrow], [ONE, -ONE]);
      expect(await ethers.provider.getBalance(await f.escrow.getAddress())).to.equal(0n);
    });
    it("handles several independent loans without mixing money", async () => {
      const a = await f.approvedLoan(ONE), b = await f.approvedLoan(ONE * 2n);
      await f.escrow.connect(f.lender).fund(a, { value: ONE });
      await f.escrow.connect(f.lender2).fund(b, { value: ONE * 2n });
      expect(await ethers.provider.getBalance(await f.escrow.getAddress())).to.equal(ONE * 3n);
      expect((await f.escrow.depositOf(b)).lender).to.equal(f.lender2.address);
    });
  });

  describe("fund(): validation (boundary and failure)", () => {
    it("rejects wrong amounts (too low, too high, zero)", async () => {
      const id = await f.approvedLoan();
      for (const v of [ONE - 1n, ONE + 1n, 0n])
        await expect(f.escrow.connect(f.lender).fund(id, { value: v })).to.be.revertedWithCustomError(f.escrow, "WrongAmount").withArgs(ONE, v);
    });
    it("rejects a loan that is not Approved (requested, rejected, cancelled, unknown)", async () => {
      await f.workflow.connect(f.borrower).requestLoan(ONE); // id 1 Requested
      await expect(f.escrow.connect(f.lender).fund(1, { value: ONE })).to.be.revertedWithCustomError(f.escrow, "LoanNotApproved").withArgs(1, WF.Requested);
      await f.workflow.connect(f.borrower).requestLoan(ONE); // id 2 Rejected
      await f.workflow.connect(f.verifier).rejectLoan(2);
      await expect(f.escrow.connect(f.lender).fund(2, { value: ONE })).to.be.revertedWithCustomError(f.escrow, "LoanNotApproved");
      await expect(f.escrow.connect(f.lender).fund(99, { value: ONE })).to.be.revertedWithCustomError(f.workflow, "InvalidLoan");
    });
    it("rejects double funding of the same loan", async () => {
      const id = await f.approvedLoan();
      await f.escrow.connect(f.lender).fund(id, { value: ONE });
      await expect(f.escrow.connect(f.lender2).fund(id, { value: ONE })).to.be.revertedWithCustomError(f.escrow, "AlreadyFunded").withArgs(id);
    });
    it("rejects non-lenders, unverified lenders and suspended lenders", async () => {
      const id = await f.approvedLoan();
      await expect(f.escrow.connect(f.stranger).fund(id, { value: ONE })).to.be.revertedWithCustomError(f.escrow, "Unauthorized");
      await expect(f.escrow.connect(f.borrower).fund(id, { value: ONE })).to.be.revertedWithCustomError(f.escrow, "Unauthorized");
      await f.registry.connect(f.verifier).suspendUser(f.lender.address);
      await expect(f.escrow.connect(f.lender).fund(id, { value: ONE })).to.be.revertedWithCustomError(f.escrow, "Unauthorized");
    });
    it("rejects a borrower funding their own loan even with both roles", async () => {
      const [, , , , , , , , dual] = await ethers.getSigners();
      await f.registry.connect(dual).register(24, ethers.id("dual"));
      await f.registry.connect(f.verifier).verifyUser(dual.address);
      await f.workflow.connect(dual).requestLoan(ONE);
      const id = (await f.workflow.nextLoanId()) - 1n;
      await f.workflow.connect(f.verifier).approveLoan(id);
      await expect(f.escrow.connect(dual).fund(id, { value: ONE })).to.be.revertedWithCustomError(f.escrow, "SelfFunding");
    });
    it("failed funding leaves no ETH and no state behind", async () => {
      const id = await f.approvedLoan();
      await expect(f.escrow.connect(f.lender).fund(id, { value: 1n })).to.be.reverted;
      expect(await ethers.provider.getBalance(await f.escrow.getAddress())).to.equal(0n);
      expect((await f.escrow.depositOf(id)).status).to.equal(ST.None);
      expect((await f.workflow.getLoan(id)).state).to.equal(WF.Approved);
    });
  });

  describe("releaseFunds / repay: ordering and ownership", () => {
    let id;
    beforeEach(async () => { id = await f.approvedLoan(); });
    it("cannot release or repay before funding (skipped transition)", async () => {
      await expect(f.escrow.connect(f.borrower).releaseFunds(id)).to.be.revertedWithCustomError(f.escrow, "InvalidStatus").withArgs(id, ST.None);
      await expect(f.escrow.connect(f.borrower).repay(id, { value: ONE })).to.be.revertedWithCustomError(f.escrow, "InvalidStatus");
    });
    it("cannot release twice (replay) or repay before release", async () => {
      await f.escrow.connect(f.lender).fund(id, { value: ONE });
      await expect(f.escrow.connect(f.borrower).repay(id, { value: ONE })).to.be.revertedWithCustomError(f.escrow, "InvalidStatus").withArgs(id, ST.Held);
      await f.escrow.connect(f.borrower).releaseFunds(id);
      await expect(f.escrow.connect(f.borrower).releaseFunds(id)).to.be.revertedWithCustomError(f.escrow, "InvalidStatus").withArgs(id, ST.Released);
      expect(await f.escrow.balances(f.borrower.address)).to.equal(ONE); // credited once only
    });
    it("only the loan's own borrower may release or repay", async () => {
      await f.escrow.connect(f.lender).fund(id, { value: ONE });
      await expect(f.escrow.connect(f.lender).releaseFunds(id)).to.be.revertedWithCustomError(f.escrow, "Unauthorized");
      await expect(f.escrow.connect(f.stranger).releaseFunds(id)).to.be.revertedWithCustomError(f.escrow, "Unauthorized");
      // a different, verified borrower is still not THIS loan's borrower
      const [, , , , , , , , other] = await ethers.getSigners();
      await f.registry.connect(other).register(16, ethers.id("other"));
      await f.registry.connect(f.verifier).verifyUser(other.address);
      await expect(f.escrow.connect(other).releaseFunds(id)).to.be.revertedWithCustomError(f.escrow, "NotBorrower");
      await f.escrow.connect(f.borrower).releaseFunds(id);
      await expect(f.escrow.connect(other).repay(id, { value: ONE })).to.be.revertedWithCustomError(f.escrow, "NotBorrower");
    });
    it("repay needs the exact amount", async () => {
      await f.escrow.connect(f.lender).fund(id, { value: ONE });
      await f.escrow.connect(f.borrower).releaseFunds(id);
      for (const v of [0n, ONE - 1n, ONE + 1n])
        await expect(f.escrow.connect(f.borrower).repay(id, { value: v })).to.be.revertedWithCustomError(f.escrow, "WrongAmount");
    });
    it("cannot repay twice", async () => {
      await f.escrow.connect(f.lender).fund(id, { value: ONE });
      await f.escrow.connect(f.borrower).releaseFunds(id);
      await f.escrow.connect(f.borrower).repay(id, { value: ONE });
      await expect(f.escrow.connect(f.borrower).repay(id, { value: ONE })).to.be.revertedWithCustomError(f.escrow, "InvalidStatus").withArgs(id, ST.Repaid);
    });
  });

  describe("disputes", () => {
    let id;
    beforeEach(async () => { id = await f.approvedLoan(); await f.escrow.connect(f.lender).fund(id, { value: ONE }); });
    it("lender raises, arbiter refunds the lender", async () => {
      await expect(f.escrow.connect(f.lender).raiseDispute(id)).to.emit(f.escrow, "DisputeRaised").withArgs(id, f.lender.address);
      expect((await f.workflow.getLoan(id)).state).to.equal(WF.Disputed);
      await expect(f.escrow.connect(f.arbiter).resolveDispute(id, true))
        .to.emit(f.escrow, "DisputeResolved").withArgs(id, f.arbiter.address, f.lender.address, ONE);
      await expect(f.escrow.connect(f.lender).withdraw()).to.changeEtherBalance(f.lender, ONE);
      expect((await f.escrow.depositOf(id)).status).to.equal(ST.Resolved);
    });
    it("borrower raises, arbiter releases to the borrower", async () => {
      await f.escrow.connect(f.borrower).raiseDispute(id);
      await f.escrow.connect(f.arbiter).resolveDispute(id, false);
      await expect(f.escrow.connect(f.borrower).withdraw()).to.changeEtherBalance(f.borrower, ONE);
    });
    it("outsiders and other lenders cannot raise a dispute", async () => {
      await expect(f.escrow.connect(f.stranger).raiseDispute(id)).to.be.revertedWithCustomError(f.escrow, "NotParty");
      await expect(f.escrow.connect(f.lender2).raiseDispute(id)).to.be.revertedWithCustomError(f.escrow, "NotParty");
    });
    it("cannot dispute twice, after release, or an unfunded loan", async () => {
      await f.escrow.connect(f.lender).raiseDispute(id);
      await expect(f.escrow.connect(f.lender).raiseDispute(id)).to.be.revertedWithCustomError(f.escrow, "InvalidStatus");
      const id2 = await f.approvedLoan();
      await expect(f.escrow.connect(f.borrower).raiseDispute(id2)).to.be.revertedWithCustomError(f.escrow, "InvalidStatus").withArgs(id2, ST.None);
      await f.escrow.connect(f.lender2).fund(id2, { value: ONE });
      await f.escrow.connect(f.borrower).releaseFunds(id2);
      await expect(f.escrow.connect(f.lender2).raiseDispute(id2)).to.be.revertedWithCustomError(f.escrow, "InvalidStatus").withArgs(id2, ST.Released);
    });
    it("only an active ARBITER may resolve, and only once, and not before a dispute", async () => {
      await expect(f.escrow.connect(f.arbiter).resolveDispute(id, true)).to.be.revertedWithCustomError(f.escrow, "InvalidStatus").withArgs(id, ST.Held);
      await f.escrow.connect(f.lender).raiseDispute(id);
      for (const s of [f.lender, f.borrower, f.verifier, f.stranger, f.pauser])
        await expect(f.escrow.connect(s).resolveDispute(id, true)).to.be.revertedWithCustomError(f.escrow, "Unauthorized");
      await f.escrow.connect(f.arbiter).resolveDispute(id, true);
      await expect(f.escrow.connect(f.arbiter).resolveDispute(id, false)).to.be.revertedWithCustomError(f.escrow, "InvalidStatus").withArgs(id, ST.Resolved);
      expect(await f.escrow.balances(f.lender.address)).to.equal(ONE);
      expect(await f.escrow.balances(f.borrower.address)).to.equal(0n);
    });
    it("a suspended arbiter cannot resolve (revocation is immediate)", async () => {
      await f.escrow.connect(f.lender).raiseDispute(id);
      await f.registry.suspendUser(f.arbiter.address);
      await expect(f.escrow.connect(f.arbiter).resolveDispute(id, true)).to.be.revertedWithCustomError(f.escrow, "Unauthorized");
    });
    it("an arbiter who is also a party is refused (conflict of interest)", async () => {
      // arbiter registers as a lender too and funds another loan
      await f.registry.connect(f.admin).assignRole(f.lender2.address, 32); // lender2 becomes ARBITER as well
      const id2 = await f.approvedLoan();
      await f.escrow.connect(f.lender2).fund(id2, { value: ONE });
      await f.escrow.connect(f.borrower).raiseDispute(id2);
      await expect(f.escrow.connect(f.lender2).resolveDispute(id2, true)).to.be.revertedWithCustomError(f.escrow, "ConflictOfInterest");
    });
    it("a disputed deposit can no longer be released or repaid", async () => {
      await f.escrow.connect(f.lender).raiseDispute(id);
      await expect(f.escrow.connect(f.borrower).releaseFunds(id)).to.be.revertedWithCustomError(f.escrow, "InvalidStatus").withArgs(id, ST.Disputed);
    });
  });

  describe("withdraw()", () => {
    it("reverts with nothing to withdraw, and cannot be drained twice", async () => {
      await expect(f.escrow.connect(f.stranger).withdraw()).to.be.revertedWithCustomError(f.escrow, "NothingToWithdraw");
      const id = await f.approvedLoan();
      await f.escrow.connect(f.lender).fund(id, { value: ONE });
      await f.escrow.connect(f.borrower).releaseFunds(id);
      await f.escrow.connect(f.borrower).withdraw();
      await expect(f.escrow.connect(f.borrower).withdraw()).to.be.revertedWithCustomError(f.escrow, "NothingToWithdraw");
    });
    it("a suspended user can still withdraw money that is already theirs", async () => {
      const id = await f.approvedLoan();
      await f.escrow.connect(f.lender).fund(id, { value: ONE });
      await f.escrow.connect(f.borrower).releaseFunds(id);
      await f.registry.suspendUser(f.borrower.address);
      await expect(f.escrow.connect(f.borrower).withdraw()).to.changeEtherBalance(f.borrower, ONE);
    });
    it("forced ETH (selfdestruct-style) cannot break accounting", async () => {
      // Hardhat can set balance directly: same effect as a forced transfer
      await ethers.provider.send("hardhat_setBalance", [await f.escrow.getAddress(), "0x1000"]);
      const id = await f.approvedLoan();
      await f.escrow.connect(f.lender).fund(id, { value: ONE });
      await f.escrow.connect(f.borrower).releaseFunds(id);
      await expect(f.escrow.connect(f.borrower).withdraw()).to.changeEtherBalance(f.borrower, ONE);
    });
  });

  describe("pause / emergency (inherited from BaseAccessControl)", () => {
    it("registry pause freezes every money function", async () => {
      const id = await f.approvedLoan();
      const id2 = await f.approvedLoan();
      await f.escrow.connect(f.lender).fund(id2, { value: ONE });
      await f.registry.connect(f.pauser).pause();
      await expect(f.escrow.connect(f.lender).fund(id, { value: ONE })).to.be.revertedWithCustomError(f.escrow, "EnforcedPause");
      await expect(f.escrow.connect(f.borrower).releaseFunds(id2)).to.be.revertedWithCustomError(f.escrow, "EnforcedPause");
      await expect(f.escrow.connect(f.lender).raiseDispute(id2)).to.be.revertedWithCustomError(f.escrow, "EnforcedPause");
      await expect(f.escrow.connect(f.borrower).withdraw()).to.be.revertedWithCustomError(f.escrow, "EnforcedPause");
      await f.registry.unpause();
      await f.escrow.connect(f.borrower).releaseFunds(id2); // works again
    });
    it("the escrow can be paused on its own by a pauser, only admin resumes", async () => {
      await f.escrow.connect(f.pauser).pause();
      expect(await f.escrow.paused()).to.equal(true);
      expect(await f.registry.paused()).to.equal(false);
      await expect(f.escrow.connect(f.pauser).unpause()).to.be.revertedWithCustomError(f.escrow, "Unauthorized");
      await f.escrow.unpause();
      expect(await f.escrow.paused()).to.equal(false);
    });
    it("a stranger cannot pause the escrow", async () => {
      await expect(f.escrow.connect(f.stranger).pause()).to.be.revertedWithCustomError(f.escrow, "Unauthorized");
    });
  });

  describe("accounting invariant", () => {
    it("escrow ETH always equals held deposits + unclaimed credits", async () => {
      const ids = [];
      for (let i = 0; i < 4; i++) ids.push(await f.approvedLoan(ONE * BigInt(i + 1)));
      const total = async () => ethers.provider.getBalance(await f.escrow.getAddress());
      const owed = async () => (await f.escrow.balances(f.borrower.address)) + (await f.escrow.balances(f.lender.address));
      let held = 0n;
      for (let i = 0; i < 4; i++) { await f.escrow.connect(f.lender).fund(ids[i], { value: ONE * BigInt(i + 1) }); held += ONE * BigInt(i + 1); }
      expect(await total()).to.equal(held);
      await f.escrow.connect(f.borrower).releaseFunds(ids[0]); held -= ONE; // moves from "held" to "credit"
      expect(await total()).to.equal(held + (await owed()));
      await f.escrow.connect(f.lender).raiseDispute(ids[1]);
      await f.escrow.connect(f.arbiter).resolveDispute(ids[1], true); held -= ONE * 2n;
      expect(await total()).to.equal(held + (await owed()));
      await f.escrow.connect(f.borrower).withdraw(); await f.escrow.connect(f.lender).withdraw();
      expect(await total()).to.equal(held); // only ids[2] and ids[3] remain held
    });
  });
});
