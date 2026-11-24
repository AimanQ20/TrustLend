// Entry point:  RPC_URL=http://127.0.0.1:8545 REGISTRY_ADDRESS=0x... node offchain/role-service/index.js
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const { createService } = require("./service");

const dep = path.join(__dirname, "..", "..", "deployments", "localhost.json");
const registryAddress = process.env.REGISTRY_ADDRESS || (fs.existsSync(dep) ? JSON.parse(fs.readFileSync(dep)).registry : undefined);
if (!registryAddress) { console.error("Set REGISTRY_ADDRESS (or run the deploy script first)."); process.exit(1); }

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "http://127.0.0.1:8545");
const svc = createService({
  provider,
  registryAddress,
  startBlock: Number(process.env.START_BLOCK || 0),
  corsOrigin: process.env.CORS_ORIGIN || "*",
});
const port = Number(process.env.PORT || 8787);
svc.listen(port).then((p) => console.log(`role-service on http://127.0.0.1:${p}  registry=${registryAddress}`));
