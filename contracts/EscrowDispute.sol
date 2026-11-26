// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {RegistryAccessControl} from "./access/RegistryAccessControl.sol";
import {IRegistry} from "./interfaces/IRegistry.sol";
import {IWorkflow} from "./interfaces/IWorkflow.sol";
import {IEscrow} from "./interfaces/IEscrow.sol";
import {Roles} from "./access/Roles.sol";

/// @title EscrowDispute (Member 3)
/// @notice Holds the ETH of TrustLend loans. Inherits RegistryAccessControl -> BaseAccessControl, so roles,
///         suspension and the emergency pause come from the shared Registry.
/// @dev Money flow (pull payments, no ETH is ever pushed except in withdraw):
///        fund()          lender deposits exactly the approved amount; workflow Approved -> Funded
///        releaseFunds()  borrower accepts; the amount is credited to the borrower's balance
///        repay()         borrower pays back the same amount; credited to the lender's balance
///        raiseDispute()  lender or borrower freezes a Held deposit; workflow Funded -> Disputed
///        resolveDispute()arbiter (not a party) credits the lender (refund) or the borrower (release)
///        withdraw()      anyone with a credit pulls it out
///      Security: checks-effects-interactions everywhere, a reentrancy guard on every function that moves
///      value or calls another contract, balances zeroed BEFORE the ETH is sent, exact-amount deposits.
///      Accounting is internal (never address(this).balance), so forced ETH cannot break it.
contract EscrowDispute is RegistryAccessControl, IEscrow {
    /// @dev ONE storage slot: 20 + 11 + 1 = 32 bytes. uint88 holds up to about 309 million ETH.
    struct Deposit {
        address lender;
        uint88 amount;
        Status status;
    }

    IWorkflow public immutable workflow;
    mapping(uint256 => Deposit) private _deposits;
    mapping(address => uint256) public balances;
    uint256 private _lock = 1; // 1 = open, 2 = entered

    modifier nonReentrant() {
        if (_lock != 1) revert ReentrantCall();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(IRegistry registry_, IWorkflow workflow_) RegistryAccessControl(registry_) {
        if (address(workflow_) == address(0)) revert ZeroAddress();
        workflow = workflow_;
    }

    // ───────────── lender: deposit ─────────────
    function fund(uint256 loanId) external payable whenNotPaused nonReentrant onlyActiveRole(Roles.LENDER) {
        (address borrower, uint96 amountWei, , uint8 state) = workflow.getLoan(loanId);
        // checks
        if (_deposits[loanId].status != Status.None) revert AlreadyFunded(loanId);
        if (state != 2) revert LoanNotApproved(loanId, state); // 2 = Approved
        if (msg.sender == borrower) revert SelfFunding();
        if (msg.value != amountWei) revert WrongAmount(amountWei, msg.value);
        if (amountWei > type(uint88).max) revert AmountTooLarge();
        // effects
        _deposits[loanId] = Deposit(msg.sender, uint88(amountWei), Status.Held);
        emit Funded(loanId, msg.sender, amountWei);
        // interaction (trusted workflow; it re-checks state and that the lender is an active LENDER)
        workflow.markFunded(loanId, msg.sender);
    }

    // ───────────── borrower: accept funds ─────────────
    function releaseFunds(uint256 loanId) external whenNotPaused nonReentrant onlyActiveRole(Roles.BORROWER) {
        Deposit storage d = _deposits[loanId];
        if (d.status != Status.Held) revert InvalidStatus(loanId, d.status);
        (address borrower, , , ) = workflow.getLoan(loanId);
        if (msg.sender != borrower) revert NotBorrower();
        uint256 amount = d.amount;
        d.status = Status.Released;
        balances[borrower] += amount;
        emit Released(loanId, borrower, amount);
    }

    // ───────────── borrower: repay (principal only; interest is a documented limitation) ─────────────
    function repay(uint256 loanId) external payable whenNotPaused nonReentrant onlyActiveRole(Roles.BORROWER) {
        Deposit storage d = _deposits[loanId];
        if (d.status != Status.Released) revert InvalidStatus(loanId, d.status);
        (address borrower, , , ) = workflow.getLoan(loanId);
        if (msg.sender != borrower) revert NotBorrower();
        uint256 amount = d.amount;
        if (msg.value != amount) revert WrongAmount(amount, msg.value);
        address lender = d.lender;
        d.status = Status.Repaid;
        balances[lender] += amount;
        emit Repaid(loanId, lender, amount);
        workflow.markRepaid(loanId);
    }

    // ───────────── dispute ─────────────
    function raiseDispute(uint256 loanId) external whenNotPaused nonReentrant {
        Deposit storage d = _deposits[loanId];
        if (d.status != Status.Held) revert InvalidStatus(loanId, d.status);
        (address borrower, , , ) = workflow.getLoan(loanId);
        bool isLender = msg.sender == d.lender && registry.hasActiveRole(msg.sender, Roles.LENDER);
        bool isBorrower = msg.sender == borrower && registry.hasActiveRole(msg.sender, Roles.BORROWER);
        if (!isLender && !isBorrower) revert NotParty();
        d.status = Status.Disputed;
        emit DisputeRaised(loanId, msg.sender);
        workflow.markDisputed(loanId);
    }

    function resolveDispute(uint256 loanId, bool payLender)
        external
        whenNotPaused
        nonReentrant
        onlyActiveRole(Roles.ARBITER)
    {
        Deposit storage d = _deposits[loanId];
        if (d.status != Status.Disputed) revert InvalidStatus(loanId, d.status);
        (address borrower, , , ) = workflow.getLoan(loanId);
        address lender = d.lender;
        if (msg.sender == lender || msg.sender == borrower) revert ConflictOfInterest();
        address recipient = payLender ? lender : borrower;
        uint256 amount = d.amount;
        d.status = Status.Resolved;
        balances[recipient] += amount;
        emit DisputeResolved(loanId, msg.sender, recipient, amount);
    }

    // ───────────── pull payment ─────────────
    /// @notice Checks-effects-interactions: the balance is zeroed BEFORE the ETH leaves. The guard is a second layer.
    function withdraw() external whenNotPaused nonReentrant {
        uint256 amount = balances[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        balances[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ───────────── views ─────────────
    function depositOf(uint256 loanId) external view returns (address lender, uint256 amountWei, Status status) {
        Deposit storage d = _deposits[loanId];
        return (d.lender, d.amount, d.status);
    }
    // No receive() / fallback(): plain ETH transfers revert, so ETH only enters through fund() and repay().
}
