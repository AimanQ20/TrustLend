// One-command full deployment (Gate 2): Registry (+demo seed on local) -> CoreWorkflow -> EscrowDispute -> setEscrow.
//   Local   : npx hardhat node   (terminal 1)       then   npm run deploy:all        (terminal 2)
//   Testnet : set SEPOLIA_RPC_URL and DEPLOYER_PRIVATE_KEY in .env (never committed), then   npm run deploy:sepolia
// Usage: node scripts/deploy-all.js [network]   (default: localhost)
const { execSync } = require("child_process");
const network = process.argv[2] || process.env.HARDHAT_NETWORK || "localhost";
const steps = ["deploy-registry.js", "deploy-workflow.js", "deploy-escrow.js"];
for (const s of steps) {
  console.log(`\n=== ${s} (${network}) ===`);
  execSync(`npx hardhat run scripts/${s} --network ${network}`, { stdio: "inherit", cwd: require("path").join(__dirname, "..") });
}
console.log("\nAll contracts deployed. Addresses: deployments/" + network + ".json  and  frontend/deployment.json");
console.log("Next: node frontend/serve.js  ->  http://127.0.0.1:5173/escrow.html");
