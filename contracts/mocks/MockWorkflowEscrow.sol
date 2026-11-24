// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {CoreWorkflow} from "../CoreWorkflow.sol";
/// @notice Test-only stand-in. NEVER deploy as real escrow: it does not handle ETH.
contract MockWorkflowEscrow {
    CoreWorkflow public immutable workflow;
    constructor(CoreWorkflow w) { workflow = w; }
    function funded(uint256 id, address lender) external { workflow.markFunded(id, lender); }
    function repaid(uint256 id) external { workflow.markRepaid(id); }
    function disputed(uint256 id) external { workflow.markDisputed(id); }
}
