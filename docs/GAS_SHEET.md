# Combined gas sheet (compiled by Member 3)

All numbers are `receipt.gasUsed` (fee independent), solc 0.8.24, optimizer 200 runs, same inputs before and after. Rule followed: **baseline recorded before optimizing, same checks and events in both versions.**

| # | Member | Operation | Baseline gas | Optimized gas | Saved | Change | Main optimization | Status |
|---|---|---|---:|---:|---:|---:|---|---|
| 1 | M1 | `register()` new wallet (steady state) | 167337 | 73140 | 94197 | -56.3% | Packed bit-flag roles in one slot, no on-chain member array | Valid (see GAS_REGISTRY.md) |
| 2 | M1 | `assignRole()` to existing user (steady state) | 84270 | 34230 | 50040 | -59.4% | same | Valid |
| 3 | M1 | `assignRole()` new staff wallet (steady state) | 168240 | 54133 | 114107 | -67.8% | same | Valid |
| 4 | M3 | `fund()` (primary escrow operation) | 124774 | 80909 | 43865 | -35.2% | Packed `Deposit` (address + uint88 + status = 1 slot instead of 3) | Valid (see GAS_ESCROW.md) |
| 5 | M3 | `releaseFunds()` (steady state) | 58112 | 55772 | 2340 | -4.0% | One cold SLOAD fewer | Valid |
| 6 | M3 | `raiseDispute()` | 62830 | 60781 | 2049 | -3.3% | same | Valid |
| 7 | M3 | `resolveDispute()` | 61183 | 56554 | 4629 | -7.6% | same | Valid |
| 8 | M2 | `requestLoan()` | 106268 | 84317 | 21951 | -20.7% | Packed `borrower + uint96 amount` in one slot (2 slot writes instead of 3) | Valid |
| 9 | M2 | `approveLoan()` | 41655 | 41721 | -66 | +0.2% | none: packing does not change the reads in this function | Valid, reported as no change |

## Workflow baseline (rows 8 and 9)
`WorkflowBaseline` now inherits `RegistryAccessControl` and uses the same modifiers (`whenNotPaused`, `onlyActiveRole`), the same checks, events and custom errors as `CoreWorkflow`. The only difference is the `Loan` struct: `uint256 amountWei` (not packed) against `borrower + uint96 amountWei` (one slot). `requestLoan` saves because it writes one storage slot fewer. `approveLoan` shows no change (+0.2%) because both layouts read the same number of slots, so no saving is claimed for it.

## Brief's requirement check
* At least one measured operation per member: M1 yes, M3 yes, M2 yes (row 8).
* At least two justified optimizations: yes (slot packing of roles, slot packing of the escrow deposit, removal of the on-chain member list, custom errors).
* Trade-offs documented: `docs/REPORT_GAS_TRADEOFFS.md`.

## How to reproduce
```
npm run gas           # Member 1 registry
npm run gas:escrow    # Member 3 escrow  (writes docs/gas-escrow.json and docs/GAS_ESCROW.md)
npx hardhat run scripts/gas-workflow.js   # Member 2 (writes docs/gas-workflow.json)
```
Regression guards: `test/gas.test.js` (registry), `test/gas.escrow.test.js` (escrow).
