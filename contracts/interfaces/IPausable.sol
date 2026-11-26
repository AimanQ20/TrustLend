// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Minimal pause-state view shared by the registry and every contract that follows it.
interface IPausable {
    function paused() external view returns (bool);
}
