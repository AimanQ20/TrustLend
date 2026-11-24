// TrustLend - Hardhat configuration (Member 1 package)
require("dotenv").config({ quiet: true });
require("@nomicfoundation/hardhat-toolbox");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

// OPTIONAL fallback: if your network blocks the native solc download
// (binaries.soliditylang.org), run with  USE_SOLCJS=1  to use the npm "solc" package.
// Slower, but gives identical bytecode semantics and needs no extra download.
if (process.env.USE_SOLCJS === "1") {
  subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
    if (args.solcVersion !== "0.8.24") return runSuper();
    const compilerPath = require.resolve("solc/soljson.js");
    const solc = require("solc");
    return {
      compilerPath,
      isSolcJs: true,
      version: args.solcVersion,
      longVersion: solc.version(),
    };
  });
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 }, // same settings for baseline AND optimized (fair gas comparison)
    },
  },
  networks: {
    hardhat: {},
    // Local node: `npx hardhat node`
    localhost: { url: process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545" },
    // Public testnet (optional). Keys come from the environment ONLY - never commit them.
    ...(process.env.SEPOLIA_RPC_URL && process.env.DEPLOYER_PRIVATE_KEY
      ? { sepolia: { url: process.env.SEPOLIA_RPC_URL, accounts: [process.env.DEPLOYER_PRIVATE_KEY] } }
      : {}),
  },
  gasReporter: { enabled: process.env.REPORT_GAS === "1", currency: "USD" },
  paths: { sources: "./contracts", tests: "./test", cache: "./cache", artifacts: "./artifacts" },
};
