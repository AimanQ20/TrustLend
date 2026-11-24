// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
/// @notice Illustrative baseline, not equivalent security to CoreWorkflow.
contract WorkflowBaseline {
 enum State { None, Requested, Approved }
 struct Loan { address borrower; uint256 amountWei; address lender; State state; }
 mapping(uint256 => Loan) public loans;
 uint256 public nextLoanId = 1;
 function requestLoan(uint256 amountWei) external returns (uint256 id) {
  require(amountWei > 0, "zero"); id = nextLoanId++;
  loans[id] = Loan(msg.sender, amountWei, address(0), State.Requested);
 }
 function approveLoan(uint256 id) external {
  require(loans[id].state == State.Requested, "state"); loans[id].state = State.Approved;
 }
}
