// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
/// @notice Frozen proposed interface for Member 3. Agree on any change together.
interface IWorkflow {
    // State: 0 None, 1 Requested, 2 Approved, 3 Rejected, 4 Cancelled, 5 Funded, 6 Repaid, 7 Disputed
    function getLoan(uint256 id) external view returns (address borrower, uint96 amountWei, address lender, uint8 state);
    function markFunded(uint256 id, address lender) external;
    function markRepaid(uint256 id) external;
    function markDisputed(uint256 id) external;
}
