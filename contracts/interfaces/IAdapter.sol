// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IAdapter
 * @notice Interface for trading adapters (PancakeSwap, future protocols, etc.)
 */
interface IAdapter {
    /**
     * @notice Execute a token swap
     * @param tokenIn Address of the input token (address(0) for native BNB)
     * @param tokenOut Address of the output token (address(0) for native BNB)
     * @param amountIn Amount of input tokens
     * @param minAmountOut Minimum acceptable output amount (slippage protection)
     * @param extraData Protocol-specific encoded data (e.g., swap path, deadline)
     * @return amountOut Actual amount of output tokens received
     */
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata extraData
    ) external payable returns (uint256 amountOut);
}
