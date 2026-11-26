# Report section: Known limitations (Member 1)

1. **Admin is a trusted, centralized key.** The admin can grant staff roles, suspend ordinary users, and keep the platform paused. Mitigations: two-step handover, admin cannot be suspended by others, all actions emit events. Recommended for production: a multisig plus timelock as admin (not implemented; out of course scope).
2. **Lost admin key = no admin.** There is no recovery path by design (it would be a backdoor). A multisig is the practical answer.
3. **KYC happens off-chain and is trusted.** The chain proves *who approved which hash*, not that the document is genuine. A colluding verifier can approve a fake identity. Sybil resistance is only as strong as verifier diligence.
4. **Hash privacy is probabilistic.** `kycRef` is a salted hash; if a user loses or leaks the salt, or reuses a weak salt, the record could be guessed. The UI generates a random 16-byte salt per registration. Addresses and statuses themselves are public by nature of the chain.
5. **Role model is fixed.** Six roles in a `uint8` (two spare bits). Adding a role needs a contract change. The role ABI is not OpenZeppelin-compatible (`hasRole(address,uint8)`).
6. **Not upgradeable.** A bug needs a redeploy and re-pointing of the other contracts (their `registry` is immutable on purpose).
7. **One role set per wallet, no delegation or expiry.** Roles do not expire; a verifier stays a verifier until revoked.
8. **Off-chain service is a convenience, not a guarantee.** It can lag (it rescans the last 12 blocks each time and re-verifies on-chain), has an in-memory index (restarts re-scan from `START_BLOCK`), a simple per-IP rate limit, and no authentication because it is read-only on public data. Public RPC providers may limit log ranges (it queries in chunks).
9. **Frontend relies on an injected wallet** (EIP-1193, e.g. MetaMask). Role-based hiding of buttons is cosmetic; real enforcement is in the contract. Tested with a wallet mock against a real chain, not with every real wallet.
10. **Gas numbers are from the in-process Hardhat network** with the default optimizer (200 runs); real networks vary slightly (calldata/base costs unchanged, but pricing differs). The baseline is a deliberately naive-but-realistic first draft, not the worst possible design.
11. **Not audited.** Verified by tests, coverage, invariants and Slither only. No formal verification, no Echidna/Medusa fuzzing, no third-party audit.
12. **Compiler fallback.** If the native compiler cannot be downloaded, the optional `USE_SOLCJS=1` mode uses solc-js 0.8.24 (same language version, slower).
13. **Regulatory reality.** A real lending platform needs licensing and real KYC/AML processes; this project demonstrates the technical access layer only.
