// Gas measurement for the Registry: BASELINE (naive, OpenZeppelin-Enumerable style) vs OPTIMIZED (final Registry).
// Methodology: fresh deployment of each, same compiler settings, same signers, same call order, same inputs.
// Gas is read from the transaction receipt (receipt.gasUsed).
const { ethers } = require("hardhat");

const ROLE = { ADMIN: 1, PAUSER: 2, VERIFIER: 4, LENDER: 8, BORROWER: 16, ARBITER: 32 };
const KYC = (i) => ethers.keccak256(ethers.toUtf8Bytes(`gas-kyc-${i}`));

async function runOne(contractName) {
  const signers = await ethers.getSigners();
  const [admin, ...rest] = signers;
  const F = await ethers.getContractFactory(contractName);
  const c = await F.deploy(admin.address);
  const dep = await c.deploymentTransaction().wait();
  const runtimeBytes = (ethers.dataLength(await ethers.provider.getCode(await c.getAddress())));

  const out = { deployGas: dep.gasUsed, runtimeBytes, register: [], assignExisting: [], assignStaff: [] };
  const N = 3; // 3 repetitions; #1 is the "first member of that role" case, #3 is steady state
  for (let i = 0; i < N; i++) {
    const user = rest[i];
    // Operation A: register (BORROWER only), a brand-new wallet
    out.register.push((await (await c.connect(user).register(ROLE.BORROWER, KYC(i))).wait()).gasUsed);
    // Operation B: assignRole to an EXISTING registered user (adds LENDER to the user above)
    out.assignExisting.push((await (await c.connect(admin).assignRole(user.address, ROLE.LENDER)).wait()).gasUsed);
    // Operation C: assignRole creating a NEW staff wallet (VERIFIER)
    out.assignStaff.push((await (await c.connect(admin).assignRole(rest[5 + i].address, ROLE.VERIFIER)).wait()).gasUsed);
  }
  return out;
}

async function measure() {
  const baseline = await runOne("RegistryBaseline");
  const optimized = await runOne("Registry");
  return { baseline, optimized };
}

module.exports = { measure };
