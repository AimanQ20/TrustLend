# Viva notes (Member 1): the 20% you must be able to say fluently

## One-minute story
"I built the permission layer. A wallet registers as lender or borrower and becomes **Pending**; a **verifier** approves it to **Active**. Roles are bits in one byte packed in the same storage slot as the status, so checks are cheap. Workflow and Escrow inherit `RegistryAccessControl`, which asks the Registry on every call, so suspending someone or pausing the Registry takes effect everywhere. I also built the off-chain role service and the role-based UI, and measured gas for role assignment."

## Likely questions
| Question | Answer |
|---|---|
| Why inheritance here? | One rule-set (modifiers, errors, pause) reused by 3 contracts; children only decide *where* roles live (two hooks). Not just file splitting: Registry overrides hooks with storage reads, `RegistryAccessControl` overrides them with registry calls and also changes `paused()` |
| Why not OpenZeppelin AccessControl? | OZ is fine and audited; I wrote a small purpose-built one for gas (bit flags, packed slot) and the Active-status rule. Trade-off: max 8 roles and non-OZ ABI. I only imitated OZ's enumerable pattern for the baseline, no code copied |
| What does "Active" add over having a role? | Role bit = permission granted; Active = person verified and not suspended. Without it a suspended verifier could keep approving |
| What did you optimize and how much? | `assignRole`: baseline ~84-101k gas vs ~34k (about -59 to -66%) for an existing user; `register` about -56 to -60%; new staff wallet about -68 to -71%. Two changes: packed bit-flag roles (one SSTORE reset instead of new mapping slot + counter) and no on-chain member array (events instead). Custom errors are a third, unmeasured, change |
| Is the comparison fair? | Same compiler/optimizer/inputs/order, fresh deployments, receipts; behavior identical for those operations; baseline is a realistic first draft in OZ-Enumerable style. I did not compare deployment gas because the final contract has far more features |
| Trade-offs? | 8-role cap, non-standard ABI, less readable masks (mitigated by `Roles` constants), no on-chain enumeration (needs the indexer) |
| What stops privilege escalation? | Self-registration only allows Lender/Borrower; ADMIN is not grantable (two-step handover only); verifier cannot approve self or suspend staff/admin; admin cannot be suspended |
| Why can the admin act while paused? | Emergency response must remain possible: suspend, revoke, renounce, handover and unpause work while paused; register/verify/assign/reinstate do not |
| Why can the pauser not resume? | Fast stop, deliberate restart: a compromised pauser cannot toggle freely |
| Where is personal data? | Off-chain. On-chain only `keccak256(record + salt)`; salt prevents dictionary guessing |
| What is the off-chain component and its trust? | Read-only service that rebuilds lists from events and re-reads each answer from the contract at one block. It cannot grant or fake a role. If it is down, UI shows a banner and on-chain actions still work |
| Re-entrancy? | Registry holds no ether, no external calls; downstream checks are `view` (STATICCALL) |
| What are the weak points? | Centralized admin key (use multisig/timelock), off-chain KYC trust, not audited, fixed roles |
| How do you know it works? | 141 tests; 108 on the Registry directly; 100% line coverage of Registry; 3x250 random actions with 8 invariants; Slither with 4 informational findings (false positives, triaged) |
| What would you do next? | Multisig admin, role expiry, Echidna fuzzing, upgrade path via proxy with storage-layout checks |

## Numbers to remember
141 tests; Registry 100% line / 98.9% branch coverage; 6 roles in a uint8; status slot holds status(1)+registeredAt(5)+verifiedAt(5)+roles(1) bytes; 10 forbidden actions in the demo.
