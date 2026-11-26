# Final contribution matrix (compiled by Member 3)

> Fill the commit hashes once everyone has merged: `git log --author="<name>" --oneline`. The matrix only counts work that is merged to `main`.

| Member | Owned work | Evidence (commit / tests / demo) | Effort and justification |
|---|---|---|---|
| 1 | `Roles`, `BaseAccessControl`, `RegistryAccessControl`, `Registry`, `IRegistry`, `IPausable`; wallet/role lookup service; role-based UI shell; registry gas baseline and optimization; access-control, negative and pause tests; README; report: use case, security, limitations | Commits: _fill in_. 141 tests (`npm test`), `docs/GAS_REGISTRY.md`, `docs/REPORT_SECURITY.md`, `npm run demo:permissions` | Critical path: both other contracts inherit the base. Security heavy because every permission relies on it |
| 2 | `CoreWorkflow`, `IWorkflow`, `MockWorkflowEscrow`; event listener (`offchain/workflow-listener.js`); workflow screens; workflow tests; (integration tests: see open items) | Commits: _fill in_. `test/CoreWorkflow.test.js`, `docs/MEMBER2_README.md`, `scripts/deploy-workflow.js`, demo: request, approve, repeated approval fails, event feed | Owns the loan state machine that escrow drives. Gas: fair baseline for `requestLoan` and `approveLoan` (GAS_SHEET.md rows 8 and 9) |
| 3 | `EscrowDispute`, `IEscrow`, `EscrowBaseline`, `VulnerableVault`, `ReentrancyAttacker`; reentrancy and CEI hardening; escrow attack scenario; off-chain data map and failure handling; escrow and dispute screens; escrow tests; deployment scripts and local/testnet config; gas sheet; combined threat model; workload justification | Commits: _fill in_. 34 escrow tests + gas guard (`npm test`), `npm run demo:attack`, `npm run deploy:all`, `npm run smoke:escrow`, `docs/GAS_ESCROW.md`, `docs/GAS_SHEET.md`, `docs/THREAT_MODEL.md` | Holds all the ETH, so it carries the highest financial risk. Plus integration work: deployment script for all three contracts and the compiled team documents |

## Honest status vs the work division
Done by Member 3: everything in column 3 of the division (contract, tests, gas change, reentrancy/CEI, attack scenario, off-chain map, escrow screens, deployment scripts, gas sheet, threat model, workload text, contribution matrix).
Not Member 3's and still open: Member 2 gas baseline fairness, Member 2 cross-contract integration tests (partly covered by `test/EscrowDispute.test.js` and `scripts/smoke-escrow.js`, which use the real Registry, workflow and escrow), state diagram and architecture diagrams, final report assembly, Slither on the escrow.
