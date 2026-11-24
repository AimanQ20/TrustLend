// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IRegistry  (FROZEN INTERFACE - Member 1)
/// @notice Identity, KYC status and role registry for TrustLend.
///         CoreWorkflow (Member 2) and EscrowDispute (Member 3) read from it; they never write to it.
/// @dev Roles are single-bit uint8 flags, see `Roles.sol`. Any `roles` argument that is a MASK
///      means "any of these roles". Changing anything in this file needs all 3 members to agree.
interface IRegistry {
    // ───────────────────────────── types ─────────────────────────────
    /// @dev None -> Pending (self-registered) -> Active (verified). Active/Pending <-> Suspended.
    enum Status {
        None,
        Pending,
        Active,
        Suspended
    }

    /// @dev Slot 0 packs status(1) + registeredAt(5) + verifiedAt(5) + roles(1) bytes. Slot 1 = kycRef.
    struct Profile {
        Status status;
        uint40 registeredAt;
        uint40 verifiedAt; // 0 means "never verified"
        uint8 roles; // bitmask of Roles.*
        bytes32 kycRef; // keccak256 of the OFF-CHAIN KYC record. No personal data on-chain.
    }

    // ───────────────────────────── events ─────────────────────────────
    event UserRegistered(address indexed user, uint8 roles, bytes32 kycRef);
    event UserVerified(address indexed user, address indexed verifier);
    event UserSuspended(address indexed user, address indexed by);
    event UserReinstated(address indexed user, address indexed by, Status newStatus);
    event RoleGranted(uint8 indexed role, address indexed account, address indexed sender);
    event RoleRevoked(uint8 indexed role, address indexed account, address indexed sender);
    event AdminTransferStarted(address indexed currentAdmin, address indexed pendingAdmin);
    event AdminTransferCancelled(address indexed currentAdmin, address indexed cancelledPendingAdmin);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    // ───────────────────────────── errors ─────────────────────────────
    error AlreadyRegistered(address user);
    error NotRegistered(address user);
    error InvalidRole(uint8 role);
    error InvalidKycRef();
    error InvalidStatus(address user, Status current);
    error RoleAlreadyAssigned(address user, uint8 role);
    error RoleNotAssigned(address user, uint8 role);
    error SelfAction();
    error CannotSuspendAdmin();
    error NotPendingAdmin(address caller);
    error NoPendingAdmin();

    // ─────────────────────── state-changing functions ───────────────────────
    /// @notice Register msg.sender as LENDER and/or BORROWER. Status starts as Pending.
    function register(uint8 publicRoles, bytes32 kycRef) external;

    /// @notice VERIFIER approves a Pending user -> Active.
    function verifyUser(address user) external;

    /// @notice VERIFIER or ADMIN suspends a Pending/Active user. Only ADMIN may suspend staff.
    function suspendUser(address user) external;

    /// @notice ADMIN lifts a suspension (back to Active if previously verified, else Pending).
    function reinstateUser(address user) external;

    /// @notice ADMIN grants ONE role. Staff roles may create a fresh Active profile.
    function assignRole(address user, uint8 role) external;

    /// @notice ADMIN removes ONE non-admin role. Also works while paused (emergency response).
    function revokeRole(address user, uint8 role) external;

    /// @notice Caller gives up one of their own non-admin roles.
    function renounceRole(uint8 role) external;

    function transferAdmin(address newAdmin) external;
    function acceptAdmin() external;
    function cancelAdminTransfer() external;

    // ─────────────────────────── read functions ───────────────────────────
    /// @notice true if `account` holds ANY role in `roles` (ignores status - use hasActiveRole for gating).
    function hasRole(address account, uint8 roles) external view returns (bool);

    /// @notice true if `account` is Active AND holds any role in `roles`. THIS is what other contracts should use.
    function hasActiveRole(address account, uint8 roles) external view returns (bool);

    function isActive(address account) external view returns (bool);
    function statusOf(address account) external view returns (Status);
    function rolesOf(address account) external view returns (uint8);
    function getProfile(address account) external view returns (Profile memory);
    function admin() external view returns (address);
    function pendingAdmin() external view returns (address);
}
