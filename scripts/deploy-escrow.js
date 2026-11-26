// Member 3: deploys EscrowDispute AFTER deploy-registry.js and deploy-workflow.js, then binds it to the workflow
// (CoreWorkflow.setEscrow, admin only, once). Updates deployments/<network>.json, frontend/deployment.json and ABIs.
//   Local   : npx hardhat run scripts/deploy-escrow.js --network localhost
//   Testnet : SEPOLIA_RPC_URL=... DEPLOYER_PRIVATE_KEY=... npx hardhat run scripts/deploy-escrow.js --network sepolia
// Keys are read from the environment only (never committed). The deployer must be the registry admin.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const root = path.resolve(__dirname, "..");
  const file = path.join(root, "deployments", `${hre.network.name}.json`);
  if (!fs.existsSync(file)) throw new Error("Deploy the Registry first: npm run deploy:local");
  const cfg = JSON.parse(fs.readFileSync(file));
  if (!cfg.registry || !cfg.workflow) throw new Error("Missing registry/workflow address. Run deploy-registry.js and deploy-workflow.js first");
  const net = await hre.ethers.provider.getNetwork();
  if (Number(net.chainId) !== cfg.chainId) throw new Error(`Chain mismatch: deployment file is ${cfg.chainId}, node is ${net.chainId}`);
  for (const [name, addr] of [["Registry", cfg.registry], ["CoreWorkflow", cfg.workflow]])
    if ((await hre.ethers.provider.getCode(addr)) === "0x") throw new Error(`${name} is not deployed on this chain; redeploy it first`);

  const [deployer] = await hre.ethers.getSigners();
  const workflow = await hre.ethers.getContractAt("CoreWorkflow", cfg.workflow);
  if ((await workflow.escrow()) !== hre.ethers.ZeroAddress) throw new Error("Workflow already has an escrow (setEscrow is one-time). Redeploy registry + workflow for a fresh system.");
  if (cfg.admin && cfg.admin.toLowerCase() !== deployer.address.toLowerCase()) throw new Error(`Deployer ${deployer.address} must be the registry admin ${cfg.admin} to call setEscrow`);

  const escrow = await hre.ethers.deployContract("EscrowDispute", [cfg.registry, cfg.workflow]);
  await escrow.waitForDeployment();
  cfg.escrow = await escrow.getAddress();
  cfg.escrowDeployBlock = (await escrow.deploymentTransaction().wait()).blockNumber;
  await (await workflow.setEscrow(cfg.escrow)).wait();

  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  fs.writeFileSync(path.join(root, "frontend", "deployment.json"), JSON.stringify(cfg, null, 2));
  for (const name of ["EscrowDispute", "CoreWorkflow", "Registry"]) {
    const artifact = await hre.artifacts.readArtifact(name);
    fs.writeFileSync(path.join(root, "frontend", "abi", `${name}.json`), JSON.stringify(artifact.abi, null, 2));
  }
  console.log("EscrowDispute:", cfg.escrow, "| bound to workflow:", cfg.workflow, "| network:", hre.network.name);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
