// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice TEST-ONLY, DELIBERATELY VULNERABLE. Shows the classic reentrancy drain that EscrowDispute prevents:
///         withdraw() sends the ETH BEFORE it zeroes the balance (violates checks-effects-interactions).
contract VulnerableVault {
    mapping(address => uint256) public balances;
    function deposit() external payable { balances[msg.sender] += msg.value; }
    function withdraw() external {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "nothing");
        (bool ok, ) = msg.sender.call{value: amount}(""); // interaction first (BUG)
        require(ok, "transfer failed");
        balances[msg.sender] = 0;                          // effect last (BUG)
    }
}
