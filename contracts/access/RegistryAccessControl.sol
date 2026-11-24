// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseAccessControl} from "./BaseAccessControl.sol";
import {IRegistry} from "../interfaces/IRegistry.sol";
import {IPausable} from "../interfaces/IPausable.sol";

/// @title RegistryAccessControl
/// @notice Drop-in base for CoreWorkflow (Member 2) and EscrowDispute (Member 3).
///         Permissions come from the one shared Registry; nothing is duplicated.
/// @dev   Two safety properties:
///        1. `paused()` is true if THIS contract is paused OR the Registry is paused (system-wide kill switch).
///        2. Role checks go through STATICCALL (view functions), so the registry cannot re-enter.
///        Usage:  contract CoreWorkflow is RegistryAccessControl { constructor(IRegistry r) RegistryAccessControl(r) {} ... }
abstract contract RegistryAccessControl is BaseAccessControl {
    /// @notice The trusted registry. Immutable: cannot be swapped by anyone after deployment.
    IRegistry public immutable registry;

    constructor(IRegistry registry_) {
        if (address(registry_) == address(0)) revert ZeroAddress();
        registry = registry_;
    }

    function _hasRole(address account, uint8 roles) internal view override returns (bool) {
        return registry.hasRole(account, roles);
    }

    function _hasActiveRole(address account, uint8 roles) internal view override returns (bool) {
        return registry.hasActiveRole(account, roles);
    }

    /// @inheritdoc BaseAccessControl
    function paused() public view virtual override returns (bool) {
        return super.paused() || IPausable(address(registry)).paused();
    }
}
