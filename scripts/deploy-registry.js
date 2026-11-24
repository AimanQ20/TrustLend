// Deploys the Registry (Member 1's part of the deployment) and writes deployments/<network>.json + frontend/deployment.json.
//   Local node :  npx hardhat node            (terminal 1)
//                 npx hardhat run scripts/deploy-registry.js --network localhost     (terminal 2)
//   Testnet    :  SEPOLIA_RPC_URL=... DEPLOYER_PRIVATE_KEY=... npx hardhat run scripts/deploy-registry.js --network sepolia
// NEVER commit keys: they are read from environment variables only (see .env.example / .gitignore).
// DEMO_SEED=1 (default on localhost) also creates demo staff and users so the UI can be shown immediately.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { deployRegistry } = require("./lib/deployRegistry");

const ROLE = { PAUSER: 2, VERIFIER: 4, LENDER: 8, BORROWER: 16, ARBITER: 32 };
const kyc = (s) => hre.ethers.keccak256(hre.ethers.toUtf8Bytes(`kyc-record:${s}`));

async function main() {
  const [deployer, pauser, verifier, arbiter, lender, borrower, pendingUser] = await hre.ethers.getSigners();
  const admin = process.env.ADMIN_ADDRESS || deployer.address;
  const registry = await deployRegistry(admin);
  const address = await registry.getAddress();
  const receipt = await registry.deploymentTransaction().wait();
  const net = await hre.ethers.provider.getNetwork();
  const isLocal = ["localhost", "hardhat"].includes(hre.network.name);
  const seed = process.env.DEMO_SEED ? process.env.DEMO_SEED === "1" : isLocal;

  if (seed) {
    if (admin !== deployer.address) throw new Error("DEMO_SEED needs the deployer to be the admin");
    await (await registry.assignRole(pauser.address, ROLE.PAUSER)).wait();
    await (await registry.assignRole(verifier.address, ROLE.VERIFIER)).wait();
    await (await registry.assignRole(arbiter.address, ROLE.ARBITER)).wait();
    await (await registry.connect(lender).register(ROLE.LENDER, kyc("demo-lender"))).wait();
    await (await registry.connect(borrower).register(ROLE.BORROWER, kyc("demo-borrower"))).wait();
    await (await registry.connect(pendingUser).register(ROLE.BORROWER, kyc("demo-pending-borrower"))).wait();
    await (await registry.connect(verifier).verifyUser(lender.address)).wait();
    await (await registry.connect(verifier).verifyUser(borrower.address)).wait();
  }

  const info = {
    network: hre.network.name,
    chainId: Number(net.chainId),
    registry: address,
    admin,
    deployBlock: receipt.blockNumber,
    deployedAt: new Date().toISOString(),
    rpcUrl: isLocal ? "http://127.0.0.1:8545" : "",
    serviceUrl: "http://127.0.0.1:8787",
    demoAccounts: seed
      ? { admin: deployer.address, pauser: pauser.address, verifier: verifier.address, arbiter: arbiter.address, lender: lender.address, borrower: borrower.address, pendingBorrower: pendingUser.address }
      : undefined,
  };
  const root = path.join(__dirname, "..");
  fs.mkdirSync(path.join(root, "deployments"), { recursive: true });
  fs.writeFileSync(path.join(root, "deployments", `${hre.network.name}.json`), JSON.stringify(info, null, 2));
  fs.writeFileSync(path.join(root, "frontend", "deployment.json"), JSON.stringify(info, null, 2));
  console.log("Registry deployed:", address, "| network:", hre.network.name, "| demo seed:", seed);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
