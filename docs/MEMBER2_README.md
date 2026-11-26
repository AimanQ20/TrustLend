# TrustLend — Member 2 (Workflow + Events + Integration)

## What this ZIP does
This is an **overlay** for the existing `trustlend/` project from Member 1. It contains **only new Member 2 files**. No Member 1 files are included or overwritten. Unzip the *contents* directly into the existing `trustlend/` folder, not into `trustlend/Member2/`.

## What it implements
- `contracts/CoreWorkflow.sol`: loan request, approval, rejection, cancellation, and escrow-authorized funded/repaid/disputed transitions. Inherits Member 1's `RegistryAccessControl`; reads the same Registry for roles and pause state.
- `contracts/interfaces/IWorkflow.sol`: proposed interface for Member 3. **Important**: the ABI for `getLoan` returns four fields. Member 3 should verify interface agreement before coding.
- `contracts/mocks/MockWorkflowEscrow.sol`: **test-only** stand-in, NEVER use for real money; it does not transfer ETH.
- `test/CoreWorkflow.test.js`: normal flows, role failures, invalid/replayed transitions, emergency pause, mock integration.
- `scripts/deploy-workflow.js`: deploys CoreWorkflow after Member 1's Registry, adds `workflow` to existing deployment JSON, exports frontend ABI.
- `offchain/workflow-listener.js`: small Node.js HTTP server reading actual on-chain loan events at `/events` (no DB).
- `frontend/workflow.html` and `frontend/workflow.js`: wallet-connected loan UI. Visit `/workflow.html` from Member 1's existing frontend server. Original `index.html` is unchanged.

## Run on Windows (PowerShell)
Run commands **inside the existing `trustlend` directory**.

1. `npm install` (once)
2. `npx hardhat compile` (if compiler download fails: `$env:USE_SOLCJS="1"; npx hardhat compile`)
3. `npx hardhat test test/CoreWorkflow.test.js` (test before demo)
4. Terminal A: `npx hardhat node`
5. Terminal B: `npx hardhat run scripts/deploy-registry.js --network localhost` (Member 1; creates demo accounts)
6. Terminal B: `npx hardhat run scripts/deploy-workflow.js --network localhost`
7. Terminal C: `node frontend/serve.js` — open `http://127.0.0.1:5173/workflow.html`
8. Terminal D: `node offchain/workflow-listener.js` — event feed at `http://127.0.0.1:8788/events`

Import demo accounts from the **local Hardhat node's printed development-only keys** into MetaMask, connect to `http://127.0.0.1:8545`, chain ID **31337**. Do not use these demo keys on public networks. Registry deployment seeds an active BORROWER (account index 5) and active VERIFIER (index 2). Switch between them to request and approve a loan. Use `frontend/deployment.json` → `demoAccounts` to see addresses.

**Demo:** Borrower requests 1 ETH → Verifier approves loan ID 1 → view status `Approved` → refresh event history → try approving again (reverts). Reject and cancel can be demonstrated with additional loan IDs. **Funded / Repaid / Disputed require Member 3's real escrow contract.** Do not claim this ZIP transfers funds.

## Member 3 integration contract (agree before they start)
1. Deploy `CoreWorkflow(registryAddress)` first.
2. Deploy Member 3's escrow with the workflow address and registry address as required by their constructor.
3. ADMIN calls `CoreWorkflow.setEscrow(escrowAddress)` **once**. It cannot be changed later.
4. Before accepting ETH, escrow reads `getLoan(id)` and requires state `Approved`, matching deposit `amountWei`, and an active LENDER distinct from borrower.
5. **Only after securely receiving/recording funds**, escrow calls `markFunded(id, lender)`. Likewise, call `markRepaid` only after a verified repayment and `markDisputed` only under the agreed dispute rules.
6. The workflow is NOT an escrow and does NOT hold, release or verify ETH. MockWorkflowEscrow is insecure for real funds.
7. States: None=0, Requested=1, Approved=2, Rejected=3, Cancelled=4, Funded=5, Repaid=6, Disputed=7. Only escrow can trigger financial states.
8. Escrow should independently enforce its own authorization, checks-effects-interactions, reentrancy protections and pause. The `setEscrow` binding is immutable by design; an escrow upgrade requires deploying a new workflow.

## Threats and tests
- Unauthorized request/approval: `onlyActiveRole(BORROWER/VERIFIER)` using Registry.
- Skipped / replayed state transition: exact expected-state checks and negative tests.
- Unauthorized financial transition: `onlyEscrow` plus active lender validation.
- Emergency pause: Member 1's Registry pause propagates into CoreWorkflow.
- No personal data or KYC documents are stored in workflow; on-chain borrower address and amount are **public**.
- Limitations: no loan due dates, interest, dispute resolution, repayment amount or actual funds until Member 3 integrates. Off-chain event feed is read-only, local-only and rebuilds from logs on every request; no persistence.

## Gas evidence
Run `npx hardhat run scripts/gas-workflow.js`. `WorkflowBaseline` has the same Registry authorization, modifiers, checks, events and errors as `CoreWorkflow`; only the `Loan` struct is unpacked. Result: `requestLoan` 106268 to 84317 gas (-20.7%, one storage slot write fewer from packing `borrower` + `uint96 amountWei`); `approveLoan` 41655 to 41721 (+0.2%, no change, so no saving is claimed). Results are also written to `docs/gas-workflow.json`.

## Report / viva
Diagram: `Requested → Approved → Funded → Repaid`, plus `Requested → Rejected`, `Requested/Approved → Cancelled`, and `Funded → Disputed`.
Explain why blockchain: immutable loan lifecycle and shared authorization. Off-chain: event feed and Member 1's KYC references. Describe events, access roles, trust boundary between workflow and escrow, and limitations. For Member 2 demo show request, approve, invalid repeated approval, and event feed.

## Files deliberately NOT included
Member 1's Registry, access-control contracts, existing UI files, `package.json`, `hardhat.config.js`, deployment files, and node_modules. No existing files need replacement. Use existing `npm test` for all tests after extraction.
