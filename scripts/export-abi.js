// Usage: npx hardhat compile && node scripts/export-abi.js
// Writes the Registry ABI for the frontend, the off-chain role service, and Members 2/3.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const art = JSON.parse(fs.readFileSync(path.join(root, "artifacts/contracts/Registry.sol/Registry.json"), "utf8"));
const out = JSON.stringify(art.abi, null, 2);
for (const dest of ["frontend/abi/Registry.json", "offchain/role-service/Registry.abi.json"]) {
  fs.mkdirSync(path.dirname(path.join(root, dest)), { recursive: true });
  fs.writeFileSync(path.join(root, dest), out);
  console.log("wrote", dest);
}
