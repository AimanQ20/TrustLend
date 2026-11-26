// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Interface of the TrustLend escrow (Member 3). Frozen with IRegistry and IWorkflow.
/// @dev Escrow status per loan. Workflow state stays the source of truth for the loan lifecycle;
///      escrow status only tracks where the ETH of that loan currently is.
///      None -> Held (lender deposited) -> Released (borrower can withdraw) -> Repaid (lender can withdraw)
///      Held -> Disputed -> Resolved (arbiter chose the recipient)
interface IEscrow {
    enum Status { None, Held, Released, Repaid, Disputed, Resolved }

    error InvalidStatus(uint256 loanId, Status actual);
    error AlreadyFunded(uint256 loanId);
    error LoanNotApproved(uint256 loanId, uint8 workflowState);
    error SelfFunding();
    error WrongAmount(uint256 expected, uint256 sent);
    error AmountTooLarge();
    error NotBorrower();
    error NotParty();
    error ConflictOfInterest();
    error NothingToWithdraw();
    error TransferFailed();
    error ReentrantCall();

    event Funded(uint256 indexed loanId, address indexed lender, uint256 amountWei);
    event Released(uint256 indexed loanId, address indexed borrower, uint256 amountWei);
    event Repaid(uint256 indexed loanId, address indexed lender, uint256 amountWei);
    event DisputeRaised(uint256 indexed loanId, address indexed by);
    event DisputeResolved(uint256 indexed loanId, address indexed arbiter, address indexed recipient, uint256 amountWei);
    event Withdrawn(address indexed account, uint256 amountWei);

    function fund(uint256 loanId) external payable;
    function releaseFunds(uint256 loanId) external;
    function repay(uint256 loanId) external payable;
    function raiseDispute(uint256 loanId) external;
    function resolveDispute(uint256 loanId, bool payLender) external;
    function withdraw() external;
    function balances(address account) external view returns (uint256);
    function depositOf(uint256 loanId) external view returns (address lender, uint256 amountWei, Status status);
}
