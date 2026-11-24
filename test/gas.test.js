// Regression guard: the optimized Registry must stay cheaper than the baseline for each measured operation.
const { expect } = require("chai");
const hre = require("hardhat");
const { measure } = require("../scripts/lib/gasMeasure");

describe("Registry - gas (baseline vs optimized)", function () {
  this.timeout(60000);
  it("optimized is at least 25% cheaper on every measured state-changing operation", async function () {
    if (hre.__SOLIDITY_COVERAGE_RUNNING) return this.skip(); // coverage instrumentation inflates gas
    const { baseline: b, optimized: o } = await measure();
    for (const key of ["register", "assignExisting", "assignStaff"]) {
      for (let i = 0; i < 3; i++) {
        const saving = 1 - Number(o[key][i]) / Number(b[key][i]);
        expect(saving, `${key}[${i}] saving`).to.be.gte(0.25);
      }
    }
  });
});
