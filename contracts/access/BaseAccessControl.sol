// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IPausable} from "../interfaces/IPausable.sol";
import {Roles} from "./Roles.sol";

/// @title BaseAccessControl
/// @notice The reusable inheritance base of TrustLend: role-checking modifiers + emergency pause.
/// @dev It owns NO role storage. Concrete children decide WHERE roles live by implementing two hooks:
///        - Registry               -> reads its own packed storage
///        - RegistryAccessControl  -> asks the Registry (used by CoreWorkflow and EscrowDispute)
///      This gives one rule-set (same modifiers, same pause logic, same errors) and a single source
///      of truth for permissions.
///      Pause design: PAUSER (or ADMIN) can pause instantly; only ADMIN can unpause (fast stop, slow restart).
abstract contract BaseAccessControl is IPausable {
    // ───────────── errors / events ─────────────
    error Unauthorized(address account, uint8 requiredRoles);
    error EnforcedPause();
    error ExpectedPause();
    error ZeroAddress();

    event Paused(address indexed account);
    event Unpaused(address indexed account);

    bool private _paused;

    // ───────────── hooks (children implement) ─────────────
    /// @dev true if `account` holds ANY role in `roles`, regardless of status.
    function _hasRole(address account, uint8 roles) internal view virtual returns (bool);

    /// @dev true if `account` is Active AND holds ANY role in `roles`.
    function _hasActiveRole(address account, uint8 roles) internal view virtual returns (bool);

    // ───────────── modifiers ─────────────
    /// @dev Raw role check (ignores suspension). Use only for admin-only recovery actions.
    modifier onlyRole(uint8 roles) {
        _checkRole(roles);
        _;
    }

    /// @dev Role check that ALSO requires an Active (verified, not suspended) account. Default choice.
    modifier onlyActiveRole(uint8 roles) {
        _checkActiveRole(roles);
        _;
    }

    modifier whenNotPaused() {
        if (paused()) revert EnforcedPause();
        _;
    }

    modifier whenPaused() {
        if (!paused()) revert ExpectedPause();
        _;
    }

    // ───────────── pause controls ─────────────
    /// @notice Emergency stop. PAUSER (must be Active) or ADMIN.
    function pause() external {
        _checkActiveRole(Roles.PAUSER | Roles.ADMIN);
        if (_paused) revert EnforcedPause();
        _paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Resume operations. ADMIN only.
    function unpause() external {
        _checkRole(Roles.ADMIN);
        if (!_paused) revert ExpectedPause();
        _paused = false;
        emit Unpaused(msg.sender);
    }

    /// @inheritdoc IPausable
    function paused() public view virtual returns (bool) {
        return _paused;
    }

    // ───────────── internal checks ─────────────
    function _checkRole(uint8 roles) internal view {
        if (!_hasRole(msg.sender, roles)) revert Unauthorized(msg.sender, roles);
    }

    function _checkActiveRole(uint8 roles) internal view {
        if (!_hasActiveRole(msg.sender, roles)) revert Unauthorized(msg.sender, roles);
    }
}
