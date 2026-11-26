// Proves the inheritance base works for downstream contracts (what Members 2 and 3 will do).
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { ROLE, kyc, deployWithUsersFixture } = require("./helpers");

async function fixture() {
  const f = await deployWithUsersFixture();
  const mock = await (await ethers.getContractFactory("MockGuarded")).deploy(await f.registry.getAddress());
  return { ...f, mock };
}

describe("RegistryAccessControl (downstream inheritance)", () => {
  it("rejects a zero-address registry", async () => {
    const F = await ethers.getContractFactory("MockGuarded");
    await expect(F.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(F, "ZeroAddress");
  });
  it("stores the registry immutably", async () => {
    const { mock, registry } = await loadFixture(fixture);
    expect(await mock.registry()).to.equal(await registry.getAddress());
  });
  it("Active borrower/lender/staff can call their functions", async () => {
    const f = await loadFixture(fixture);
    await f.mock.connect(f.borrower).borrowerAction();
    await f.mock.connect(f.lender).lenderAction();
    await f.mock.connect(f.verifier).staffAction();
    await f.mock.connect(f.arbiter).staffAction();
    expect(await f.mock.counter()).to.equal(4);
  });
  it("wrong role, unknown wallet, and admin-without-role are rejected", async () => {
    const f = await loadFixture(fixture);
    await expect(f.mock.connect(f.lender).borrowerAction()).to.be.revertedWithCustomError(f.mock, "Unauthorized").withArgs(f.lender.address, ROLE.BORROWER);
    await expect(f.mock.connect(f.outsider).lenderAction()).to.be.revertedWithCustomError(f.mock, "Unauthorized");
    await expect(f.mock.connect(f.admin).staffAction()).to.be.revertedWithCustomError(f.mock, "Unauthorized");
  });
  it("Pending (unverified) and Suspended accounts are rejected, even though they hold the role bit", async () => {
    const f = await loadFixture(fixture);
    await f.registry.connect(f.outsider).register(ROLE.BORROWER, kyc("o"));
    await expect(f.mock.connect(f.outsider).borrowerAction()).to.be.revertedWithCustomError(f.mock, "Unauthorized");
    await f.registry.connect(f.verifier).suspendUser(f.borrower.address);
    await expect(f.mock.connect(f.borrower).borrowerAction()).to.be.revertedWithCustomError(f.mock, "Unauthorized");
    await f.registry.connect(f.admin).reinstateUser(f.borrower.address);
    await f.mock.connect(f.borrower).borrowerAction();
  });
  it("role changes in the registry take effect in the downstream contract at once", async () => {
    const f = await loadFixture(fixture);
    await f.registry.connect(f.admin).revokeRole(f.lender.address, ROLE.LENDER);
    await expect(f.mock.connect(f.lender).lenderAction()).to.be.revertedWithCustomError(f.mock, "Unauthorized");
    await f.registry.connect(f.admin).assignRole(f.lender.address, ROLE.LENDER);
    await f.mock.connect(f.lender).lenderAction();
  });
  it("registry pause = system-wide stop; unpausing the registry resumes", async () => {
    const f = await loadFixture(fixture);
    await f.registry.connect(f.pauser).pause();
    expect(await f.mock.paused()).to.equal(true);
    await expect(f.mock.connect(f.borrower).borrowerAction()).to.be.revertedWithCustomError(f.mock, "EnforcedPause");
    // local flag is not set, so local unpause is meaningless
    await expect(f.mock.connect(f.admin).unpause()).to.be.revertedWithCustomError(f.mock, "ExpectedPause");
    await f.registry.connect(f.admin).unpause();
    await f.mock.connect(f.borrower).borrowerAction();
  });
  it("local pause stops only the downstream contract; role rules come from the registry", async () => {
    const f = await loadFixture(fixture);
    await expect(f.mock.connect(f.pauser).pause()).to.emit(f.mock, "Paused").withArgs(f.pauser.address);
    expect(await f.registry.paused()).to.equal(false);
    await expect(f.mock.connect(f.lender).lenderAction()).to.be.revertedWithCustomError(f.mock, "EnforcedPause");
    await expect(f.mock.connect(f.pauser).unpause()).to.be.revertedWithCustomError(f.mock, "Unauthorized");
    await expect(f.mock.connect(f.outsider).pause()).to.be.revertedWithCustomError(f.mock, "Unauthorized");
    await f.mock.connect(f.admin).unpause();
    await f.mock.connect(f.lender).lenderAction();
  });
  it("after an admin handover the NEW admin controls the downstream contract", async () => {
    const f = await loadFixture(fixture);
    await f.registry.connect(f.admin).transferAdmin(f.other.address);
    await f.registry.connect(f.other).acceptAdmin();
    await f.mock.connect(f.pauser).pause();
    await expect(f.mock.connect(f.admin).unpause()).to.be.revertedWithCustomError(f.mock, "Unauthorized");
    await f.mock.connect(f.other).unpause();
  });
});
