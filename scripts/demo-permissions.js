// Live "permission wall" demo for the viva. Needs the local node + deploy-registry.js (demo seed) to be running:
//   npx hardhat run scripts/demo-permissions.js --network localhost
// It tries a series of FORBIDDEN actions and prints how the contract rejects each one, then proves the allowed path works.
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const ROLE = { ADMIN: 1, PAUSER: 2, VERIFIER: 4, LENDER: 8, BORROWER: 16, ARBITER: 32 };
const names = (m) => Object.entries(ROLE).filter(([, b]) => (Number(m) & b) !== 0).map(([n]) => n).join("|") || "-";

function findRevertData(x, depth = 0) { // wallets / providers nest the revert bytes differently
  if (!x || depth > 6) return null;
  if (typeof x === "string") return /^0x[0-9a-fA-F]{8,}$/.test(x) ? x : null;
  if (typeof x !== "object") return null;
  for (const k of ["data", "error", "info", "originalError", "revert"]) { const h = findRevertData(x[k], depth + 1); if (h) return h; }
  return null;
}

async function main() {
  const info = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "localhost.json"), "utf8"));
  const [admin, pauser, verifier, arbiter, lender, borrower, pending, stranger] = await hre.ethers.getSigners();
  const registry = await hre.ethers.getContractAt("Registry", info.registry);
  const kyc = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("demo-attacker"));
  let blocked = 0;

  async function attack(label, promiseFn) {
    try {
      await promiseFn();
      console.log(`  ✖ NOT BLOCKED  ${label}   <-- would be a bug`);
      process.exitCode = 1;
    } catch (e) {
      const raw = findRevertData(e);
      const err = raw ? registry.interface.parseError(raw) : null;
      const args = err ? err.args.map((a) => (typeof a === "string" ? a.slice(0, 8) + "…" : a.toString())).join(", ") : "";
      console.log(`  ✔ blocked  ${label}\n             -> ${err ? err.name : "reverted"}(${args})`);
      blocked++;
    }
  }

  console.log("\nATTACK 1: privilege escalation");
  await attack("lender grants THEMSELVES the ARBITER role", () => registry.connect(lender).assignRole.staticCall(lender.address, ROLE.ARBITER));
  await attack("stranger registers directly as VERIFIER", () => registry.connect(stranger).register.staticCall(ROLE.VERIFIER, kyc));
  await attack("borrower tries to promote a friend to ADMIN", () => registry.connect(borrower).assignRole.staticCall(stranger.address, ROLE.ADMIN));
  await attack("even the admin cannot mint a 2nd ADMIN via assignRole", () => registry.connect(admin).assignRole.staticCall(stranger.address, ROLE.ADMIN));
  await attack("verifier approves THEIR OWN account", () => registry.connect(verifier).verifyUser.staticCall(verifier.address));
  await attack("unverified (Pending) borrower is not a verifier", () => registry.connect(pending).verifyUser.staticCall(lender.address));

  console.log("\nATTACK 2: abusing suspension / pause");
  await attack("verifier tries to suspend the ADMIN", () => registry.connect(verifier).suspendUser.staticCall(admin.address));
  await attack("verifier tries to suspend a staff colleague (arbiter)", () => registry.connect(verifier).suspendUser.staticCall(arbiter.address));
  await attack("pauser tries to RESUME the system (admin only)", async () => { await registry.connect(admin).pause(); try { await registry.connect(pauser).unpause.staticCall(); } finally { await registry.connect(admin).unpause(); } });

  console.log("\nALLOWED PATH (proves the wall is not just 'everything fails')");
  await (await registry.connect(admin).pause()).wait();
  console.log("  admin paused the system     -> paused() =", await registry.paused());
  await attack("registration while paused", () => registry.connect(stranger).register.staticCall(ROLE.LENDER, kyc));
  await (await registry.connect(admin).unpause()).wait();
  console.log("  admin resumed the system    -> paused() =", await registry.paused());
  const p = await registry.getProfile(lender.address);
  console.log(`  lender profile: status=${["None", "Pending", "Active", "Suspended"][Number(p.status)]} roles=${names(p.roles)}`);
  console.log(`\n${blocked} forbidden actions blocked by the contract.\n`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
