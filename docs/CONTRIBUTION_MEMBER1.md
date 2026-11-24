# Member 1: contribution matrix row, evidence and commit plan

| Member | Owned work / packages | Evidence (commit / tests / demo) | Effort and justification |
|---|---|---|---|
| **1** | `Roles`, `BaseAccessControl`, `RegistryAccessControl`, `Registry`, `IRegistry`, `IPausable`; wallet/role lookup service; role-based UI shell (wallet connect, tx status/errors); registry gas baseline + optimization; access-control, negative, pause tests; README; report: use case, security, limitations; demo: role/permission flow | Branch `member1/access-registry`; 141 tests (108 Registry suites + 9 downstream + 3 invariants + 10 service + 10 UI + 1 gas); `docs/GAS_REGISTRY.md`; `npm run demo:permissions`; coverage report; Slither triage | Critical-path owner: both other contracts inherit and depend on this base (Day 4 gate). About 600 lines of Solidity (incl. the test-only mock and gas baseline), 170 lines of off-chain service, 300 lines of UI JavaScript plus HTML/CSS, about 940 lines of tests. Security-heavy because every permission in the system relies on it |

## Suggested commit plan (so history backs up the matrix)

Create the branch `member1/access-registry` and commit in this order (small, dated, meaningful):

1. `interfaces: add IRegistry, IPausable, Roles (frozen interfaces)`
2. `access: add BaseAccessControl and RegistryAccessControl`
3. `registry: implement Registry (register, verify, suspend, roles, pause, admin handover)`
4. `test: lifecycle, access-control negatives, pause, admin handover, downstream inheritance`
5. `test: randomised invariants`
6. `gas: add RegistryBaseline and measurement harness (baseline recorded BEFORE optimization)`
7. `gas: generate GAS_REGISTRY.md, add regression guard`
8. `offchain: role lookup service + tests`
9. `scripts: deploy-registry, export-abi, permission demo`
10. `frontend: wallet connect, role-based panels, tx status and error decoding + UI tests`
11. `docs: README, integration guide, report sections, demo script`

Use your own git identity (`git config user.name` / `user.email`) so the history shows your name. Merge to `main` through short-lived branches at least every second day, as the work-division brief asks.

## What you should be able to explain in the viva
Your contracts (`docs/VIVA_NOTES.md`), your tests (access matrix, invariants), your gas change (`docs/GAS_REGISTRY.md`), and your attack demo (`npm run demo:permissions`).
