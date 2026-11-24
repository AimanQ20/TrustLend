# Demo script: role and permission flow (Member 1, about 6 minutes)

**Setup (before the demo):** `npm run node`, `npm run deploy:local`, `npm run service`, `npm run frontend`. MetaMask on the local network (chain 31337) with accounts 0, 1, 2, 4, 7 imported from the node's output. Open `http://127.0.0.1:5173`.

| Step | Do | Say / point out |
|---|---|---|
| 1. Not connected | Show the page | "Nothing is visible until a wallet connects; no role panels." |
| 2. Stranger registers (account 7) | Connect. Status **None**. Tick Borrower, type a KYC reference, show the hash and salt, press Register, confirm in MetaMask | "Only a salted hash goes on-chain, personal data stays with me. The status log shows submitted, then confirmed with block and gas." Status becomes **Pending**; Registration form disappears |
| 3. Verifier approves (account 2) | Switch account (page reloads). Verifier desk appears with the pending queue; press **Verify** | "This list comes from the off-chain service, but the contract re-checks. Verifier cannot approve themselves." |
| 4. Back to account 7 | Status **Active**; borrower workspace slot appears | "Roles only work once Active. Suspension would switch this off instantly, in every contract." |
| 5. Admin (account 0) | Admin console: assign **ARBITER** to account 7's friend (e.g. account 8) -> confirmed. Try assigning **LENDER** to an unregistered wallet -> readable error "not registered yet" | "Errors are decoded from the contract, not raw hex. The staff directory refreshes from the service." |
| 6. Emergency (account 1 pauser) | Press **Pause system** -> red banner | "Pauser can stop, cannot resume." |
| 7. While paused | As account 7 (or a new account) try to register -> "paused by the emergency switch" | "Money-moving actions are blocked, but suspend/revoke still work so we can respond." |
| 8. Resume (account 0 admin) | **Resume system** | "Only the admin resumes: fast stop, deliberate restart." |
| 9. Permission wall | Terminal: `npm run demo:permissions` | "10 attacks, all blocked with named errors: self-promotion, second admin, self-approval, suspending the admin, pauser resuming." |
| 10. Service down (optional) | Stop `npm run service`, refresh | "Banner appears; on-chain actions still work. The contract is the authority." |

**Safety net:** if MetaMask misbehaves, run the same flow through `npm test` output (`Registry.access`, `ui.test.js`) and `npm run demo:permissions`.
