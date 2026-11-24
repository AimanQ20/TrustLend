// NEGATIVE TESTS: every privileged function must reject every caller that lacks the role.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { ROLE, kyc, deployWithUsersFixture } = require("./helpers");

describe("Registry - access control (unauthorized-action negative tests)", () => {
  // [function name, args builder, required-roles value reported in the error, who must be rejected]
  const matrix = [
    ["assignRole", (f) => [f.other.address, ROLE.PAUSER], ROLE.ADMIN, ["outsider", "lender", "borrower", "verifier", "pauser", "arbiter"]],
    ["revokeRole", (f) => [f.verifier.address, ROLE.VERIFIER], ROLE.ADMIN, ["outsider", "lender", "borrower", "verifier", "pauser", "arbiter"]],
    ["reinstateUser", (f) => [f.lender.address], ROLE.ADMIN, ["outsider", "lender", "verifier", "pauser", "arbiter"]],
    ["transferAdmin", (f) => [f.other.address], ROLE.ADMIN, ["outsider", "lender", "verifier", "pauser", "arbiter"]],
    ["cancelAdminTransfer", () => [], ROLE.ADMIN, ["outsider", "lender", "verifier", "pauser", "arbiter"]],
    ["unpause", () => [], ROLE.ADMIN, ["outsider", "lender", "verifier", "pauser", "arbiter"]],
    ["verifyUser", (f) => [f.lender.address], ROLE.VERIFIER, ["outsider", "lender", "borrower", "pauser", "arbiter", "admin"]],
    ["suspendUser", (f) => [f.lender.address], ROLE.VERIFIER | ROLE.ADMIN, ["outsider", "lender", "borrower", "pauser", "arbiter"]],
    ["pause", () => [], ROLE.PAUSER | ROLE.ADMIN, ["outsider", "lender", "borrower", "verifier", "arbiter"]],
  ];

  for (const [fn, args, required, callers] of matrix) {
    for (const who of callers) {
      it(`${fn}() rejects ${who}`, async () => {
        const f = await loadFixture(deployWithUsersFixture);
        if (fn === "unpause") await f.registry.connect(f.admin).pause(); // so the ONLY failure reason is the role
        await expect(f.registry.connect(f[who])[fn](...args(f)))
          .to.be.revertedWithCustomError(f.registry, "Unauthorized")
          .withArgs(f[who].address, required);
      });
    }
  }

  describe("privilege-escalation attempts", () => {
    it("a lender cannot grant themselves any staff/admin role", async () => {
      const f = await loadFixture(deployWithUsersFixture);
      for (const r of [ROLE.ADMIN, ROLE.PAUSER, ROLE.VERIFIER, ROLE.ARBITER])
        await expect(f.registry.connect(f.lender).assignRole(f.lender.address, r)).to.be.revertedWithCustomError(f.registry, "Unauthorized");
    });
    it("a fresh wallet cannot register itself into a staff role", async () => {
      const f = await loadFixture(deployWithUsersFixture);
      await expect(f.registry.connect(f.outsider).register(ROLE.VERIFIER, kyc("x"))).to.be.revertedWithCustomError(f.registry, "InvalidRole");
    });
    it("ADMIN cannot be handed out through assignRole even by the admin", async () => {
      const f = await loadFixture(deployWithUsersFixture);
      await expect(f.registry.connect(f.admin).assignRole(f.other.address, ROLE.ADMIN)).to.be.revertedWithCustomError(f.registry, "InvalidRole");
    });
    it("acceptAdmin by a non-pending wallet is rejected", async () => {
      const f = await loadFixture(deployWithUsersFixture);
      await f.registry.connect(f.admin).transferAdmin(f.other.address);
      await expect(f.registry.connect(f.outsider).acceptAdmin()).to.be.revertedWithCustomError(f.registry, "NotPendingAdmin").withArgs(f.outsider.address);
    });
  });

  describe("suspension and revocation take effect immediately", () => {
    it("a suspended verifier cannot verify; reinstating restores it", async () => {
      const f = await loadFixture(deployWithUsersFixture);
      await f.registry.connect(f.outsider).register(ROLE.LENDER, kyc("o"));
      await f.registry.connect(f.admin).suspendUser(f.verifier.address);
      await expect(f.registry.connect(f.verifier).verifyUser(f.outsider.address)).to.be.revertedWithCustomError(f.registry, "Unauthorized");
      await f.registry.connect(f.admin).reinstateUser(f.verifier.address);
      await f.registry.connect(f.verifier).verifyUser(f.outsider.address);
    });
    it("a suspended pauser cannot pause", async () => {
      const f = await loadFixture(deployWithUsersFixture);
      await f.registry.connect(f.admin).suspendUser(f.pauser.address);
      await expect(f.registry.connect(f.pauser).pause()).to.be.revertedWithCustomError(f.registry, "Unauthorized");
    });
    it("a revoked verifier cannot verify", async () => {
      const f = await loadFixture(deployWithUsersFixture);
      await f.registry.connect(f.outsider).register(ROLE.LENDER, kyc("o"));
      await f.registry.connect(f.admin).revokeRole(f.verifier.address, ROLE.VERIFIER);
      await expect(f.registry.connect(f.verifier).verifyUser(f.outsider.address)).to.be.revertedWithCustomError(f.registry, "Unauthorized");
    });
    it("a Pending (unverified) account holding a staff role has no power", async () => {
      const f = await loadFixture(deployWithUsersFixture);
      // admin makes verifier a second verifier candidate: outsider registers, cannot get staff role while Pending
      await f.registry.connect(f.outsider).register(ROLE.BORROWER, kyc("o"));
      await expect(f.registry.connect(f.admin).assignRole(f.outsider.address, ROLE.VERIFIER)).to.be.revertedWithCustomError(f.registry, "InvalidStatus");
    });
  });
});
