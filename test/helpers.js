// Shared constants + fixtures for the Member 1 test-suite.
const { ethers } = require("hardhat");

const ROLE = { ADMIN: 1, PAUSER: 2, VERIFIER: 4, LENDER: 8, BORROWER: 16, ARBITER: 32 };
const ROLE_ALL = 63;
const ROLE_PUBLIC = ROLE.LENDER | ROLE.BORROWER; // 24
const ROLE_STAFF = ROLE.PAUSER | ROLE.VERIFIER | ROLE.ARBITER; // 38
const STATUS = { None: 0, Pending: 1, Active: 2, Suspended: 3 };
const kyc = (label) => ethers.keccak256(ethers.toUtf8Bytes(`kyc-record:${label}`)); // fake off-chain KYC hash

/** Fresh registry with admin + one staff member per staff role (all Active). */
async function deployRegistryFixture() {
  const [admin, pauser, verifier, arbiter, lender, borrower, outsider, other, extra] = await ethers.getSigners();
  const Registry = await ethers.getContractFactory("Registry");
  const registry = await Registry.deploy(admin.address);
  await registry.waitForDeployment();
  await registry.connect(admin).assignRole(pauser.address, ROLE.PAUSER);
  await registry.connect(admin).assignRole(verifier.address, ROLE.VERIFIER);
  await registry.connect(admin).assignRole(arbiter.address, ROLE.ARBITER);
  return { registry, admin, pauser, verifier, arbiter, lender, borrower, outsider, other, extra };
}

/** Same as above + lender and borrower registered AND verified (Active). */
async function deployWithUsersFixture() {
  const f = await deployRegistryFixture();
  await f.registry.connect(f.lender).register(ROLE.LENDER, kyc("lender"));
  await f.registry.connect(f.borrower).register(ROLE.BORROWER, kyc("borrower"));
  await f.registry.connect(f.verifier).verifyUser(f.lender.address);
  await f.registry.connect(f.verifier).verifyUser(f.borrower.address);
  return f;
}

module.exports = { ROLE, ROLE_ALL, ROLE_PUBLIC, ROLE_STAFF, STATUS, kyc, deployRegistryFixture, deployWithUsersFixture };
