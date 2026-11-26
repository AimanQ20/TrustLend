// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {RegistryAccessControl} from "../access/RegistryAccessControl.sol";
import {IRegistry} from "../interfaces/IRegistry.sol";
import {Roles} from "../access/Roles.sol";

/// @title MockGuarded - TEST ONLY
/// @notice Stand-in for CoreWorkflow / EscrowDispute. Proves a downstream contract can inherit
///         RegistryAccessControl and gate functions through the shared registry. Members 2 and 3
///         copy this pattern (see docs/INTEGRATION_GUIDE.md).
contract MockGuarded is RegistryAccessControl {
    uint256 public counter;

    constructor(IRegistry registry_) RegistryAccessControl(registry_) {}

    /// @dev Any Active borrower (like "request a loan").
    function borrowerAction() external whenNotPaused onlyActiveRole(Roles.BORROWER) {
        counter += 1;
    }

    /// @dev Any Active lender (like "fund a loan").
    function lenderAction() external whenNotPaused onlyActiveRole(Roles.LENDER) {
        counter += 1;
    }

    /// @dev Verifier OR arbiter.
    function staffAction() external whenNotPaused onlyActiveRole(Roles.VERIFIER | Roles.ARBITER) {
        counter += 1;
    }
}
