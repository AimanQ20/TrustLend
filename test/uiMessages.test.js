// The frontend must show a readable message for every contract error. This test triggers REAL reverts and
// checks the text produced by frontend/ui-messages.js (same function the pages use).
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployEscrowFixture, ONE } = require("./escrowFixture");
const { explain, MESSAGES } = require("../frontend/ui-messages.js");

describe("Frontend error messages (ui-messages.js)", function () {
  let f, ifaces;
  const msg = async (p) => { try { await p; } catch (e) { return explain(e, ifaces); } throw new Error("expected a revert"); };
  beforeEach(async () => {
    f = await deployEscrowFixture();
    ifaces = [f.escrow.interface, f.workflow.interface, f.registry.interface];
  });

  it("wrong role: a borrower trying to fund", async () => {
    const id = await f.approvedLoan();
    expect(await msg(f.escrow.connect(f.borrower).fund.staticCall(id, { value: ONE }))).to.equal("Not allowed. This wallet is not an active lender.");
  });
  it("loan that does not exist", async () => {
    expect(await msg(f.workflow.getLoan(99))).to.equal("Loan not found.");
    expect(await msg(f.escrow.connect(f.lender).fund.staticCall(99, { value: ONE }))).to.equal("Loan not found.");
  });
  it("wrong step (release before funding, or on a disputed loan)", async () => {
    const id = await f.approvedLoan();
    expect(await msg(f.escrow.connect(f.borrower).releaseFunds.staticCall(id))).to.equal("Action not allowed at this step.");
    await f.escrow.connect(f.lender).fund(id, { value: ONE });
    await f.escrow.connect(f.lender).raiseDispute(id);
    expect(await msg(f.escrow.connect(f.borrower).releaseFunds.staticCall(id))).to.equal("Action not allowed at this step.");
  });
  it("wrong amount, double funding, unapproved loan", async () => {
    const id = await f.approvedLoan();
    expect(await msg(f.escrow.connect(f.lender).fund.staticCall(id, { value: 5n }))).to.equal("Incorrect amount.");
    await f.escrow.connect(f.lender).fund(id, { value: ONE });
    expect(await msg(f.escrow.connect(f.lender2).fund.staticCall(id, { value: ONE }))).to.equal("Loan is not available for funding.");
    await f.workflow.connect(f.borrower).requestLoan(ONE);
    const id2 = (await f.workflow.nextLoanId()) - 1n;
    expect(await msg(f.escrow.connect(f.lender).fund.staticCall(id2, { value: ONE }))).to.equal("Loan is not available for funding.");
  });
  it("withdraw with nothing, dispute by outsider, arbiter rules", async () => {
    expect(await msg(f.escrow.connect(f.borrower).withdraw.staticCall())).to.equal("Nothing to withdraw.");
    const id = await f.approvedLoan();
    await f.escrow.connect(f.lender).fund(id, { value: ONE });
    expect(await msg(f.escrow.connect(f.stranger).raiseDispute.staticCall(id))).to.equal("Not allowed.");
    expect(await msg(f.escrow.connect(f.borrower).resolveDispute.staticCall(id, true))).to.equal("Not allowed. This wallet is not an active arbiter.");
  });
  it("paused system", async () => {
    const id = await f.approvedLoan();
    await f.registry.pause();
    expect(await msg(f.escrow.connect(f.lender).fund.staticCall(id, { value: ONE }))).to.equal("Action unavailable. The system is paused.");
  });
  it("workflow errors: zero amount, wrong role, repeated approval", async () => {
    expect(await msg(f.workflow.connect(f.borrower).requestLoan.staticCall(0))).to.equal("Invalid amount.");
    expect(await msg(f.workflow.connect(f.lender).requestLoan.staticCall(1))).to.equal("Not allowed. This wallet is not an active borrower.");
    const id = await f.approvedLoan();
    expect(await msg(f.workflow.connect(f.verifier).approveLoan.staticCall(id))).to.equal("Action not allowed for this loan.");
  });
  it("messages never reveal internal details (amounts, states, addresses, contract names)", async () => {
    const id = await f.approvedLoan();
    const all = [
      await msg(f.escrow.connect(f.lender).fund.staticCall(id, { value: 5n })),
      await msg(f.escrow.connect(f.borrower).releaseFunds.staticCall(id)),
      await msg(f.workflow.connect(f.verifier).approveLoan.staticCall(id)),
    ].join(" ");
    expect(all).to.not.match(/0x[0-9a-fA-F]{6}|ETH|Approved|Requested|None|Held|escrow|workflow|status|state/i);
  });
  it("wallet and network problems", () => {
    expect(explain({ code: "ACTION_REJECTED" }, [])).to.equal("Transaction cancelled.");
    expect(explain({ code: "INSUFFICIENT_FUNDS" }, [])).to.equal("Insufficient funds.");
    expect(explain(new Error("Failed to fetch"), [])).to.equal("Cannot connect to the network.");
    expect(explain({ code: "UNKNOWN_ERROR", shortMessage: "some internal rpc text 0xabc" }, [])).to.equal("Action failed. Please try again.");
  });
  it("every custom error in the three contracts has a friendly message", () => {
    const names = new Set();
    for (const i of [ethers.Interface.from(require("../artifacts/contracts/EscrowDispute.sol/EscrowDispute.json").abi),
                     ethers.Interface.from(require("../artifacts/contracts/CoreWorkflow.sol/CoreWorkflow.json").abi)])
      i.forEachError((e) => names.add(e.name));
    const missing = [...names].filter((n) => !MESSAGES[n]);
    expect(missing, `no friendly message for: ${missing.join(", ")}`).to.deep.equal([]);
  });
});
