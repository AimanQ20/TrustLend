// Two-step admin handover
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { ROLE, STATUS, kyc, deployWithUsersFixture } = require("./helpers");

describe("Registry - two-step admin handover", () => {
  it("transfer -> accept moves ADMIN, old admin becomes an ordinary Active user", async () => {
    const f = await loadFixture(deployWithUsersFixture);
    await expect(f.registry.connect(f.admin).transferAdmin(f.other.address)).to.emit(f.registry, "AdminTransferStarted").withArgs(f.admin.address, f.other.address);
    expect(await f.registry.admin()).to.equal(f.admin.address); // nothing changed yet
    await expect(f.registry.connect(f.other).acceptAdmin())
      .to.emit(f.registry, "AdminTransferred").withArgs(f.admin.address, f.other.address)
      .and.to.emit(f.registry, "RoleRevoked").withArgs(ROLE.ADMIN, f.admin.address, f.other.address)
      .and.to.emit(f.registry, "RoleGranted").withArgs(ROLE.ADMIN, f.other.address, f.other.address);
    expect(await f.registry.admin()).to.equal(f.other.address);
    expect(await f.registry.pendingAdmin()).to.equal(ethers.ZeroAddress);
    expect(await f.registry.rolesOf(f.admin.address)).to.equal(0);
    expect(await f.registry.statusOf(f.other.address)).to.equal(STATUS.Active);
    // old admin lost all admin powers
    await expect(f.registry.connect(f.admin).assignRole(f.lender.address, ROLE.BORROWER)).to.be.revertedWithCustomError(f.registry, "Unauthorized");
    await expect(f.registry.connect(f.admin).unpause()).to.be.revertedWithCustomError(f.registry, "Unauthorized");
    // new admin has them
    await f.registry.connect(f.other).assignRole(f.lender.address, ROLE.BORROWER);
  });
  it("a typo'd address cannot steal or brick the admin role: nothing happens until accept", async () => {
    const f = await loadFixture(deployWithUsersFixture);
    await f.registry.connect(f.admin).transferAdmin("0x000000000000000000000000000000000000dEaD");
    await f.registry.connect(f.admin).assignRole(f.lender.address, ROLE.BORROWER); // admin still works
    await f.registry.connect(f.admin).cancelAdminTransfer();
    expect(await f.registry.pendingAdmin()).to.equal(ethers.ZeroAddress);
  });
  it("cancel emits event; cancel/accept with nothing pending reverts", async () => {
    const f = await loadFixture(deployWithUsersFixture);
    await expect(f.registry.connect(f.admin).cancelAdminTransfer()).to.be.revertedWithCustomError(f.registry, "NoPendingAdmin");
    await expect(f.registry.connect(f.other).acceptAdmin()).to.be.revertedWithCustomError(f.registry, "NoPendingAdmin");
    await f.registry.connect(f.admin).transferAdmin(f.other.address);
    await expect(f.registry.connect(f.admin).cancelAdminTransfer()).to.emit(f.registry, "AdminTransferCancelled").withArgs(f.admin.address, f.other.address);
    await expect(f.registry.connect(f.other).acceptAdmin()).to.be.revertedWithCustomError(f.registry, "NoPendingAdmin");
  });
  it("rejects zero address, self, and suspended targets", async () => {
    const f = await loadFixture(deployWithUsersFixture);
    await expect(f.registry.connect(f.admin).transferAdmin(ethers.ZeroAddress)).to.be.revertedWithCustomError(f.registry, "ZeroAddress");
    await expect(f.registry.connect(f.admin).transferAdmin(f.admin.address)).to.be.revertedWithCustomError(f.registry, "SelfAction");
    await f.registry.connect(f.verifier).suspendUser(f.lender.address);
    await expect(f.registry.connect(f.admin).transferAdmin(f.lender.address)).to.be.revertedWithCustomError(f.registry, "InvalidStatus").withArgs(f.lender.address, STATUS.Suspended);
  });
  it("a pending target suspended before accepting cannot accept", async () => {
    const f = await loadFixture(deployWithUsersFixture);
    await f.registry.connect(f.admin).transferAdmin(f.lender.address);
    await f.registry.connect(f.verifier).suspendUser(f.lender.address);
    await expect(f.registry.connect(f.lender).acceptAdmin()).to.be.revertedWithCustomError(f.registry, "InvalidStatus").withArgs(f.lender.address, STATUS.Suspended);
  });
  it("an existing Pending user who accepts becomes Active admin; Active user keeps other roles", async () => {
    const f = await loadFixture(deployWithUsersFixture);
    await f.registry.connect(f.outsider).register(ROLE.BORROWER, kyc("o"));
    await f.registry.connect(f.admin).transferAdmin(f.outsider.address);
    await f.registry.connect(f.outsider).acceptAdmin();
    const p = await f.registry.getProfile(f.outsider.address);
    expect(p.status).to.equal(STATUS.Active);
    expect(p.roles).to.equal(ROLE.ADMIN | ROLE.BORROWER);
    expect(p.verifiedAt).to.be.gt(0);
  });
  it("a second transfer overwrites the first pending one", async () => {
    const f = await loadFixture(deployWithUsersFixture);
    await f.registry.connect(f.admin).transferAdmin(f.other.address);
    await f.registry.connect(f.admin).transferAdmin(f.extra.address);
    await expect(f.registry.connect(f.other).acceptAdmin()).to.be.revertedWithCustomError(f.registry, "NotPendingAdmin");
    await f.registry.connect(f.extra).acceptAdmin();
    expect(await f.registry.admin()).to.equal(f.extra.address);
  });
});
