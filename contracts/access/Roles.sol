// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Roles
/// @notice Role identifiers for the whole TrustLend system, encoded as ONE BIT each in a uint8.
/// @dev Why bit flags instead of bytes32 hashes (the OpenZeppelin style)?
///      A user's entire role set then fits in ONE byte that is packed into the same storage slot
///      as the user's status, so a permission check costs a single SLOAD. Trade-off: at most 8
///      roles (6 used, 2 spare) and the ABI differs from OpenZeppelin's `hasRole(bytes32,address)`.
///      See docs/GAS_REGISTRY.md for the measured effect.
library Roles {
    uint8 internal constant ADMIN = 1; // 0b000001 - governs the registry, grants staff roles, unpauses
    uint8 internal constant PAUSER = 2; // 0b000010 - may trigger the emergency pause
    uint8 internal constant VERIFIER = 4; // 0b000100 - KYC / credit officer, approves users and loans
    uint8 internal constant LENDER = 8; // 0b001000 - public role, supplies funds
    uint8 internal constant BORROWER = 16; // 0b010000 - public role, requests and repays loans
    uint8 internal constant ARBITER = 32; // 0b100000 - resolves disputes / defaults

    /// @dev All roles that exist. Anything above this is invalid.
    uint8 internal constant ALL = 63;
    /// @dev Roles a wallet may pick for itself at registration (still needs KYC verification).
    uint8 internal constant PUBLIC = 24; // LENDER | BORROWER
    /// @dev Privileged roles that only the admin may hand out.
    uint8 internal constant STAFF = 38; // PAUSER | VERIFIER | ARBITER
}
