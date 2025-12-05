// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IUniversalRouter
 * @notice Interface for PancakeSwap Universal Router 2
 */
interface IUniversalRouter {
    /**
     * @notice Execute a sequence of commands
     * @param commands Encoded commands to execute
     * @param inputs Array of encoded inputs for each command
     * @param deadline Unix timestamp after which the transaction will revert
     */
    function execute(
        bytes calldata commands,
        bytes[] calldata inputs,
        uint256 deadline
    ) external payable;

    /**
     * @notice Execute commands without deadline
     */
    function execute(
        bytes calldata commands,
        bytes[] calldata inputs
    ) external payable;
}
