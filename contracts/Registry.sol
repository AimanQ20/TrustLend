// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseAccessControl} from "./access/BaseAccessControl.sol";
import {Roles} from "./access/Roles.sol";
import {IRegistry} from "./interfaces/IRegistry.sol";

/// @title Registry
/// @notice Identity + KYC status + role registry of TrustLend (a peer-to-peer lending platform).
///         Single source of truth for "who is allowed to do what".
/// @dev  PLAIN-ENGLISH SUMMARY ("caveman" version):
///       - A wallet signs up as lender and/or borrower  -> status PENDING.
///       - A VERIFIER (credit officer) checks the person OFF-chain and approves -> status ACTIVE.
///       - Only ACTIVE wallets can do money actions in the other contracts.
///       - The ADMIN hands out staff roles, can suspend people and can unpause the system.
///       - A PAUSER can hit the emergency stop button.
///       - No personal data is stored: only a hash (kycRef) of the off-chain KYC file.
///
///       Storage: one packed slot per user (status+timestamps+roles), one slot for kycRef.
///       The contract holds NO ether and has no receive()/fallback, so ether sent to it reverts.
contract Registry is BaseAccessControl, IRegistry {
    mapping(address => Profile) private _profiles;

    /// @inheritdoc IRegistry
    address public admin;
    /// @inheritdoc IRegistry
    address public pendingAdmin;

    constructor(address admin_) {
        if (admin_ == address(0)) revert ZeroAddress();
        admin = admin_;
        uint40 t = uint40(block.timestamp);
        _profiles[admin_] = Profile({
            status: Status.Active,
            registeredAt: t,
            verifiedAt: t,
            roles: Roles.ADMIN,
            kycRef: bytes32(0)
        });
        emit RoleGranted(Roles.ADMIN, admin_, msg.sender);
        emit AdminTransferred(address(0), admin_);
    }

    // ═════════════════════════ user lifecycle ═════════════════════════

    /// @inheritdoc IRegistry
    function register(uint8 publicRoles, bytes32 kycRef) external whenNotPaused {
        if (publicRoles == 0 || (publicRoles & ~Roles.PUBLIC) != 0) revert InvalidRole(publicRoles);
        if (kycRef == bytes32(0)) revert InvalidKycRef();
        if (_profiles[msg.sender].status != Status.None) revert AlreadyRegistered(msg.sender);

        _profiles[msg.sender] = Profile({
            status: Status.Pending,
            registeredAt: uint40(block.timestamp),
            verifiedAt: 0,
            roles: publicRoles,
            kycRef: kycRef
        });

        emit UserRegistered(msg.sender, publicRoles, kycRef);
        if (publicRoles & Roles.LENDER != 0) emit RoleGranted(Roles.LENDER, msg.sender, msg.sender);
        if (publicRoles & Roles.BORROWER != 0) emit RoleGranted(Roles.BORROWER, msg.sender, msg.sender);
    }

    /// @inheritdoc IRegistry
    function verifyUser(address user) external whenNotPaused onlyActiveRole(Roles.VERIFIER) {
        if (user == msg.sender) revert SelfAction(); // nobody approves themselves
        Profile storage p = _profiles[user];
        Status s = p.status;
        if (s != Status.Pending) revert InvalidStatus(user, s);
        p.status = Status.Active;
        p.verifiedAt = uint40(block.timestamp);
        emit UserVerified(user, msg.sender);
    }

    /// @inheritdoc IRegistry
    /// @dev Intentionally NOT blocked while paused: suspending a bad actor is an emergency action.
    function suspendUser(address user) external onlyActiveRole(Roles.VERIFIER | Roles.ADMIN) {
        if (user == admin) revert CannotSuspendAdmin();
        Profile storage p = _profiles[user];
        Status s = p.status;
        if (s != Status.Pending && s != Status.Active) revert InvalidStatus(user, s);
        // Least privilege: a verifier may not suspend staff colleagues, only the admin may.
        if ((p.roles & Roles.STAFF) != 0 && !hasRole(msg.sender, Roles.ADMIN)) {
            revert Unauthorized(msg.sender, Roles.ADMIN);
        }
        p.status = Status.Suspended;
        emit UserSuspended(user, msg.sender);
    }

    /// @inheritdoc IRegistry
    function reinstateUser(address user) external whenNotPaused onlyRole(Roles.ADMIN) {
        Profile storage p = _profiles[user];
        Status s = p.status;
        if (s != Status.Suspended) revert InvalidStatus(user, s);
        // Never let a suspension skip KYC: unverified users go back to Pending.
        Status next = p.verifiedAt != 0 ? Status.Active : Status.Pending;
        p.status = next;
        emit UserReinstated(user, msg.sender, next);
    }

    // ═════════════════════════ role management ═════════════════════════

    /// @inheritdoc IRegistry
    /// @dev THE gas-measured operation (see docs/GAS_REGISTRY.md): one cold SLOAD + one SSTORE on a packed slot.
    function assignRole(address user, uint8 role) external whenNotPaused onlyRole(Roles.ADMIN) {
        if (!_isGrantableRole(role)) revert InvalidRole(role);
        if (user == address(0)) revert ZeroAddress();

        Profile storage p = _profiles[user];
        Status s = p.status;
        uint8 current = p.roles;

        if (s == Status.None) {
            // Unknown wallet: only staff roles may create a profile (staff are trusted by the admin directly).
            if ((role & Roles.STAFF) == 0) revert NotRegistered(user);
            uint40 t = uint40(block.timestamp);
            _profiles[user] = Profile({status: Status.Active, registeredAt: t, verifiedAt: t, roles: role, kycRef: bytes32(0)});
        } else {
            if (s == Status.Suspended) revert InvalidStatus(user, s);
            // Privileged roles only for verified accounts.
            if ((role & Roles.STAFF) != 0 && s != Status.Active) revert InvalidStatus(user, s);
            if ((current & role) != 0) revert RoleAlreadyAssigned(user, role);
            p.roles = current | role;
        }
        emit RoleGranted(role, user, msg.sender);
    }

    /// @inheritdoc IRegistry
    /// @dev Allowed while paused so the admin can strip a compromised key during an incident.
    function revokeRole(address user, uint8 role) external onlyRole(Roles.ADMIN) {
        if (!_isGrantableRole(role)) revert InvalidRole(role);
        _removeRole(user, role);
        emit RoleRevoked(role, user, msg.sender);
    }

    /// @inheritdoc IRegistry
    function renounceRole(uint8 role) external {
        if (!_isGrantableRole(role)) revert InvalidRole(role);
        _removeRole(msg.sender, role);
        emit RoleRevoked(role, msg.sender, msg.sender);
    }

    // ═════════════════════════ two-step admin handover ═════════════════════════

    /// @inheritdoc IRegistry
    function transferAdmin(address newAdmin) external onlyRole(Roles.ADMIN) {
        if (newAdmin == address(0)) revert ZeroAddress();
        if (newAdmin == admin) revert SelfAction();
        Status s = _profiles[newAdmin].status;
        if (s == Status.Suspended) revert InvalidStatus(newAdmin, s);
        pendingAdmin = newAdmin;
        emit AdminTransferStarted(admin, newAdmin);
    }

    /// @inheritdoc IRegistry
    function acceptAdmin() external {
        if (pendingAdmin == address(0)) revert NoPendingAdmin();
        if (msg.sender != pendingAdmin) revert NotPendingAdmin(msg.sender);

        address old = admin;
        Profile storage p = _profiles[msg.sender];
        Status s = p.status;
        if (s == Status.Suspended) revert InvalidStatus(msg.sender, s);

        // New admin: create or upgrade the profile to Active with the ADMIN bit.
        if (s == Status.None) {
            uint40 t = uint40(block.timestamp);
            _profiles[msg.sender] = Profile({status: Status.Active, registeredAt: t, verifiedAt: t, roles: Roles.ADMIN, kycRef: bytes32(0)});
        } else {
            if (s == Status.Pending) {
                p.status = Status.Active;
                p.verifiedAt = uint40(block.timestamp);
            }
            p.roles = p.roles | Roles.ADMIN;
        }
        // Old admin: drop the ADMIN bit (profile stays, they become an ordinary Active user).
        _profiles[old].roles = _profiles[old].roles & ~Roles.ADMIN;

        admin = msg.sender;
        pendingAdmin = address(0);
        emit RoleRevoked(Roles.ADMIN, old, msg.sender);
        emit RoleGranted(Roles.ADMIN, msg.sender, msg.sender);
        emit AdminTransferred(old, msg.sender);
    }

    /// @inheritdoc IRegistry
    function cancelAdminTransfer() external onlyRole(Roles.ADMIN) {
        address cancelled = pendingAdmin;
        if (cancelled == address(0)) revert NoPendingAdmin();
        pendingAdmin = address(0);
        emit AdminTransferCancelled(msg.sender, cancelled);
    }

    // ═════════════════════════ views ═════════════════════════

    /// @inheritdoc IRegistry
    function hasRole(address account, uint8 roles) public view returns (bool) {
        return (_profiles[account].roles & roles) != 0;
    }

    /// @inheritdoc IRegistry
    function hasActiveRole(address account, uint8 roles) public view returns (bool) {
        Profile storage p = _profiles[account];
        return p.status == Status.Active && (p.roles & roles) != 0;
    }

    /// @inheritdoc IRegistry
    function isActive(address account) external view returns (bool) {
        return _profiles[account].status == Status.Active;
    }

    /// @inheritdoc IRegistry
    function statusOf(address account) external view returns (Status) {
        return _profiles[account].status;
    }

    /// @inheritdoc IRegistry
    function rolesOf(address account) external view returns (uint8) {
        return _profiles[account].roles;
    }

    /// @inheritdoc IRegistry
    function getProfile(address account) external view returns (Profile memory) {
        return _profiles[account];
    }

    // ═════════════════════════ internals ═════════════════════════

    function _hasRole(address account, uint8 roles) internal view override returns (bool) {
        return hasRole(account, roles);
    }

    function _hasActiveRole(address account, uint8 roles) internal view override returns (bool) {
        return hasActiveRole(account, roles);
    }

    function _removeRole(address user, uint8 role) private {
        Profile storage p = _profiles[user];
        uint8 current = p.roles;
        if ((current & role) == 0) revert RoleNotAssigned(user, role);
        p.roles = current & ~role;
    }

    /// @dev Exactly one bit, within the defined range, and not ADMIN (admin moves only via the 2-step handover).
    function _isGrantableRole(uint8 role) private pure returns (bool) {
        return role != 0 && role != Roles.ADMIN && role <= Roles.ARBITER && (role & (role - 1)) == 0;
    }
}
