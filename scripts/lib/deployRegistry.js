// Reusable helper: Member 3's full deployment script can call deployRegistry() first, then deploy the workflow + escrow.
const { ethers } = require("hardhat");

async function deployRegistry(adminAddress) {
  const Registry = await ethers.getContractFactory("Registry");
  const registry = await Registry.deploy(adminAddress);
  await registry.waitForDeployment();
  return registry;
}
module.exports = { deployRegistry };
