# TrustLend: access control, registry and role UI (Member 1 package)

**TrustLend** is a peer-to-peer lending platform on Ethereum: people with spare money (**lenders**) fund small loans for people who need money (**borrowers**). A credit officer (**verifier**) checks identities, an **arbiter** settles disputes, and an **admin** runs the platform. Smart contracts replace the bank as the trusted middleman.

This repository part is **Member 1's slice** of the *Blockchain Empowerment Project (Fall 2026)*: the permission layer everything else stands on.

> **Caveman version:** Before anyone can lend or borrow, they must sign up and get approved. This package is the "front door + ID card + security guard" of the platform. Members 2 and 3 build the loan logic and the money vault; both ask *this* package "is this wallet allowed to do that?".

| Member 1 deliverable | Where |
|---|---|
| Base contract (inheritance base: roles modifiers + pause) | `contracts/access/BaseAccessControl.sol`, `Roles.sol`, `RegistryAccessControl.sol` |
| Registry (identity, KYC status, roles) | `contracts/Registry.sol`, `contracts/interfaces/IRegistry.sol` |
| Access-control tests, unauthorized-action negative tests, pause/emergency tests | `test/Registry.*.test.js`, `test/RegistryAccessControl.test.js` |
| Gas: one registry operation (role assignment) baseline vs optimized | `contracts/gas/RegistryBaseline.sol`, `scripts/gas-report.js`, `docs/GAS_REGISTRY.md` |
| Off-chain: wallet / role lookup service | `offchain/role-service/` (tested in `test/roleService.test.js`) |
| Frontend: wallet connect, role-based UI shell, tx status/errors | `frontend/` (tested in `test/ui.test.js`) |
| README | this file |
| Report sections (use case, security, limitations) | `docs/REPORT_USE_CASE.md`, `docs/REPORT_SECURITY.md`, `docs/REPORT_LIMITATIONS.md` |
| Demo: role / permission flow | `docs/DEMO_SCRIPT.md`, `scripts/demo-permissions.js` |

## 1. Quick start

Requirements: **Node.js 18+** (tested on 22) and npm.

```bash
npm install
npm test                # 141 automated tests (contracts, gas guard, role service, frontend)
npm run gas             # regenerates docs/GAS_REGISTRY.md
npm run coverage        # Solidity coverage (slow, 1-2 min)
```

> **If compiling fails with a download error** (some networks block `binaries.soliditylang.org`), use the bundled JavaScript compiler: `USE_SOLCJS=1 npm test` (Linux/macOS) or `set USE_SOLCJS=1 && npm test` (Windows cmd). Same result, just slower.

## 2. Run the full local demo (4 terminals)

```bash
# terminal 1: local blockchain (prints 20 test accounts; their keys are PUBLIC test keys, never use them for real money)
npm run node

# terminal 2: deploy the registry + demo users, writes frontend/deployment.json
npm run deploy:local

# terminal 3: off-chain wallet/role lookup service  -> http://127.0.0.1:8787
npm run service

# terminal 4: the web UI                              -> http://127.0.0.1:5173
npm run frontend
```

Open `http://127.0.0.1:5173`, add the local network in MetaMask (RPC `http://127.0.0.1:8545`, chain id `31337`) and import test accounts from terminal 1:

| Account # | Role in the demo | State after `deploy:local` |
|---|---|---|
| 0 | **Admin** | Active |
| 1 | Pauser | Active |
| 2 | **Verifier** | Active |
| 3 | Arbiter | Active |
| 4 | Lender | Active |
| 5 | Borrower | Active |
| 6 | Borrower | **Pending** (waiting for the verifier) |
| 7+ | Strangers | not registered |

Then follow `docs/DEMO_SCRIPT.md`. For a no-browser "permission wall" demo: `npm run demo:permissions`.

## 3. How the permission system works

```
            BaseAccessControl  (abstract: onlyRole / onlyActiveRole / whenNotPaused / pause / unpause)
              |                          |
          Registry                RegistryAccessControl  (asks the Registry, immutable address)
 (stores profiles + roles)               |
                                 CoreWorkflow  (Member 2)      EscrowDispute  (Member 3)
```

* **Roles** are one bit each in a `uint8` (`contracts/access/Roles.sol`): ADMIN 1, PAUSER 2, VERIFIER 4, LENDER 8, BORROWER 16, ARBITER 32.
* **User status**: `None -> Pending -> Active`, and `Suspended` (reversible). Only **Active** users can use their roles. A suspension takes effect everywhere at once.
* **Self-service**: a wallet registers itself as Lender and/or Borrower with a *salted hash* of its KYC record (no personal data on-chain). A Verifier approves it.
* **Staff roles** (Pauser, Verifier, Arbiter) can only be handed out by the Admin.
* **Emergency**: Pauser or Admin pauses; only Admin resumes. Pausing the Registry pauses every contract that inherits `RegistryAccessControl`.
* **Admin handover** is two-step (nominate, then the new wallet accepts), so a typo cannot lose the platform.

Members 2 and 3: read **`docs/INTEGRATION_GUIDE.md`** (5 minutes) before writing code.

## 4. Repository layout

```
contracts/
  Registry.sol                      identity + roles (final, optimized)
  access/  Roles.sol  BaseAccessControl.sol  RegistryAccessControl.sol
  interfaces/  IRegistry.sol (FROZEN)  IPausable.sol
  gas/RegistryBaseline.sol          measurement-only "before" version. NEVER deploy
  mocks/MockGuarded.sol             test stand-in for CoreWorkflow/Escrow
test/                               141 tests (see table below)
scripts/                            deploy-registry.js, gas-report.js, demo-permissions.js, export-abi.js, lib/
offchain/role-service/              read-only HTTP service (event index + on-chain re-verification)
frontend/                           static web app (vanilla JS + ethers v6, no build step)
docs/                               report sections, security, gas sheet, integration guide, demo script, viva notes
```

## 5. Test evidence (`npm test`)

| Suite | Tests | What it proves |
|---|---:|---|
| `Registry.lifecycle` | 39 | normal, boundary and failure cases for register / verify / suspend / reinstate / roles / views |
| `Registry.access` | 56 | **every** privileged function rejects **every** wrong caller; escalation attempts; suspension/revocation effective at once |
| `Registry.pause` | 6 | what is blocked vs still allowed while paused; PAUSER cannot resume |
| `Registry.admin` | 7 | two-step admin handover, typo safety, cancel, suspended targets |
| `RegistryAccessControl` | 9 | a downstream contract inherits the base and obeys registry roles, suspension and pause |
| `Registry.invariants` | 3 | 3 seeded random runs of 250 actions each: 8 invariants checked after every action |
| `gas` | 1 | optimized stays at least 25% cheaper than baseline (regression guard) |
| `roleService` | 10 | off-chain service endpoints, input validation, RPC-down (503), rate limit |
| `ui` | 10 | real `index.html` + `app.js`: role-based panels, register/verify/assign/pause flows, decoded errors, wrong network, service offline |

Coverage of `Registry.sol`: **100% statements, 100% lines, 100% functions, 98.9% branches** (`npm run coverage`).
Static analysis: Slither 0.11.6 on the production contracts, 4 informational results, all triaged in `docs/REPORT_SECURITY.md`.

## 6. Security hygiene

* No private keys, seed phrases or `.env` files are committed (`.gitignore`; `.env.example` lists the variables). Testnet keys come from environment variables only.
* The demo accounts are Hardhat's public test accounts and hold only fake ETH on a local chain.
* Solidity is pinned to `0.8.24`; no `delegatecall`, `selfdestruct`, low-level calls or ether handling in these contracts.

## 7. Attribution (reused vs original code)

* **Original (written for this project):** every `.sol` file, the role service, the frontend, all tests and scripts.
* **Ideas only:** the baseline contract imitates the *pattern* of OpenZeppelin `AccessControlEnumerable` (no OpenZeppelin source code is copied or imported).
* **Third-party tooling/libraries:** Hardhat, hardhat-toolbox (chai, ethers v6 plugin, solidity-coverage), ethers v6 (MIT; `frontend/vendor/ethers.umd.min.js` is the unmodified browser build), jsdom (test only), dotenv, solc-js. Security review used the Trail of Bits *building-secure-contracts* workflow with Slither.
