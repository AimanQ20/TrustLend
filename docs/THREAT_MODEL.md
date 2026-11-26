# Combined threat model and mitigation mapping (compiled by Member 3)

Inputs: Member 1 `docs/REPORT_SECURITY.md` (T1 to T15, scenarios S1 and S2), Member 2 `docs/MEMBER2_README.md` (workflow threats), Member 3 escrow analysis (E1 to E14).

## 1. Assets, actors, trust boundaries

**Assets:** (A1) the ETH held in escrow, (A2) integrity of roles and permissions, (A3) integrity of the loan lifecycle, (A4) availability, (A5) KYC privacy, (A6) the admin key.

**Actors:** honest lender / borrower, malicious lender or borrower, malicious or compromised verifier, arbiter (trusted but possibly corrupt), pauser, admin, malicious contract acting as a user, off-chain service operator, network observer.

**Trust boundaries**
1. Wallet to contracts: everything is checked on-chain.
2. EscrowDispute to CoreWorkflow: escrow is the only caller allowed to advance financial states (`onlyEscrow`), and CoreWorkflow re-validates state and lender. The escrow trusts CoreWorkflow for loan data (immutable address).
3. EscrowDispute and CoreWorkflow to Registry: read-only `view` calls (STATICCALL), immutable address.
4. Escrow to user wallets: the only place ETH leaves the system is `withdraw()`, which hands control to an unknown address. This is the reentrancy boundary.
5. UI / off-chain services to chain: convenience only.
6. Off-chain KYC records: only a hash crosses.

## 2. Threats, mitigations and evidence

| ID | Owner | Threat | Impact | Mitigation | Test / evidence |
|---|---|---|---|---|---|
| T1 to T15 | M1 | Access control, privilege escalation, KYC bypass, pause abuse, privacy (see REPORT_SECURITY.md) | Platform takeover | Role bit flags, status gating, two step admin, pause design, hash only KYC | 141 tests, invariants, Slither (see Member 1 report) |
| S1 | M1 | Privilege escalation by a registered lender | Platform takeover | `InvalidRole`, `Unauthorized`, `SelfAction` | `Registry.access`, `npm run demo:permissions` |
| S2 | M1 | KYC bypass and insider abuse | Unverified users move money | Reinstate returns to Pending, immediate revocation | lifecycle tests |
| W1 | M2 | Skipped state: fund an unapproved loan, repay an unfunded loan | Money moves for an invalid loan | Exact expected-state check in every transition (`InvalidState`) | `CoreWorkflow.test.js` "skipped funding" |
| W2 | M2 | Replayed approval | Double processing | Approve only from `Requested` | "replayed approval" |
| W3 | M2 | Anyone calls `markFunded` / `markRepaid` directly | Fake funded loan without ETH | `onlyEscrow` plus `setEscrow` one time, admin only | "direct financial changes", "configured once" |
| W4 | M2 | Fake lender or self lending | Wash lending | `markFunded` requires active LENDER and lender != borrower | workflow tests |
| E1 | M3 | **Reentrancy in `withdraw()`: a contract wallet re-enters while being paid and drains other users' escrowed ETH** | Loss of A1 | Checks-effects-interactions (balance zeroed and event emitted BEFORE the ETH call) AND `nonReentrant` guard on every state changing function | `EscrowAttack.test.js` (vulnerable vault is drained, escrow is not); `npm run demo:attack` |
| E2 | M3 | Escrow drain through forged financial state (calling escrow functions on loans in the wrong state) | Loss of A1 | Per-loan `Status` machine: `None -> Held -> Released -> Repaid`, `Held -> Disputed -> Resolved`; every function checks the exact expected status (`InvalidStatus`) | "skipped transition", "release twice", "cannot repay twice" |
| E3 | M3 | Wrong or partial deposit (underpay, overpay) | Mismatch between loan amount and held ETH | `msg.value` must equal the approved amount exactly (`WrongAmount`), amount read from workflow not from the caller | "rejects wrong amounts" |
| E4 | M3 | Double funding or replay of `fund` | Two deposits, one loan | `AlreadyFunded`, plus workflow state must be `Approved` | "double funding" |
| E5 | M3 | Borrower funds own loan with a second wallet role | Fake volume | `SelfFunding` (and workflow `InvalidLender`) | "borrower funding their own loan" |
| E6 | M3 | Outsider raises a dispute to freeze someone's deposit | Griefing | `NotParty`: only the deposit's lender or the loan's borrower, both Active | "outsiders cannot raise" |
| E7 | M3 | Arbiter is also a party | Self dealing | `ConflictOfInterest` | "arbiter who is also a party" |
| E8 | M3 | Release or resolve by the wrong person | Theft | `onlyActiveRole` plus `NotBorrower`; only an Active ARBITER resolves | access tests in `EscrowDispute.test.js` |
| E9 | M3 | Forced ETH (selfdestruct) to break accounting | Insolvency or stuck funds | Accounting is internal (`balances`, `Deposit.amount`), never `address(this).balance`; no `receive`/`fallback` | "forced ETH", "plain ETH transfers revert" |
| E10 | M3 | A receiver that refuses ETH blocks payouts | Denial of service | Pull payments: only that user's own `withdraw()` fails | design; `TransferFailed` |
| E11 | M3 | Compromised or suspended account keeps acting | Insider abuse | `onlyActiveRole` asks the Registry every call; suspended arbiter or lender is refused immediately. A suspended user can still withdraw money already credited to them | "suspended arbiter", "suspended user can still withdraw" |
| E12 | M3 | Emergency while funds are in escrow | Loss during an incident | `whenNotPaused` on every money function (also when only the Registry is paused) | pause tests |
| E13 | M3 | Integer truncation or overflow (`uint88` packing) | Wrong accounting | Solidity 0.8 checked math; `AmountTooLarge` if the amount does not fit | `fund` boundary tests |
| E14 | M3 | Front-running: another lender funds the same loan first | Lost gas for the loser | The second `fund` reverts with `AlreadyFunded` and its ETH is returned; no loss of funds | "double funding" |
| O1 | all | Off-chain service lies or is stale | Wrong UI | Contract is the authority; UI does `staticCall` first | service tests, `OFFCHAIN_DATA_MAP.md` |

## 3. Residual risks and limitations (stated honestly)

* The **arbiter is a trusted role**. A corrupt arbiter can pay the wrong party. Mitigation here is only conflict of interest and the audit trail; a real system would use multiple arbiters or a quorum.
* The **admin key** can assign staff roles and unpause. Two step handover exists, but there is no multisig or timelock.
* Only **principal repayment**: no interest, due dates or default handling. A borrower who releases funds and never repays has no on-chain penalty.
* Disputes are possible **only while the deposit is still held** in escrow (before the borrower releases). After release, a default must be handled off-chain.
* A borrower who never releases leaves ETH Held; the lender can then raise a dispute and the arbiter decides. There is no automatic timeout.
* The pause also blocks `withdraw()` (deliberate: a pause freezes everything). Users wait for the admin to unpause.
* Workflow state stays `Disputed` after resolution (the frozen `IWorkflow` has no "resolved" transition). Escrow status `Resolved` is the final record.
* Static analysis: not yet run on `EscrowDispute`. Run Slither with `slither . --exclude-dependencies --filter-paths "contracts/mocks|contracts/gas"` and add the triage here. No fuzzing (Echidna/Medusa) was done; the randomized-style accounting test is a lightweight substitute.
