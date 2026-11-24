# Project understanding and plan (Member 1)

## 1. What the brief demands (condensed)

A group DApp with a *defensible* reason to use a blockchain, at least **3 contracts** (with real **inheritance**), a **hybrid** off-chain part, **measured gas optimization**, **security work** (threat model, controls, negative tests, 2+ misuse scenarios), a **wallet-connected frontend**, **tests + reproducible deployment**, and an **evidence-based contribution matrix**. 90 marks are for the team deliverable, **10 marks are individual** (documented contribution + viva).

## 2. Requirement to Member 1 traceability

| Rubric criterion (marks) | What Member 1 delivers | Evidence |
|---|---|---|
| Use case + justification (10) | Problem statement and why blockchain, roles, workflows W1/W5 | `docs/REPORT_USE_CASE.md` |
| Architecture + workflows (15) | Role model, user lifecycle state machine, permission layer used by all contracts | `Roles.sol`, `Registry.sol`, `docs/INTEGRATION_GUIDE.md` |
| Multiple contracts + inheritance (10) | `BaseAccessControl` -> `Registry`; `BaseAccessControl` -> `RegistryAccessControl` -> (Workflow, Escrow) | contracts, `RegistryAccessControl.test.js` |
| On/off-chain (10) | Wallet/role lookup service; KYC hash-only data placement | `offchain/role-service`, report section 3 |
| Gas (10) | 1 registry operation, baseline vs optimized, 2 optimizations, trade-offs | `docs/GAS_REGISTRY.md` |
| Security (15) | Access-control controls, unauthorized-action negative tests, pause/emergency, 2 misuse scenarios, Slither | `docs/REPORT_SECURITY.md`, 56+6+7 tests |
| Frontend (10) | Wallet connect, role-based UI shell, tx status/errors | `frontend/`, `test/ui.test.js` |
| Testing/deploy/demo (5) | Tests for registry + base, README, deploy helper, permission demo | README, `scripts/` |
| Report (5) | Use case, security, limitations sections | `docs/REPORT_*.md` |
| Individual (10) | Contribution row + viva notes + commit plan | `docs/CONTRIBUTION_MEMBER1.md`, `docs/VIVA_NOTES.md` |

## 3. Use-case decision

Money-centred, as requested: **TrustLend, a peer-to-peer lending platform** (giving and taking money, repayment, disputes). Members 2 and 3 own the loan workflow and escrow; this package gives them identity and permissions. *The use case is a proposal: agree it with the team in the Day 1-2 meeting (Gate 0).*

## 4. Build order I followed (critical path first)

1. Interfaces and role model (frozen: `IRegistry`, `Roles`) so Members 2 and 3 can start immediately.
2. `BaseAccessControl` + `RegistryAccessControl` (the thing Members 2/3 wait for; brief calls it the critical path).
3. `Registry`, then tests, then gas baseline **before** optimizing, then optimization and re-measure.
4. Role service, deploy helper, frontend shell, then docs and demo.
5. Verification: full test run, coverage, Slither, live local node smoke test, UI test against the real chain.

## 5. Open items for the team (not Member 1's to decide alone)

* Confirm the TrustLend use case and the loan state enum (Member 2).
* Members 2/3 switch from any OpenZeppelin stand-in to `RegistryAccessControl` (roles are `uint8` flags, see integration guide).
* Member 3's deployment script should call `scripts/lib/deployRegistry.js` first and pass the registry address to the other constructors.
