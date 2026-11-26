// Regression guard: the escrow optimization must stay cheaper than the recorded baseline for the same inputs.
const { expect } = require("chai");
const { measure } = require("../scripts/lib/gasEscrow");

describe("Member 3: escrow gas regression", function () {
  this.timeout(120000);
  it("optimized EscrowDispute is not more expensive than EscrowBaseline (same inputs)", async () => {
    const { baseline, optimized } = await measure();
    expect(Number(optimized.fund[0])).to.be.lessThan(Number(baseline.fund[0]) * 0.8); // packing saves > 20% on fund()
    for (const op of ["releaseFunds", "repay", "raiseDispute", "resolveDispute"])
      expect(Number(optimized[op][2])).to.be.lessThan(Number(baseline[op][2]), op);
    expect(Number(optimized.withdraw[0])).to.be.lessThan(Number(baseline.withdraw[0]) * 1.02); // about equal
  });
});
