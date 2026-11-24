// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {RegistryAccessControl} from "./access/RegistryAccessControl.sol";
import {IRegistry} from "./interfaces/IRegistry.sol";
import {Roles} from "./access/Roles.sol";

/// @notice Loan lifecycle only. No ETH is stored here; escrow is Member 3's responsibility.
contract CoreWorkflow is RegistryAccessControl {
    enum State { None, Requested, Approved, Rejected, Cancelled, Funded, Repaid, Disputed }
    struct Loan {
        address borrower;        // 20 bytes
        uint96 amountWei;        // 12 bytes; shares one storage slot with borrower
        address lender;
        State state;
    }
    uint256 public nextLoanId = 1;
    mapping(uint256 => Loan) private loans;
    address public escrow;
    error InvalidAmount();
    error InvalidLoan(uint256 loanId);
    error InvalidState(uint256 loanId, State actual);
    error NotBorrower();
    error EscrowOnly();
    error EscrowAlreadySet();
    error InvalidLender();
    event LoanRequested(uint256 indexed loanId, address indexed borrower, uint256 amountWei);
    event LoanApproved(uint256 indexed loanId, address indexed verifier);
    event LoanRejected(uint256 indexed loanId, address indexed verifier);
    event LoanCancelled(uint256 indexed loanId);
    event LoanFunded(uint256 indexed loanId, address indexed lender);
    event LoanRepaid(uint256 indexed loanId);
    event LoanDisputed(uint256 indexed loanId);
    event EscrowConfigured(address indexed escrow);

    constructor(IRegistry r) RegistryAccessControl(r) {}
    function getLoan(uint256 id) external view returns (Loan memory) { return _loan(id); }
    function _loan(uint256 id) internal view returns (Loan storage l) {
        l = loans[id];
        if (l.borrower == address(0)) revert InvalidLoan(id);
    }
    function _expect(uint256 id, State expected) internal view returns (Loan storage l) {
        l = _loan(id);
        if (l.state != expected) revert InvalidState(id, l.state);
    }
    function setEscrow(address escrow_) external onlyRole(Roles.ADMIN) {
        if (escrow != address(0)) revert EscrowAlreadySet();
        if (escrow_ == address(0) || escrow_.code.length == 0) revert ZeroAddress();
        escrow = escrow_;
        emit EscrowConfigured(escrow_);
    }
    modifier onlyEscrow() { if (msg.sender != escrow) revert EscrowOnly(); _; }
    function requestLoan(uint96 amountWei) external whenNotPaused onlyActiveRole(Roles.BORROWER) returns (uint256 id) {
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
    function rejectLoan(uint256 id) external whenNotPaused onlyActiveRole(Roles.VERIFIER) {
        Loan storage l = _expect(id, State.Requested);
        l.state = State.Rejected;
        emit LoanRejected(id, msg.sender);
    }
    function cancelLoan(uint256 id) external whenNotPaused {
        Loan storage l = _loan(id);
        if (l.borrower != msg.sender) revert NotBorrower();
        if (l.state != State.Requested && l.state != State.Approved) revert InvalidState(id, l.state);
        l.state = State.Cancelled;
        emit LoanCancelled(id);
    }
    // Only escrow may advance financial states. Escrow MUST verify actual ETH movements.
    function markFunded(uint256 id, address lender) external whenNotPaused onlyEscrow {
        Loan storage l = _expect(id, State.Approved);
        if (lender == address(0) || lender == l.borrower || !registry.hasActiveRole(lender, Roles.LENDER)) revert InvalidLender();
        l.lender = lender;
        l.state = State.Funded;
        emit LoanFunded(id, lender);
    }
    function markRepaid(uint256 id) external whenNotPaused onlyEscrow {
        Loan storage l = _expect(id, State.Funded);
        l.state = State.Repaid;
        emit LoanRepaid(id);
    }
    function markDisputed(uint256 id) external whenNotPaused onlyEscrow {
        Loan storage l = _expect(id, State.Funded);
        l.state = State.Disputed;
        emit LoanDisputed(id);
    }
}
