// Run AFTER Member 1's deploy-registry.js; updates existing deployment metadata, never overwrites Member 1 code.
const fs = require("fs"); const path = require("path"); const hre = require("hardhat");
async function main() {
 const root = path.resolve(__dirname, "..");
 const file = path.join(root, "deployments", `${hre.network.name}.json`);
 if (!fs.existsSync(file)) throw new Error("Deploy Registry first: npm run deploy:local");
 const cfg = JSON.parse(fs.readFileSync(file));
 if (!cfg.registry) throw new Error("Missing registry address");
 const network = await hre.ethers.provider.getNetwork();
 if (Number(network.chainId) !== cfg.chainId) throw new Error("Chain mismatch");
 if ((await hre.ethers.provider.getCode(cfg.registry)) === "0x") throw new Error("Registry not deployed on this chain; redeploy it first");
 const workflow = await hre.ethers.deployContract("CoreWorkflow", [cfg.registry]); await workflow.waitForDeployment();
 cfg.workflow = await workflow.getAddress(); cfg.workflowDeployBlock = (await workflow.deploymentTransaction().wait()).blockNumber;
 fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
 fs.writeFileSync(path.join(root, "frontend", "deployment.json"), JSON.stringify(cfg, null, 2));
 const artifact = await hre.artifacts.readArtifact("CoreWorkflow");
 fs.writeFileSync(path.join(root, "frontend", "abi", "CoreWorkflow.json"), JSON.stringify(artifact.abi, null, 2));
 console.log("CoreWorkflow:", cfg.workflow);
 console.log("Member 3 must deploy real escrow and call workflow.setEscrow(escrowAddress) from ADMIN.");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
