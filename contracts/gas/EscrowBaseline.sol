// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {RegistryAccessControl} from "../access/RegistryAccessControl.sol";
import {IRegistry} from "../interfaces/IRegistry.sol";
import {IWorkflow} from "../interfaces/IWorkflow.sol";
import {Roles} from "../access/Roles.sol";
import {IEscrow} from "../interfaces/IEscrow.sol";

/// @notice GAS BASELINE ONLY (never deploy). The straightforward first draft of EscrowDispute, recorded BEFORE
///         optimizing: same logic, same roles, same events, same workflow calls, same reentrancy guard and CEI order, but
///         unpacked uint256 / uint8 fields (3 storage slots) and require("string") errors.
contract EscrowBaseline is RegistryAccessControl, IEscrow {
    struct Deposit {
        address lender; // slot 0
        uint256 amount; // slot 1
        uint8 status;   // slot 2 (0 None, 1 Held, 2 Released, 3 Repaid, 4 Disputed, 5 Resolved)
    }
    IWorkflow public immutable workflow;
    mapping(uint256 => Deposit) public deposits;
    mapping(address => uint256) public balances;
    uint256 private _lock = 1;

    modifier nonReentrant() {
        require(_lock == 1, "reentrant");
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(IRegistry registry_, IWorkflow workflow_) RegistryAccessControl(registry_) { workflow = workflow_; }

    function fund(uint256 loanId) external payable whenNotPaused nonReentrant onlyActiveRole(Roles.LENDER) {
        (address borrower, uint96 amountWei, , uint8 state) = workflow.getLoan(loanId);
        require(deposits[loanId].status == 0, "already funded");
        require(state == 2, "loan not approved");
        require(msg.sender != borrower, "self funding");
        require(msg.value == amountWei, "wrong amount");
        deposits[loanId] = Deposit(msg.sender, amountWei, 1);
        emit Funded(loanId, msg.sender, amountWei);
        workflow.markFunded(loanId, msg.sender);
    }

    function releaseFunds(uint256 loanId) external whenNotPaused nonReentrant onlyActiveRole(Roles.BORROWER) {
        require(deposits[loanId].status == 1, "bad status");
        (address borrower, , , ) = workflow.getLoan(loanId);
        require(msg.sender == borrower, "not borrower");
        deposits[loanId].status = 2;
        balances[borrower] += deposits[loanId].amount;
        emit Released(loanId, borrower, deposits[loanId].amount);
    }

    function repay(uint256 loanId) external payable whenNotPaused nonReentrant onlyActiveRole(Roles.BORROWER) {
        require(deposits[loanId].status == 2, "bad status");
        (address borrower, , , ) = workflow.getLoan(loanId);
        require(msg.sender == borrower, "not borrower");
        require(msg.value == deposits[loanId].amount, "wrong amount");
        deposits[loanId].status = 3;
        balances[deposits[loanId].lender] += deposits[loanId].amount;
        emit Repaid(loanId, deposits[loanId].lender, deposits[loanId].amount);
        workflow.markRepaid(loanId);
    }

    function raiseDispute(uint256 loanId) external whenNotPaused nonReentrant {
        require(deposits[loanId].status == 1, "bad status");
        (address borrower, , , ) = workflow.getLoan(loanId);
        bool isLender = msg.sender == deposits[loanId].lender && registry.hasActiveRole(msg.sender, Roles.LENDER);
        bool isBorrower = msg.sender == borrower && registry.hasActiveRole(msg.sender, Roles.BORROWER);
        require(isLender || isBorrower, "not party");
        deposits[loanId].status = 4;
        emit DisputeRaised(loanId, msg.sender);
        workflow.markDisputed(loanId);
    }

    function resolveDispute(uint256 loanId, bool payLender) external whenNotPaused nonReentrant onlyActiveRole(Roles.ARBITER) {
        require(deposits[loanId].status == 4, "bad status");
        (address borrower, , , ) = workflow.getLoan(loanId);
        require(msg.sender != deposits[loanId].lender && msg.sender != borrower, "conflict");
        deposits[loanId].status = 5;
        address recipient = payLender ? deposits[loanId].lender : borrower;
        balances[recipient] += deposits[loanId].amount;
        emit DisputeResolved(loanId, msg.sender, recipient, deposits[loanId].amount);
    }

    function withdraw() external whenNotPaused nonReentrant {
        uint256 amount = balances[msg.sender];
        require(amount != 0, "nothing");
        balances[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
    }

    function depositOf(uint256 loanId) external view returns (address lender, uint256 amountWei, Status status) {
        Deposit storage d = deposits[loanId];
        return (d.lender, d.amount, Status(d.status));
    }
}
