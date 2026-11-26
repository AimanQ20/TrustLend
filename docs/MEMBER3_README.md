# TrustLend: Member 3 (Escrow, deployment, gas sheet, threat model)

## What was added
| Area | Files |
|---|---|
| Contract | `contracts/EscrowDispute.sol`, `contracts/interfaces/IEscrow.sol` |
| Gas baseline and attack controls (test only, never deploy) | `contracts/gas/EscrowBaseline.sol`, `contracts/mocks/VulnerableVault.sol`, `contracts/mocks/ReentrancyAttacker.sol` |
| Tests | `test/EscrowDispute.test.js` (31), `test/EscrowAttack.test.js` (3), `test/gas.escrow.test.js`, `test/escrowFixture.js` |
| Deployment | `scripts/deploy-escrow.js`, `scripts/deploy-all.js`, `scripts/smoke-escrow.js` |
| Gas | `scripts/gas-escrow.js`, `scripts/lib/gasEscrow.js`, `docs/GAS_ESCROW.md`, `docs/gas-escrow.json`, `docs/GAS_SHEET.md` |
| Demo | `scripts/demo-attack.js` |
| Frontend | `frontend/escrow.html`, `frontend/escrow.js`, `frontend/abi/EscrowDispute.json` (nav links added to `index.html` and `workflow.html`) |
| Documents | `docs/THREAT_MODEL.md`, `docs/OFFCHAIN_DATA_MAP.md`, `docs/REPORT_GAS_TRADEOFFS.md`, `docs/CONTRIBUTION_MATRIX.md` |

## How the escrow works
```
fund()           lender sends exactly the approved amount        workflow: Approved -> Funded     escrow: Held
releaseFunds()   borrower accepts                                  credit to borrower              escrow: Released
repay()          borrower sends the same amount back               credit to lender, Funded -> Repaid  escrow: Repaid
raiseDispute()   lender or borrower, only while Held              workflow: Funded -> Disputed    escrow: Disputed
resolveDispute() arbiter (not a party) picks lender or borrower    credit to the winner            escrow: Resolved
withdraw()       anyone with a credit pulls the ETH (CEI + guard)
```

## Run it (Windows PowerShell, inside the project folder)
```
npm install
$env:USE_SOLCJS="1"     # only if the compiler download is blocked on your network
npx hardhat compile
npm test                              # all suites (the invariant test is slow, about 3 minutes)
npx hardhat test test/EscrowDispute.test.js test/EscrowAttack.test.js    # Member 3 only

npm run demo:attack                   # failing-attack demo (no node needed)
npm run gas:escrow                    # regenerates docs/GAS_ESCROW.md

# full local system
npx hardhat node                      # terminal 1
npm run deploy:all                    # terminal 2: registry + demo users, workflow, escrow, setEscrow
npm run smoke:escrow                  # optional: pushes two loans through the deployed contracts
npm run frontend                      # terminal 3 -> http://127.0.0.1:5173/escrow.html
```
Testnet: copy `.env.example` to `.env`, fill `SEPOLIA_RPC_URL` and `DEPLOYER_PRIVATE_KEY` (the deployer must be the registry admin), then `npm run deploy:sepolia`. `.env` is git-ignored; no key is in the repo.

## Demo script (about 3 minutes)
1. `npm run demo:attack`: show attack 1 (naive vault drained, victim's 3 ETH gone) and attack 2 (same attack on `EscrowDispute`: 0 successful re-entries, 1 blocked, victim's 3 ETH intact).
2. Open `escrow.html` with the demo accounts from `frontend/deployment.json`: borrower requests and verifier approves in `workflow.html`; lender funds; borrower releases and withdraws; show history read from chain.
3. Dispute: lender funds a second loan, raises a dispute, arbiter resolves, lender withdraws.
4. Show a failing call with a decoded error (fund with the wrong amount: `WrongAmount`).

## Viva notes (what to be able to explain)
* **Why pull payments:** `withdraw()` is the only place ETH leaves; a refusing receiver can only block itself.
* **CEI:** in `withdraw()` the balance is set to 0 and the event emitted before the ETH call. Even without the guard the second call would see 0 and revert with `NothingToWithdraw`.
* **Why also a guard:** defence in depth if someone later changes the order. In the attack test the guard's `ReentrantCall` is the revert seen by the attacker.
* **Why the vulnerable vault exists:** a control experiment. The same attacker contract drains it, so the test proves the attack is real and our contract resists it.
* **Packing:** `address (20) + uint88 (11) + Status (1) = 32 bytes`, one slot. Saves two 22,100 gas slot writes in `fund()`.
* **Workflow interaction:** escrow is the only address `CoreWorkflow` accepts for financial transitions (`setEscrow` once, admin only). Escrow updates its own state first, then calls the workflow last.
* **Known limits:** no interest, no due dates, disputes only while Held, trusted arbiter, pause blocks withdraw (see `THREAT_MODEL.md`).

## Open items for the team (not Member 3's code)
* Everyone: commit on your own branches with your own git identity, then fill the commit hashes in `docs/CONTRIBUTION_MATRIX.md`.
* Run Slither on `EscrowDispute` and add the triage to `THREAT_MODEL.md`.

## Frontend messages
`frontend/ui-messages.js` shows short, generic pop-ups on `escrow.html` and `workflow.html` (red for errors, green and specific to the action, for example "Loan requested." or "Funds withdrawn."). Messages say what failed, not how the contract works (no block numbers, gas, amounts, states or addresses). Covers contract errors, invalid or empty loan IDs, a missing wallet connection, a cancelled MetaMask popup and an unreachable node. `test/uiMessages.test.js` triggers real reverts, checks the text, checks that no internal detail leaks, and fails if a new custom error has no message.
