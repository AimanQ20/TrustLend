# Roles, actors and off-chain data map (Member 3)

## 1. Roles and actors

| Actor | On-chain role (Registry bit) | What they can do | What they can NOT do |
|---|---|---|---|
| Admin | ADMIN (1) | Grants staff roles, unpauses, binds the escrow once (`setEscrow`) | Cannot be granted through `assignRole`; cannot move escrow money |
| Pauser | PAUSER (2) | Emergency pause of Registry (system wide) or of one contract | Cannot unpause |
| Verifier | VERIFIER (4) | Verifies users (KYC), approves or rejects loans | Cannot approve its own loan, cannot touch escrow money |
| Lender | LENDER (8) | Deposits the exact approved amount (`fund`), raises a dispute on its own deposit, withdraws credits | Cannot fund its own loan |
| Borrower | BORROWER (16) | Requests loans, releases funds, repays, raises a dispute, withdraws credits | Cannot release another borrower's loan |
| Arbiter | ARBITER (32) | Resolves disputes (refund lender or pay borrower) | Cannot resolve a dispute it is a party to |
| Outsider | none | Read public data | Everything else reverts with `Unauthorized` |

## 2. What lives on-chain and what stays off-chain

| Data | Where | Why |
|---|---|---|
| Roles, status (Pending/Active/Suspended) | On-chain (Registry) | Every money action depends on it; must be tamper-proof and checked in the same transaction |
| Loan lifecycle state, borrower, amount, lender | On-chain (CoreWorkflow) | Shared, auditable state machine |
| ETH held for a loan, who is owed what | On-chain (EscrowDispute) | The money itself; nobody (not even the admin) can take it |
| Hash of the KYC record | On-chain (Registry) | Proves a record existed and was not changed, without revealing it |
| **KYC documents, name, address, ID scans** | **Off-chain only** (verifier's private storage) | Personal data. Putting it on a public chain cannot be undone and breaks privacy law (GDPR style right to erasure) |
| Dispute evidence (messages, screenshots, contracts) | Off-chain (arbiter's case file; optional IPFS) | Large and private. Only the arbiter's decision (`DisputeResolved`) is on-chain |
| Event history and search ("all loans of X") | Off-chain index rebuilt from logs (`offchain/workflow-listener.js`, role service) and read directly from chain by `escrow.html` | Contracts must not loop over history; logs are cheaper |
| UI state, wallet connection | Browser | Convenience only, never authoritative |

Rule used everywhere: **the chain is the source of truth, off-chain pieces are caches or private records.** A UI or service never grants a permission; the contract re-checks.

## 3. Integrity handling (how an off-chain record is tied to the chain)

* KYC record: `keccak256(record + random salt)` is stored in the Registry. To audit, the verifier shows the record and salt; anyone recomputes the hash and compares it with `getProfile(user).kycHash`. A changed record gives a different hash.
* Dispute evidence: the arbiter can publish `keccak256(case file)` off-chain together with the decision. Not enforced by the contract (limitation, see report); the decision itself is immutable on-chain.

## 4. Failure handling

| Failure | What happens | Why it is safe |
|---|---|---|
| Event indexer / role service is down | `escrow.html` reads escrow events straight from the chain (`queryFilter`); the role service is only used for convenience lookups | No on-chain function or permission depends on it |
| Indexer shows stale or wrong data | UI actions run `staticCall` first and show the contract's real error; the contract re-validates everything | A lying service can only cause a failed transaction, never an unauthorized one |
| RPC node unreachable or wrong chain | UI shows "Wrong chain: expected 31337" or the RPC error and sends nothing | Pre-flight checks before any transaction |
| Wallet rejects or transaction reverts | Decoded custom error shown (`WrongAmount(1, 2)`, `Unauthorized`, `EnforcedPause`) and no state changes | Reverts are atomic; ETH sent with a failed call is returned |
| Lender's receiving contract refuses ETH | Only that user's `withdraw()` reverts with `TransferFailed`; credit stays; other users unaffected | Pull payments instead of pushing ETH |
| Off-chain KYC file lost | The hash proves a record existed but cannot recreate it; the verifier must re-collect and a new hash is written | Documented operational risk; money safety does not depend on the file |
| Emergency (key compromise) | Pauser freezes money functions; admin suspends the account and unpauses | Pause design from Member 1 |
