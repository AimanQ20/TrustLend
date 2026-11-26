# TrustLend: access control, loan workflow and role UI

**TrustLend** is a peer-to-peer lending DApp on Ethereum. Lenders fund loans requested by borrowers, verifiers check identities, an arbiter is reserved for dispute resolution, and an admin operates the platform. Smart contracts provide the shared permission and loan lifecycle; no personal documents or bank account data are stored on-chain.

This repository combines the completed work of:

- **Member 1:** access control, Registry, role UI, off-chain role service, deployment tooling and gas optimization.
- **Member 2:** core loan workflow, on-chain events, workflow UI, event listener and workflow integration tooling.
- **Member 3:** escrow and dispute resolution remains **pending**. The project does not yet accept or transfer real loan ETH.

> Project scope: the code is designed for a local Hardhat chain or a test network. It is not a production financial system and has not been externally audited.

## 1. Combined architecture

```text
                    ┌─────────────────────────────────────┐
                    │             MetaMask wallet          │
                    └──────────────────┬──────────────────┘
                                       │ EIP-1193
                         ┌─────────────┴─────────────┐
                         │     Static frontend       │
                         │  index.html / app.js      │
                         │  workflow.html / workflow.js│
                         └─────────────┬─────────────┘
                                       │ ethers v6
                 ┌─────────────────────┴─────────────────────┐
                 │              Ethereum / Hardhat              │
                 │                                              │
                 │  Registry ── immutable reference ── CoreWorkflow
                 │     │                                     │
                 │     │ role/status checks                 │ events
                 │     └──── RegistryAccessControl ──────────┘
                 │
                 │  Member 3 escrow (PENDING): receive/release
                 │  ETH and call markFunded / markRepaid /
                 │  markDisputed after verified conditions
                 └───────────────────────┬──────────────────────┘
                                         │
                         ┌───────────────┴───────────────┐
                         │ Off-chain services             │
                         │ role-service :8787             │
                         │ workflow-listener :8788        │
                         └───────────────────────────────┘
```

The Registry is the single source of truth for roles and active status. `CoreWorkflow` inherits `RegistryAccessControl`, so it uses the same registry, role checks and pause state. Off-chain services only index or describe on-chain data; every state-changing action is authorized and validated again by a smart contract.

## 2. Roles and account states

Roles use one bit per role in `uint8`:

| Role | Bit | Typical responsibility |
|---|---:|---|
| `ADMIN` | 1 | Platform administration and two-step admin handover |
| `PAUSER` | 2 | Emergency pause |
| `VERIFIER` | 4 | KYC verification and, with limits, suspension |
| `LENDER` | 8 | Fund approved loans through the future escrow |
| `BORROWER` | 16 | Request and cancel loans |
| `ARBITER` | 32 | Reserved for Member 3 dispute resolution |

User status is `None -> Pending -> Active`, with `Suspended` available as a reversible state. Only Active accounts have an active role.

- Public self-registration accepts only `LENDER` and/or `BORROWER`.
- The on-chain KYC reference is a hash, not a document or identity record.
- Staff roles are assigned by the Admin.
- A Verifier cannot approve its own account.
- A Pauser or Admin may pause; only the Admin may resume.
- Suspending and revoking roles remain available as incident controls while paused where implemented.

## 3. Loan workflow

`contracts/CoreWorkflow.sol` implements the loan lifecycle. It holds no ETH and does not itself perform a fund or repayment transfer.

```text
Requested ── Verifier approve ──> Approved ── escrow markFunded ──> Funded ── escrow markRepaid ──> Repaid
    │
    ├── Verifier reject ──────────> Rejected
    └── Borrower cancel ──────────> Cancelled

Funded ── escrow markDisputed ──> Disputed
Approved or Requested ── Borrower cancel ──> Cancelled
```

The numerical state values are `None=0`, `Requested=1`, `Approved=2`, `Rejected=3`, `Cancelled=4`, `Funded=5`, `Repaid=6`, `Disputed=7`.

### Transition rules

| Function | Caller | Required state and checks |
|---|---|---|
| `requestLoan(amountWei)` | Borrower | System not paused; amount non-zero; active Borrower |
| `approveLoan(id)` | Verifier | `Requested`; verifier is not the borrower |
| `rejectLoan(id)` | Verifier | `Requested`; active Verifier |
| `cancelLoan(id)` | Original borrower | `Requested` or `Approved` |
| `markFunded(id, lender)` | Configured escrow | `Approved`; lender non-zero, not borrower, and active Lender |
| `markRepaid(id)` | Configured escrow | `Funded` |
| `markDisputed(id)` | Configured escrow | `Funded` |

`setEscrow(address)` is Admin-only and can be called once. It verifies that the address is non-zero and has deployed code. The future escrow must independently verify ETH movements before calling the workflow; workflow events do not prove that real funds moved.

### Workflow events

The contract emits `LoanRequested`, `LoanApproved`, `LoanRejected`, `LoanCancelled`, `LoanFunded`, `LoanRepaid`, `LoanDisputed` and `EscrowConfigured`. These events are the source of truth for the read-only listener and UI history.

## 4. Repository structure

```text
contracts/
  access/
    Roles.sol                         role bit constants
    BaseAccessControl.sol             role, pause and status modifiers
    RegistryAccessControl.sol         downstream authorization base
  interfaces/
    IRegistry.sol                     registry interface
    IPausable.sol                     pause interface
    IWorkflow.sol                     proposed workflow interface for Member 3
  gas/
    RegistryBaseline.sol              Registry before/contrast implementation
    WorkflowBaseline.sol              workflow gas baseline (same authorization, unpacked struct)
  mocks/
    MockGuarded.sol                   downstream access-control test stand-in
    MockWorkflowEscrow.sol            test-only workflow escrow; never deploy
  Registry.sol                        identity, KYC, roles, pause and admin handover
  CoreWorkflow.sol                    Member 2 loan state machine

scripts/
  deploy-registry.js                  deploy and seed the Registry
  deploy-workflow.js                  deploy CoreWorkflow and update deployment metadata
  gas-report.js                       Registry baseline/optimized measurements
  gas-workflow.js                     illustrative workflow comparison
  demo-permissions.js                 permission-flow demo
  export-abi.js                       export frontend ABI files
  lib/                                deployment and gas helpers

offchain/
  role-service/                       Member 1 wallet/profile/role HTTP service
  workflow-listener.js                Member 2 on-chain workflow event feed

frontend/
  index.html, app.js                  access and role UI
  workflow.html, workflow.js          loan request/review/status UI
  deployment.json                     local or test-network deployment addresses
  abi/                              exported Registry and CoreWorkflow ABI
  vendor/ethers.umd.min.js           bundled ethers v6 browser build
  serve.js                            local static server

test/
  Registry.*.test.js                  lifecycle, access, pause, admin and invariants
  RegistryAccessControl.test.js       downstream integration
  CoreWorkflow.test.js                Member 2 workflow tests
  gas.test.js                         25% Registry gas regression guard
  roleService.test.js                 role service tests
  ui.test.js                          role UI tests

docs/
  MEMBER2_README.md                   Member 2 implementation notes
  INTEGRATION_GUIDE.md                contract integration contract
  GAS_REGISTRY.md                     measured Registry gas evidence
  REPORT_USE_CASE.md                  use cases
  REPORT_SECURITY.md                  security evidence and limitations
  REPORT_LIMITATIONS.md               project limitations
  DEMO_SCRIPT.md                      Member 1 demo
  VIVA_NOTES.md                       viva reference

deployments/                          network deployment metadata
artifacts/, cache/                    Hardhat build output
```

## 5. Installation

Requirements:

- Node.js 18 or newer (Node.js 22 was used for the project checks)
- npm
- MetaMask

```powershell
cd E:\sem-7\BlockChain\TrustLend_Members_1_and_2_Combined\trustlend
npm install
npx hardhat compile
```

If the network blocks the native Solidity compiler download:

```powershell
$env:USE_SOLCJS="1"
npx hardhat compile
```

The project uses Solidity `0.8.24` and the Hardhat optimizer with 200 runs.

## 6. Local deployment and execution

Open five terminals from the project root.

### Terminal 1: start Hardhat

```powershell
npm run node
```

This starts JSON-RPC at `http://127.0.0.1:8545` with chain ID `31337` and prints development-only accounts.

### Terminal 2: deploy the Registry

```powershell
npm run deploy:local
```

On localhost, demo seeding is enabled by default. It creates an Admin, Pauser, Verifier, Arbiter, active lender and borrower, plus a pending borrower, and writes `deployments/localhost.json` and `frontend/deployment.json`.

### Terminal 3: deploy CoreWorkflow

```powershell
npx hardhat run scripts/deploy-workflow.js --network localhost
```

This reads the deployed Registry address, deploys `CoreWorkflow`, updates deployment metadata and exports `frontend/abi/CoreWorkflow.json`. It deliberately does not configure a real escrow.

### Terminal 4: start off-chain services

Run the role service:

```powershell
npm run service
```

It is available at `http://127.0.0.1:8787`.

Run the workflow listener:

```powershell
node offchain/workflow-listener.js
```

It is available at `http://127.0.0.1:8788/events`. It reads the deployed workflow logs from `workflowDeployBlock` to latest block and returns at most 100 matching events.

### Terminal 5: start the frontend

```powershell
npm run frontend
```

Open:

- `http://127.0.0.1:5173/` — Registry, identity and role UI
- `http://127.0.0.1:5173/workflow.html` — loan workflow UI

The common header links Home, Register / Roles and Loans. Switching from one page to the other preserves the same MetaMask account and contract network context. The UI hides convenience controls by role, but the contracts enforce authorization independently.

## 7. MetaMask setup

In MetaMask, add a custom network:

| Setting | Value |
|---|---|
| Network name | Hardhat Local |
| RPC URL | `http://127.0.0.1:8545` |
| Chain ID | `31337` |
| Currency symbol | ETH |

Import one of the private keys printed by `npm run node`. These are public Hardhat development keys with fake ETH:

- Account 0: deployer/Admin
- Account 1: Pauser
- Account 2: Verifier
- Account 3: Arbiter
- Account 4: Lender
- Account 5: Active Borrower
- Account 6: Pending Borrower

Switch accounts in MetaMask to demonstrate registration, verification, loan request, approval, rejection and cancellation. Never import these keys into a real wallet or use them on public networks.

## 8. Test and measurement commands

```powershell
npm test
npm run coverage
npm run gas
npx hardhat run scripts/gas-workflow.js
npx hardhat run scripts/demo-permissions.js --network localhost
```

`npm test` runs the complete Hardhat suite. The combined suite contains 7 Member 2 workflow tests plus the existing 141-test Registry, downstream, off-chain and UI suite. The `npm test` run includes 3 seeded invariant scenarios, each exercising 250 random actions.

Targeted workflow test:

```powershell
npx hardhat test test/CoreWorkflow.test.js
```

Targeted listener test is not a separate test command; workflow event behavior is covered through contract tests and manual `8788/events` verification.

### Test evidence

| Area | Evidence |
|---|---|
| Registry lifecycle | normal, boundary and failure cases for registration, verification, suspension, reinstatement, role management and views |
| Registry authorization | wrong-caller and privilege-escalation negative tests |
| Pause and emergency controls | blocked actions, allowed incident controls and resume rules |
| Admin handover | two-step transfer, cancel, typo safety and suspended-target checks |
| Registry invariants | 3 reproducible seeds x 250 random actions, checking 8 invariants after every action |
| Registry downstream control | inherited role/status/pause behavior in `RegistryAccessControl` |
| CoreWorkflow | 7 tests covering request, approve, reject/cancel, replay/skipped-transition guards, escrow authorization, pause and dispute |
| Gas guard | 9 optimized-vs-baseline Registry operation measurements; all must save at least 25% |
| Role service | HTTP endpoints, validation, RPC failure and rate-limit behavior |
| Frontend | role panels, wallet/network behavior, transaction and decoded-error flows |

Registry coverage evidence is documented by the project and can be regenerated with `npm run coverage`: `Registry.sol` 100% statements, 100% lines, 100% functions and 98.9% branches.

## 9. Gas optimization

### Verified Registry measurements

The measured values in `docs/GAS_REGISTRY.md` come from `scripts/gas-report.js` using Hardhat, Solidity 0.8.24 and optimizer 200 runs. The comparison uses `receipt.gasUsed` for equivalent operations.

| Operation | Baseline | Optimized | Measured saving |
|---|---:|---:|---:|
| `register()` new wallet, first | 184425 | 73128 | 60.3% |
| `register()` new wallet, steady state | 167337 | 73140 | 56.3% |
| `assignRole()` existing user, first | 101370 | 34230 | 66.2% |
| `assignRole()` existing user, steady state | 84270 | 34230 | 59.4% |
| `assignRole()` new staff, first | 185340 | 54133 | 70.8% |
| `assignRole()` new staff, steady state | 168240 | 54133 | 67.8% |

Registry optimizations:

1. Packed status, timestamps and bit-mask roles into a single user profile slot.
2. Removed on-chain per-role member arrays; events and the off-chain role service provide lookup and audit history.
3. Used custom errors and cached storage reads in hot paths.

### Workflow gas measurement

`npx hardhat run scripts/gas-workflow.js` compares `WorkflowBaseline` and `CoreWorkflow`. Both use the same Registry authorization, modifiers, checks, events and errors; only the `Loan` struct layout differs.

| Operation | Baseline gas | Optimized gas | Change |
|---|---:|---:|---:|
| `requestLoan` | 106268 | 84317 | -20.7% |
| `approveLoan` | 41655 | 41721 | +0.2% (no change) |

The saving in `requestLoan` comes from packing `borrower` and `uint96 amountWei` into one slot. `approveLoan` reads the same number of slots either way, so no saving is claimed for it.

## 10. Security

Key controls:

- Registry role/status checks run on-chain; frontend visibility is only a convenience.
- Staff-role and public-registration masks are validated.
- Two-step Admin handover prevents accidental transfer.
- Custom errors and Solidity 0.8.24 checked arithmetic improve input failure handling.
- Registry pause propagates into contracts based on `RegistryAccessControl`.
- Suspension, role revocation and emergency controls take effect immediately.
- CoreWorkflow validates exact replay/skipped states and binds financial transitions to one escrow address.
- `markFunded` verifies that the lender is not the borrower and holds an active Lender role.
- The workflow and Registry do not hold ETH.

Current limitations:

- KYC verification is trusted off-chain; the chain verifies the hash and verifier action only.
- The admin is a centralized trusted key. A multisig and timelock are recommended in production.
- The role model is fixed to a `uint8`; adding roles requires a contract change.
- The contracts are not upgradeable.
- The role service is read-only and can lag or become unavailable.
- The listener has no database; it rebuilds events from logs on each request and is local/service-oriented.
- CoreWorkflow has no due dates, interest, repayment amount or real escrow.
- The mock escrow only calls workflow transitions and does not move ETH.
- The project is not externally audited.

Static analysis by Slither 0.11.6 is recorded in `docs/REPORT_SECURITY.md`: no high or medium findings were reported; four informational findings were triaged and explained. Formal verification and external audit are not claimed.

## 11. Member 3 status: escrow and dispute resolution

Member 3 functionality is **pending** and must not be represented as complete.

Required integration:

1. Deploy `CoreWorkflow(registryAddress)` first.
2. Deploy the real escrow with references to the Registry and workflow.
3. The Admin calls `CoreWorkflow.setEscrow(escrowAddress)` once.
4. Escrow reads the loan, verifies `Approved`, the exact `amountWei`, the lender and active Lender status.
5. Escrow securely receives and records ETH, then calls `markFunded(id, lender)`.
6. Escrow calls `markRepaid` only after verified repayment and `markDisputed` only under the agreed dispute rules.
7. Real escrow must use a reentrancy guard and an appropriate checks-effects-interactions or pull-payment design.

The arbiter role and the `Disputed` state exist as future integration hooks. Dispute resolution, ETH custody, release, refund and arbitration UI are not implemented.

## 12. Contribution table

| Member | Responsibilities | Implementation status |
|---|---|---|
| **Member 1** | `Roles`, `BaseAccessControl`, `RegistryAccessControl`, `Registry`, interfaces; KYC/role lifecycle; pause; admin handover; role service; role UI; Registry gas baseline and measurement; access, pause, invariants and UI tests | **Complete for project scope** |
| **Member 2** | `CoreWorkflow`, workflow interface, workflow mock, workflow tests, deploy script, workflow frontend and navigation, off-chain event listener | **Complete for project scope** |
| **Member 3** | ETH escrow/custody, funding/repayment/refund, arbiter dispute resolution, dispute UI and final integrated security/gas work | **Pending / not implemented** |

Detailed Member 1 contribution notes remain in `docs/CONTRIBUTION_MEMBER1.md`; Member 2 implementation notes remain in `docs/MEMBER2_README.md`.

## 13. Demo sequence

For a combined local demo:

1. Start and deploy the local Registry.
2. Deploy CoreWorkflow.
3. Start the role service, event listener and frontend.
4. Connect MetaMask as a Verifier to verify the pending borrower.
5. Switch to the borrower account and request a 1 ETH loan.
6. Switch to the Verifier account and approve or reject loan ID 1.
7. Load the loan status and refresh event history.
8. Repeat an approval or invoke an unauthorized wallet to demonstrate replay/role rejection.
9. Explain that funding, repayment and disputes require the pending Member 3 escrow.

Member 1's permission-only demonstration is also available with:

```powershell
npm run demo:permissions
```

## Member 3 package: escrow, deployment, gas sheet, threat model
See `docs/MEMBER3_README.md`. Quick start: `npx hardhat node`, then `npm run deploy:all`, then `npm run frontend` and open `/escrow.html`. Attack demo: `npm run demo:attack`. Combined documents: `docs/THREAT_MODEL.md`, `docs/GAS_SHEET.md`, `docs/CONTRIBUTION_MATRIX.md`.
