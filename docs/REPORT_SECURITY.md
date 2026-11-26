# Report section: Security (Member 1: access control, input/state validation of the registry, pause/emergency)

> Members 2 and 3 add their own scenarios (misuse of workflow transitions, escrow reentrancy); Member 3 compiles the combined threat model. This section is Member 1's input to it.

## 1. Assets, actors, trust boundaries

**Assets:** (A1) integrity of the role/permission table, because every money action in the other contracts is gated by it; (A2) the admin role; (A3) availability (the platform can be stopped and restarted correctly); (A4) KYC privacy; (A5) integrity of KYC status (nobody gets Active without verification).

**Actors:** honest users, malicious user/outsider, malicious or compromised **verifier**, compromised **pauser**, malicious or compromised **admin**, a downstream contract with a bug, the off-chain service operator.

**Trust boundaries:** wallet -> Registry (everything checked on-chain); downstream contracts -> Registry (read-only staticcalls, immutable address); UI/service -> chain (convenience only, never authoritative); off-chain KYC records (outside the chain; only a hash enters).

## 2. Threat model and mitigations

| ID | Threat | Impact | Mitigation in code | Test evidence |
|---|---|---|---|---|
| T1 | Outsider/lender calls an admin or staff function | Takes over platform | `onlyRole` / `onlyActiveRole` on every privileged function | `Registry.access` (56 tests: each function x each wrong caller) |
| T2 | Self-promotion at registration (`register(VERIFIER)`) | Privilege escalation | Self-registration mask limited to LENDER and/or BORROWER (`InvalidRole`) | lifecycle: 9 invalid masks; demo attack 1 |
| T3 | Granting ADMIN through `assignRole`, or renouncing/revoking ADMIN | Two admins, or no admin | ADMIN excluded from `_isGrantableRole`; admin moves only via two-step handover | access + admin tests; invariants I2, I7 |
| T4 | Verifier approves self or colluding unverified account | KYC bypass | `SelfAction`; verifier must be Active; staff roles only for Active accounts | lifecycle, access |
| T5 | Suspension/reinstatement used to skip KYC | Unverified user becomes Active | Reinstate returns to Pending if `verifiedAt == 0` | lifecycle "no KYC bypass"; invariants I4, I5 |
| T6 | Suspended/revoked staff keep power | Insider abuse persists | `hasActiveRole` requires status Active; revocation immediate; effective in downstream contracts too | access "take effect immediately"; `RegistryAccessControl` tests |
| T7 | Rogue verifier suspends colleagues or admin | Denial of service on staff | Verifier cannot suspend staff (`Unauthorized(ADMIN)`); admin cannot be suspended | lifecycle |
| T8 | Admin key typo / handover to wrong address | Platform lost | Two-step handover with cancel; target must accept; suspended targets refused | admin tests |
| T9 | Incident while paused (compromised key) | Cannot react | Suspend, revoke, renounce, handover and unpause stay available during pause; money-moving actions blocked | pause tests |
| T10 | Pauser abuses the pause to hold platform hostage | Availability | Pauser cannot resume; only admin can; admin can revoke/suspend the pauser even while paused | pause tests |
| T11 | Downstream contract trusts wrong registry or registry swapped | Permission bypass | `registry` is `immutable`, non-zero checked at deployment | `RegistryAccessControl` tests |
| T12 | Re-entrancy via role checks | State corruption | Checks are `view` calls (STATICCALL); Registry holds no ether, has no `receive`/`fallback`, no external calls | ether rejection test; Slither |
| T13 | Personal data leak | Privacy breach | Only a salted hash on-chain; UI hashes locally with a random salt | UI test (hash differs from unsalted hash) |
| T14 | Malformed input (zero address, zero kyc, multi-bit/unknown roles) | Corrupt state | Custom-error validation on every input | lifecycle boundary tests |
| T15 | Off-chain service lies / is stale | Wrong UI | Contract is source of truth; service re-verifies on-chain; UI never trusts it for permissions | service tests |

## 3. Controls implemented (what and why)

* **Role-based authorization**, bit-flag roles in one packed slot: cheap and uniform checks.
* **Status gating** (`onlyActiveRole`): being *approved* matters, not merely holding a role bit.
* **Input/state validation**: custom errors for zero address, empty KYC ref, invalid role, wrong status, duplicates.
* **Pause / emergency**: Pauser or Admin pauses, only Admin resumes; emergency actions deliberately stay available while paused (see T9).
* **Two-step admin transfer** with cancel.
* **Safe external interaction**: no value transfer, no `delegatecall`, no `selfdestruct`, no low-level calls; downstream calls are `view` only.
* **Events for every state change** (auditable history; feeds the off-chain index).
* **Fixed pragma `0.8.24`** (checked arithmetic, no floating pragma).

## 4. Project-specific attack / misuse scenarios (with negative tests)

**Scenario S1: privilege escalation.** An attacker (a registered lender) tries: grant themselves ARBITER, register straight into VERIFIER, promote a friend to ADMIN, verify their own account. *Result:* all rejected (`Unauthorized`, `InvalidRole`, `SelfAction`). Tests: `Registry.access` "privilege-escalation attempts", lifecycle `register`/`assignRole` invalid roles. Live: `npm run demo:permissions` (attack 1).

**Scenario S2: KYC bypass and insider abuse.** (a) A verifier suspends a user, hoping reinstatement skips KYC; (b) a suspended or revoked verifier keeps approving; (c) a verifier tries to suspend the admin or the arbiter to seize control. *Result:* (a) reinstated unverified user returns to Pending; (b) rejected immediately; (c) `CannotSuspendAdmin` / `Unauthorized`. Tests: lifecycle "no KYC bypass", access "take effect immediately", lifecycle "staff colleagues". Live: demo attack 2.

## 5. Evidence

* **141 automated tests**, all passing (`npm test`). Four suites hit the Registry directly: 56 access, 39 lifecycle, 6 pause, 7 admin (108 tests); a further 9 prove downstream inheritance and 3 are the randomised invariant runs.
* **Randomised invariants** (3 seeds x 250 random actions, checked after every action, including reverted ones): I1 only defined role bits; I2 only the admin holds ADMIN; I3 unknown accounts own nothing; I4 never-verified accounts hold no privileged role; I5 Active implies verified; I6 `hasActiveRole` agrees with raw data; I7 exactly one admin always; I8 admin is Active.
* **Coverage** (`npm run coverage`): Registry.sol 100% statements/lines/functions, 98.9% branches. `BaseAccessControl` 92% statements (the unused-by-Registry `whenPaused` modifier is offered to downstream contracts).
* **Static analysis: Slither 0.11.6** on production contracts (`contracts/mocks` and `contracts/gas` excluded): 4 informational results, all false positives: `incorrect-equality` on `status == Status.Active` (an enum compare, not a balance check); three `timestamp` hits on bit-mask comparisons (the contract only *stores* `block.timestamp`, never compares it). No high/medium findings.
* **Trail of Bits workflow** (building-secure-contracts, secure-workflow-guide and guidelines-advisor): Slither run and triaged; security properties written down and tested as invariants; the access-control and event-coverage areas of the guidelines were applied to this slice (it has no upgradeability, tokens or ether). *Not run:* Echidna/Medusa fuzzing, Manticore, a manual external audit. The randomised invariant test is a lightweight substitute, not an equivalent.

## 6. Why each mitigation is needed (short)

The Registry is the **single point of authorization**: if it were wrong, the escrow's money would follow. So the checks are strict (status plus role), the dangerous roles are unreachable by self-service, the platform can be stopped without losing the ability to respond, and every important decision is recorded in events.
