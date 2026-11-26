// Pause / emergency controls
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { ROLE, STATUS, kyc, deployWithUsersFixture } = require("./helpers");

describe("Registry - pause / emergency controls", () => {
  it("PAUSER and ADMIN can pause; event emitted; state visible", async () => {
    const f = await loadFixture(deployWithUsersFixture);
    await expect(f.registry.connect(f.pauser).pause()).to.emit(f.registry, "Paused").withArgs(f.pauser.address);
    expect(await f.registry.paused()).to.equal(true);
    await f.registry.connect(f.admin).unpause();
    await expect(f.registry.connect(f.admin).pause()).to.emit(f.registry, "Paused").withArgs(f.admin.address);
  });
  it("pausing twice / unpausing when running reverts", async () => {
    const f = await loadFixture(deployWithUsersFixture);
    await expect(f.registry.connect(f.admin).unpause()).to.be.revertedWithCustomError(f.registry, "ExpectedPause");
    await f.registry.connect(f.pauser).pause();
    await expect(f.registry.connect(f.pauser).pause()).to.be.revertedWithCustomError(f.registry, "EnforcedPause");
  });
  it("a PAUSER cannot unpause (fast stop, deliberate restart)", async () => {
    const f = await loadFixture(deployWithUsersFixture);
    await f.registry.connect(f.pauser).pause();
    await expect(f.registry.connect(f.pauser).unpause()).to.be.revertedWithCustomError(f.registry, "Unauthorized").withArgs(f.pauser.address, ROLE.ADMIN);
    await expect(f.registry.connect(f.admin).unpause()).to.emit(f.registry, "Unpaused").withArgs(f.admin.address);
    expect(await f.registry.paused()).to.equal(false);
  });

  describe("while paused", () => {
    async function paused() {
      const f = await deployWithUsersFixture();
      await f.registry.connect(f.outsider).register(ROLE.LENDER, kyc("o")); // pending user to act on
      await f.registry.connect(f.pauser).pause();
      return f;
    }
    it("BLOCKS register, verifyUser, assignRole, reinstateUser", async () => {
      const f = await loadFixture(paused);
      const E = "EnforcedPause";
      await expect(f.registry.connect(f.other).register(ROLE.LENDER, kyc("n"))).to.be.revertedWithCustomError(f.registry, E);
      await expect(f.registry.connect(f.verifier).verifyUser(f.outsider.address)).to.be.revertedWithCustomError(f.registry, E);
      await expect(f.registry.connect(f.admin).assignRole(f.lender.address, ROLE.BORROWER)).to.be.revertedWithCustomError(f.registry, E);
      await f.registry.connect(f.admin).suspendUser(f.lender.address);
      await expect(f.registry.connect(f.admin).reinstateUser(f.lender.address)).to.be.revertedWithCustomError(f.registry, E);
    });
    it("STILL ALLOWS emergency actions: suspend, revoke, renounce, admin handover, unpause", async () => {
      const f = await loadFixture(paused);
      await f.registry.connect(f.verifier).suspendUser(f.lender.address);
      expect(await f.registry.statusOf(f.lender.address)).to.equal(STATUS.Suspended);
      await f.registry.connect(f.admin).revokeRole(f.arbiter.address, ROLE.ARBITER);
      await f.registry.connect(f.borrower).renounceRole(ROLE.BORROWER);
      await f.registry.connect(f.admin).transferAdmin(f.other.address);
      await f.registry.connect(f.other).acceptAdmin();
      expect(await f.registry.admin()).to.equal(f.other.address);
      await f.registry.connect(f.other).unpause();
      expect(await f.registry.paused()).to.equal(false);
    });
    it("works again after unpause", async () => {
      const f = await loadFixture(paused);
      await f.registry.connect(f.admin).unpause();
      await f.registry.connect(f.verifier).verifyUser(f.outsider.address);
      expect(await f.registry.isActive(f.outsider.address)).to.equal(true);
    });
  });
});
