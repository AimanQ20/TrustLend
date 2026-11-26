// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice TEST-ONLY attacker. Acts as a normal account through exec(), and when it receives ETH it tries to
///         call withdraw() on `target` again (reentrancy). It records whether the re-entry worked or was blocked.
contract ReentrancyAttacker {
    address public immutable owner;
    address public immutable target;
    uint256 public reentries;       // number of successful re-entries
    uint256 public blockedReentries; // number of re-entries that reverted
    bytes public lastRevert;

    constructor(address target_) { owner = msg.sender; target = target_; }

    /// @dev lets the attacker contract call anything (register in the Registry, fund(), deposit(), ...).
    function exec(address to, bytes calldata data) external payable returns (bytes memory) {
        require(msg.sender == owner, "owner only");
        (bool ok, bytes memory ret) = to.call{value: msg.value}(data);
        if (!ok) { assembly { revert(add(ret, 32), mload(ret)) } }
        return ret;
    }

    function attack() external {
        require(msg.sender == owner, "owner only");
        (bool ok, bytes memory ret) = target.call(abi.encodeWithSignature("withdraw()"));
        if (!ok) { assembly { revert(add(ret, 32), mload(ret)) } }
    }

    receive() external payable {
        if (reentries + blockedReentries >= 10) return;
        (bool ok, bytes memory ret) = target.call(abi.encodeWithSignature("withdraw()"));
        if (ok) { reentries++; } else { blockedReentries++; lastRevert = ret; }
    }
}
