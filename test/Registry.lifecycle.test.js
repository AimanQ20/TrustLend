const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { ROLE, STATUS, kyc, deployRegistryFixture, deployWithUsersFixture } = require("./helpers");

describe("Registry - lifecycle (normal / boundary / failure)", () => {
  describe("deployment", () => {
    it("makes the deployer-chosen admin an Active ADMIN and emits events", async () => {
      const [admin] = await ethers.getSigners();
      const registry = await (await ethers.getContractFactory("Registry")).deploy(admin.address);
      const tx = registry.deploymentTransaction();
      await expect(tx).to.emit(registry, "AdminTransferred").withArgs(ethers.ZeroAddress, admin.address);
      await expect(tx).to.emit(registry, "RoleGranted").withArgs(ROLE.ADMIN, admin.address, admin.address);
      expect(await registry.admin()).to.equal(admin.address);
      expect(await registry.hasActiveRole(admin.address, ROLE.ADMIN)).to.equal(true);
      expect(await registry.pendingAdmin()).to.equal(ethers.ZeroAddress);
      expect(await registry.paused()).to.equal(false);
    });
    it("reverts for the zero address as admin", async () => {
      const F = await ethers.getContractFactory("Registry");
      await expect(F.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(F, "ZeroAddress");
    });
    it("rejects plain ether transfers (holds no funds)", async () => {
      const { registry, outsider } = await loadFixture(deployRegistryFixture);
      await expect(outsider.sendTransaction({ to: await registry.getAddress(), value: 1n })).to.be.reverted;
      await expect(outsider.sendTransaction({ to: await registry.getAddress(), data: "0xdeadbeef" })).to.be.reverted;
    });
  });

  describe("register", () => {
    it("creates a Pending profile with the chosen public role and the kyc hash", async () => {
      const { registry, lender } = await loadFixture(deployRegistryFixture);
      const ref = kyc("lender");
      await expect(registry.connect(lender).register(ROLE.LENDER, ref))
        .to.emit(registry, "UserRegistered").withArgs(lender.address, ROLE.LENDER, ref)
        .and.to.emit(registry, "RoleGranted").withArgs(ROLE.LENDER, lender.address, lender.address);
      const p = await registry.getProfile(lender.address);
      expect(p.status).to.equal(STATUS.Pending);
      expect(p.roles).to.equal(ROLE.LENDER);
      expect(p.kycRef).to.equal(ref);
      expect(p.verifiedAt).to.equal(0);
      expect(p.registeredAt).to.equal(await time.latest());
    });
    it("accepts both public roles together (boundary: max allowed mask = 24)", async () => {
      const { registry, lender } = await loadFixture(deployRegistryFixture);
      await expect(registry.connect(lender).register(ROLE.LENDER | ROLE.BORROWER, kyc("x")))
        .to.emit(registry, "RoleGranted").withArgs(ROLE.LENDER, lender.address, lender.address);
      expect(await registry.rolesOf(lender.address)).to.equal(24);
    });
    for (const [name, mask] of [
      ["zero mask", 0], ["ADMIN", ROLE.ADMIN], ["PAUSER", ROLE.PAUSER], ["VERIFIER", ROLE.VERIFIER],
      ["ARBITER", ROLE.ARBITER], ["LENDER|VERIFIER", ROLE.LENDER | ROLE.VERIFIER], ["all roles (63)", 63], ["255", 255], ["64 (undefined role)", 64],
    ]) {
      it(`rejects self-registration with ${name}`, async () => {
        const { registry, lender } = await loadFixture(deployRegistryFixture);
        await expect(registry.connect(lender).register(mask, kyc("x"))).to.be.revertedWithCustomError(registry, "InvalidRole").withArgs(mask);
      });
    }
    it("rejects an empty kyc reference", async () => {
      const { registry, lender } = await loadFixture(deployRegistryFixture);
      await expect(registry.connect(lender).register(ROLE.LENDER, ethers.ZeroHash)).to.be.revertedWithCustomError(registry, "InvalidKycRef");
    });
    it("rejects double registration, and registration by an existing admin/staff", async () => {
      const { registry, lender, admin, verifier } = await loadFixture(deployRegistryFixture);
      await registry.connect(lender).register(ROLE.LENDER, kyc("a"));
      for (const s of [lender, admin, verifier])
        await expect(registry.connect(s).register(ROLE.BORROWER, kyc("b"))).to.be.revertedWithCustomError(registry, "AlreadyRegistered").withArgs(s.address);
    });
  });

  describe("verifyUser", () => {
    it("moves Pending -> Active and stamps verifiedAt", async () => {
      const { registry, lender, verifier } = await loadFixture(deployRegistryFixture);
      await registry.connect(lender).register(ROLE.LENDER, kyc("l"));
      await expect(registry.connect(verifier).verifyUser(lender.address)).to.emit(registry, "UserVerified").withArgs(lender.address, verifier.address);
      const p = await registry.getProfile(lender.address);
      expect(p.status).to.equal(STATUS.Active);
      expect(p.verifiedAt).to.equal(await time.latest());
      expect(await registry.isActive(lender.address)).to.equal(true);
    });
    it("cannot verify an unknown, an already Active or a Suspended user", async () => {
      const { registry, lender, outsider, verifier, admin } = await loadFixture(deployRegistryFixture);
      await expect(registry.connect(verifier).verifyUser(outsider.address)).to.be.revertedWithCustomError(registry, "InvalidStatus").withArgs(outsider.address, STATUS.None);
      await registry.connect(lender).register(ROLE.LENDER, kyc("l"));
      await registry.connect(verifier).verifyUser(lender.address);
      await expect(registry.connect(verifier).verifyUser(lender.address)).to.be.revertedWithCustomError(registry, "InvalidStatus").withArgs(lender.address, STATUS.Active);
      await registry.connect(admin).suspendUser(lender.address);
      await expect(registry.connect(verifier).verifyUser(lender.address)).to.be.revertedWithCustomError(registry, "InvalidStatus").withArgs(lender.address, STATUS.Suspended);
    });
    it("a verifier cannot approve themselves (separation of duties)", async () => {
      const { registry, verifier } = await loadFixture(deployRegistryFixture);
      await expect(registry.connect(verifier).verifyUser(verifier.address)).to.be.revertedWithCustomError(registry, "SelfAction");
    });
  });

  describe("suspend / reinstate", () => {
    it("verifier suspends an Active user; admin reinstates to Active (was verified)", async () => {
      const { registry, lender, verifier, admin } = await loadFixture(deployWithUsersFixture);
      await expect(registry.connect(verifier).suspendUser(lender.address)).to.emit(registry, "UserSuspended").withArgs(lender.address, verifier.address);
      expect(await registry.statusOf(lender.address)).to.equal(STATUS.Suspended);
      // role bit is kept, but the account is no longer "active"
      expect(await registry.hasRole(lender.address, ROLE.LENDER)).to.equal(true);
      expect(await registry.hasActiveRole(lender.address, ROLE.LENDER)).to.equal(false);
      await expect(registry.connect(admin).reinstateUser(lender.address)).to.emit(registry, "UserReinstated").withArgs(lender.address, admin.address, STATUS.Active);
      expect(await registry.hasActiveRole(lender.address, ROLE.LENDER)).to.equal(true);
    });
    it("a never-verified user who is suspended returns to Pending, NOT Active (no KYC bypass)", async () => {
      const { registry, lender, verifier, admin } = await loadFixture(deployRegistryFixture);
      await registry.connect(lender).register(ROLE.LENDER, kyc("l"));
      await registry.connect(verifier).suspendUser(lender.address);
      await expect(registry.connect(admin).reinstateUser(lender.address)).to.emit(registry, "UserReinstated").withArgs(lender.address, admin.address, STATUS.Pending);
      expect(await registry.isActive(lender.address)).to.equal(false);
    });
    it("rejects suspending unknown / already suspended users and reinstating non-suspended users", async () => {
      const { registry, lender, outsider, verifier, admin } = await loadFixture(deployWithUsersFixture);
      await expect(registry.connect(verifier).suspendUser(outsider.address)).to.be.revertedWithCustomError(registry, "InvalidStatus").withArgs(outsider.address, STATUS.None);
      await registry.connect(verifier).suspendUser(lender.address);
      await expect(registry.connect(verifier).suspendUser(lender.address)).to.be.revertedWithCustomError(registry, "InvalidStatus").withArgs(lender.address, STATUS.Suspended);
      await expect(registry.connect(admin).reinstateUser(outsider.address)).to.be.revertedWithCustomError(registry, "InvalidStatus").withArgs(outsider.address, STATUS.None);
      await registry.connect(admin).reinstateUser(lender.address);
      await expect(registry.connect(admin).reinstateUser(lender.address)).to.be.revertedWithCustomError(registry, "InvalidStatus").withArgs(lender.address, STATUS.Active);
    });
    it("the admin account can never be suspended, by anyone", async () => {
      const { registry, admin, verifier } = await loadFixture(deployRegistryFixture);
      await expect(registry.connect(verifier).suspendUser(admin.address)).to.be.revertedWithCustomError(registry, "CannotSuspendAdmin");
      await expect(registry.connect(admin).suspendUser(admin.address)).to.be.revertedWithCustomError(registry, "CannotSuspendAdmin");
    });
    it("a verifier cannot suspend staff colleagues; the admin can", async () => {
      const { registry, verifier, pauser, arbiter, admin } = await loadFixture(deployRegistryFixture);
      for (const s of [pauser, arbiter, verifier])
        await expect(registry.connect(verifier).suspendUser(s.address)).to.be.revertedWithCustomError(registry, "Unauthorized").withArgs(verifier.address, ROLE.ADMIN);
      await registry.connect(admin).suspendUser(pauser.address);
      expect(await registry.statusOf(pauser.address)).to.equal(STATUS.Suspended);
    });
  });

  describe("assignRole", () => {
    it("adds a role to an existing user", async () => {
      const { registry, lender, admin } = await loadFixture(deployWithUsersFixture);
      await expect(registry.connect(admin).assignRole(lender.address, ROLE.BORROWER)).to.emit(registry, "RoleGranted").withArgs(ROLE.BORROWER, lender.address, admin.address);
      expect(await registry.rolesOf(lender.address)).to.equal(ROLE.LENDER | ROLE.BORROWER);
    });
    it("creates a fresh Active profile for a new staff wallet", async () => {
      const { registry, admin, outsider } = await loadFixture(deployRegistryFixture);
      await registry.connect(admin).assignRole(outsider.address, ROLE.VERIFIER);
      const p = await registry.getProfile(outsider.address);
      expect(p.status).to.equal(STATUS.Active);
      expect(p.roles).to.equal(ROLE.VERIFIER);
      expect(p.kycRef).to.equal(ethers.ZeroHash);
    });
    it("does not create profiles for unknown wallets with public roles", async () => {
      const { registry, admin, outsider } = await loadFixture(deployRegistryFixture);
      for (const r of [ROLE.LENDER, ROLE.BORROWER])
        await expect(registry.connect(admin).assignRole(outsider.address, r)).to.be.revertedWithCustomError(registry, "NotRegistered").withArgs(outsider.address);
    });
    for (const [name, role] of [["0", 0], ["ADMIN (only via 2-step handover)", 1], ["two bits (12)", 12], ["all bits (63)", 63], ["64", 64], ["128", 128]]) {
      it(`rejects invalid role ${name}`, async () => {
        const { registry, admin, lender } = await loadFixture(deployWithUsersFixture);
        await expect(registry.connect(admin).assignRole(lender.address, role)).to.be.revertedWithCustomError(registry, "InvalidRole").withArgs(role);
      });
    }
    it("rejects the zero address, duplicates, suspended users, and staff roles for non-Active users", async () => {
      const { registry, admin, lender, borrower, outsider, verifier } = await loadFixture(deployRegistryFixture);
      await expect(registry.connect(admin).assignRole(ethers.ZeroAddress, ROLE.PAUSER)).to.be.revertedWithCustomError(registry, "ZeroAddress");
      await registry.connect(lender).register(ROLE.LENDER, kyc("l"));
      // Pending user cannot get a staff role
      await expect(registry.connect(admin).assignRole(lender.address, ROLE.ARBITER)).to.be.revertedWithCustomError(registry, "InvalidStatus").withArgs(lender.address, STATUS.Pending);
      // ...but may get the other public role
      await registry.connect(admin).assignRole(lender.address, ROLE.BORROWER);
      await expect(registry.connect(admin).assignRole(lender.address, ROLE.BORROWER)).to.be.revertedWithCustomError(registry, "RoleAlreadyAssigned").withArgs(lender.address, ROLE.BORROWER);
      await registry.connect(verifier).suspendUser(lender.address);
      await expect(registry.connect(admin).assignRole(lender.address, ROLE.BORROWER)).to.be.revertedWithCustomError(registry, "InvalidStatus").withArgs(lender.address, STATUS.Suspended);
    });
  });

  describe("revokeRole / renounceRole", () => {
    it("admin revokes a role; the account loses it immediately", async () => {
      const { registry, admin, verifier } = await loadFixture(deployRegistryFixture);
      await expect(registry.connect(admin).revokeRole(verifier.address, ROLE.VERIFIER)).to.emit(registry, "RoleRevoked").withArgs(ROLE.VERIFIER, verifier.address, admin.address);
      expect(await registry.hasActiveRole(verifier.address, ROLE.VERIFIER)).to.equal(false);
    });
    it("revoking a role that is not held reverts", async () => {
      const { registry, admin, lender } = await loadFixture(deployWithUsersFixture);
      await expect(registry.connect(admin).revokeRole(lender.address, ROLE.ARBITER)).to.be.revertedWithCustomError(registry, "RoleNotAssigned").withArgs(lender.address, ROLE.ARBITER);
      await expect(registry.connect(admin).revokeRole(admin.address, ROLE.ADMIN)).to.be.revertedWithCustomError(registry, "InvalidRole").withArgs(ROLE.ADMIN);
    });
    it("a user can renounce their own role; ADMIN can never be renounced", async () => {
      const { registry, lender, admin } = await loadFixture(deployWithUsersFixture);
      await expect(registry.connect(lender).renounceRole(ROLE.LENDER)).to.emit(registry, "RoleRevoked").withArgs(ROLE.LENDER, lender.address, lender.address);
      await expect(registry.connect(lender).renounceRole(ROLE.LENDER)).to.be.revertedWithCustomError(registry, "RoleNotAssigned");
      await expect(registry.connect(admin).renounceRole(ROLE.ADMIN)).to.be.revertedWithCustomError(registry, "InvalidRole").withArgs(ROLE.ADMIN);
    });
  });

  describe("views", () => {
    it("hasRole / hasActiveRole use any-of semantics and reject the empty mask", async () => {
      const { registry, lender } = await loadFixture(deployWithUsersFixture);
      expect(await registry.hasRole(lender.address, ROLE.LENDER | ROLE.ARBITER)).to.equal(true);
      expect(await registry.hasActiveRole(lender.address, ROLE.LENDER | ROLE.ARBITER)).to.equal(true);
      expect(await registry.hasRole(lender.address, ROLE.BORROWER | ROLE.ARBITER)).to.equal(false);
      expect(await registry.hasRole(lender.address, 0)).to.equal(false);
      expect(await registry.hasActiveRole(lender.address, 0)).to.equal(false);
    });
    it("unknown accounts have no status, no roles", async () => {
      const { registry, outsider } = await loadFixture(deployRegistryFixture);
      expect(await registry.statusOf(outsider.address)).to.equal(STATUS.None);
      expect(await registry.rolesOf(outsider.address)).to.equal(0);
      expect(await registry.isActive(outsider.address)).to.equal(false);
    });
  });
});
