// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {RegistryAccessControl} from "../access/RegistryAccessControl.sol";
import {IRegistry} from "../interfaces/IRegistry.sol";
import {Roles} from "../access/Roles.sol";

/// @notice Gas baseline for CoreWorkflow. Same Registry authorization, same modifiers, same
///         checks, same events and same custom errors as CoreWorkflow for requestLoan and
///         approveLoan. The ONLY difference is storage layout: amount is a full uint256, so
///         the Loan struct is not packed (borrower and amount occupy separate slots).
contract WorkflowBaseline is RegistryAccessControl {
    enum State { None, Requested, Approved, Rejected, Cancelled, Funded, Repaid, Disputed }
    struct Loan {
        address borrower;
        uint256 amountWei;
        address lender;
        State state;
    }
    uint256 public nextLoanId = 1;
    mapping(uint256 => Loan) private loans;
    error InvalidAmount();
    error InvalidLoan(uint256 loanId);
    error InvalidState(uint256 loanId, State actual);
    error NotBorrower();
    event LoanRequested(uint256 indexed loanId, address indexed borrower, uint256 amountWei);
    event LoanApproved(uint256 indexed loanId, address indexed verifier);

    constructor(IRegistry r) RegistryAccessControl(r) {}
    function _expect(uint256 id, State expected) internal view returns (Loan storage l) {
        l = loans[id];
        if (l.borrower == address(0)) revert InvalidLoan(id);
        if (l.state != expected) revert InvalidState(id, l.state);
    }
    function requestLoan(uint256 amountWei) external whenNotPaused onlyActiveRole(Roles.BORROWER) returns (uint256 id) {
        if (amountWei == 0) revert InvalidAmount();
        id = nextLoanId++;
        loans[id] = Loan(msg.sender, amountWei, address(0), State.Requested);
        emit LoanRequested(id, msg.sender, amountWei);
    }
    function approveLoan(uint256 id) external whenNotPaused onlyActiveRole(Roles.VERIFIER) {
        Loan storage l = _expect(id, State.Requested);
        if (l.borrower == msg.sender) revert NotBorrower();
        l.state = State.Approved;
        emit LoanApproved(id, msg.sender);
    }
}
