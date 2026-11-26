# Report section: gas, trade-offs and workload justification (Member 3)

## 1. Gas
**Operation chosen:** `EscrowDispute.fund()` (the deposit). It is the most expensive escrow operation and the one every loan uses. Also reported: release, repay, dispute, resolve, withdraw (`docs/GAS_ESCROW.md`).

**Baseline first.** `contracts/gas/EscrowBaseline.sol` was written as the obvious first draft: a `Deposit` struct of `address`, `uint256`, `uint8` (three storage slots) and `require("string")` errors. Everything else is identical: same inheritance, same role checks, same events, same workflow calls, same reentrancy guard and same order of checks, effects and interactions. Same inputs, same signers, fresh deployments, receipt gas.

**Result:** `fund()` 124,774 gas to 80,909 gas, **-35.2%**. The other operations save 2,000 to 4,600 gas (3% to 8%) because they read one slot instead of two.

**Why:** a new storage slot costs 22,100 gas (20,000 for the zero-to-non-zero write plus 2,100 for the cold access). The optimized struct holds `address lender` (20 bytes) + `uint88 amount` (11 bytes) + `Status` (1 byte) = 32 bytes, so a deposit is one slot, not three. Later reads of a deposit load one slot instead of two (one cold SLOAD saved, 2,100 gas).

**Honest limits of the result:** `withdraw()` does not change (0.1%): it has no packed data to save. The percentage on `fund()` is large because the baseline wastes two whole slots; against an already packed baseline there would be no gain. Custom errors were applied too, but failing calls are not measured, so they are not counted in the numbers.

## 2. Trade-offs
| Choice | Gain | Cost / risk | Why accepted |
|---|---|---|---|
| `uint88` amount packed with the lender | -35% on `fund()` | Max about 309 million ETH per deposit; layout becomes part of the contract | `AmountTooLarge` makes the limit explicit and no real loan comes near it |
| Pull payments (`withdraw`) instead of sending ETH inside `release` / `resolve` | A refusing receiver cannot block anyone else; smaller reentrancy surface | One extra transaction for the user | Safety over convenience in a money contract |
| Reentrancy guard kept even though CEI already protects `withdraw()` | Defence in depth: the guard also covers any later change that breaks the CEI order | About 5,000 gas per call at most in the lock writes | Never remove security for gas |
| Internal accounting instead of `address(this).balance` | Immune to forced ETH | One more mapping write per credit | Correctness |
| Pause also blocks `withdraw()` | One kill switch that really freezes money | Users wait during an incident | Simpler and safer incident response |
| Custom errors | Smaller bytecode, decodable in the UI | Raw revert data is less readable | ABI decodes them |

## 3. Workload justification (Member 3)
| Area | What I did | Evidence |
|---|---|---|
| Contract | `EscrowDispute` (about 150 lines), `IEscrow`, inherits `RegistryAccessControl`, drives `CoreWorkflow` through `markFunded/markRepaid/markDisputed` | `contracts/EscrowDispute.sol`, `contracts/interfaces/IEscrow.sol` |
| Security | CEI + guard, exact-amount deposits, per-loan status machine, conflict-of-interest rule, reentrancy attack scenario with a deliberately vulnerable control | `test/EscrowAttack.test.js`, `npm run demo:attack`, `docs/THREAT_MODEL.md` |
| Tests | 34 escrow tests (normal, boundary, failure, access, pause, accounting, attack) + gas regression guard | `test/EscrowDispute.test.js`, `test/EscrowAttack.test.js`, `test/gas.escrow.test.js` |
| Deployment | `deploy-escrow.js`, `deploy-all.js` (one command), local and Sepolia config, no keys in the repo, smoke test through the deployed contracts | `scripts/`, `.env.example`, `npm run deploy:all`, `npm run smoke:escrow` |
| Frontend | Escrow and dispute screens with decoded errors, staticCall pre-flight, history read directly from chain logs | `frontend/escrow.html`, `frontend/escrow.js` |
| Off-chain | Data map, integrity and failure handling | `docs/OFFCHAIN_DATA_MAP.md` |
| Documents | Gas sheet, combined threat model, trade-offs, contribution matrix | `docs/GAS_SHEET.md`, `docs/THREAT_MODEL.md`, `docs/CONTRIBUTION_MATRIX.md` |
