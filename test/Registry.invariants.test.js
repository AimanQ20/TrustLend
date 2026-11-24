// Randomised (seeded, reproducible) state-machine test: after EVERY random action - successful or
// reverted - the registry's security invariants must still hold.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ROLE, ROLE_ALL, ROLE_PUBLIC, ROLE_STAFF, STATUS, kyc } = require("./helpers");

function rng(seed) { // small deterministic LCG
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

describe("Registry - randomised invariants (seeded)", function () {
  this.timeout(300000);
  for (const seed of [1, 7, 2026]) {
    it(`holds all invariants over 250 random actions (seed ${seed})`, async () => {
      const signers = (await ethers.getSigners()).slice(0, 10);
      const registry = await (await ethers.getContractFactory("Registry")).deploy(signers[0].address);
      const rand = rng(seed);
      const pick = (arr) => arr[Math.floor(rand() * arr.length)];
      const roles = [1, 2, 4, 8, 16, 32];
      const everKnown = new Set([signers[0].address]);

      const actions = [
        (a, b) => registry.connect(a).register(pick([8, 16, 24, 4, 0, 1]), rand() < 0.1 ? ethers.ZeroHash : kyc(`k${rand()}`)),
        (a, b) => registry.connect(a).verifyUser(b.address),
        (a, b) => registry.connect(a).suspendUser(b.address),
        (a, b) => registry.connect(a).reinstateUser(b.address),
        (a, b) => registry.connect(a).assignRole(b.address, pick([...roles, 0, 3, 64])),
        (a, b) => registry.connect(a).revokeRole(b.address, pick(roles)),
        (a, b) => registry.connect(a).renounceRole(pick(roles)),
        (a, b) => registry.connect(a).transferAdmin(b.address),
        (a, b) => registry.connect(a).acceptAdmin(),
        (a, b) => registry.connect(a).cancelAdminTransfer(),
        (a, b) => registry.connect(a).pause(),
        (a, b) => registry.connect(a).unpause(),
      ];

      let ok = 0, reverted = 0;
      for (let i = 0; i < 250; i++) {
        // bias towards the admin so interesting state is reached
        const a = rand() < 0.35 ? signers[0] : pick(signers);
        const b = pick(signers);
        try { await (await pick(actions)(a, b)).wait(); ok++; } catch { reverted++; }
        signers.forEach((s) => everKnown.add(s.address));
        await checkInvariants(registry, signers);
      }
      expect(ok).to.be.gte(10); // the run must exercise real state changes, not only reverts
      expect(reverted).to.be.gte(10);
    });
  }
});

async function checkInvariants(registry, signers) {
  const admin = await registry.admin();
  let adminBits = 0;
  for (const s of signers) {
    const p = await registry.getProfile(s.address);
    const status = Number(p.status), roles = Number(p.roles);
    // I1 roles only use defined bits
    expect(roles & ~ROLE_ALL, "undefined role bit").to.equal(0);
    // I2 exactly the admin account holds ADMIN
    if (roles & ROLE.ADMIN) { adminBits++; expect(s.address).to.equal(admin); }
    // I3 unknown accounts own nothing
    if (status === STATUS.None) { expect(roles).to.equal(0); expect(Number(p.verifiedAt)).to.equal(0); }
    // I4 never-verified accounts (Pending, or Suspended-without-verification) hold only public roles
    if (Number(p.verifiedAt) === 0 && status !== STATUS.None) expect(roles & ~ROLE_PUBLIC, "unverified holds privileged role").to.equal(0);
    // I5 Active implies verified
    if (status === STATUS.Active) expect(Number(p.verifiedAt)).to.be.gt(0);
    // I6 active-role view agrees with the raw data
    for (const r of [1, 2, 4, 8, 16, 32])
      expect(await registry.hasActiveRole(s.address, r)).to.equal(status === STATUS.Active && (roles & r) !== 0);
  }
  expect(adminBits).to.equal(1); // I7 there is ALWAYS exactly one admin
  expect(await registry.hasActiveRole(admin, ROLE.ADMIN)).to.equal(true); // I8 admin is Active
}
