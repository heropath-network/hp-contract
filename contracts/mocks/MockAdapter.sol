// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IAdapter.sol";

/**
 * @title MockAdapter
 * @notice Mock adapter for testing - returns amountIn as amountOut (1:1 ratio)
 */
contract MockAdapter is IAdapter {
    using SafeERC20 for IERC20;

    /**
     * @notice Mock swap - just returns amountIn as amountOut
     */
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata /* extraData */
    ) external payable override returns (uint256 amountOut) {
        // For testing, just return amountIn as output (1:1)
        amountOut = amountIn;
        require(amountOut >= minAmountOut, "Insufficient output");

        // Handle token transfers
        if (tokenIn != address(0)) {
            IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        }

        if (tokenOut != address(0)) {
            // Would need tokens pre-funded in mock
            // For testing we skip actual transfer
        } else {
            // Send BNB back (need contract to have BNB)
            // For testing we skip
        }
    }

    receive() external payable {}
}
