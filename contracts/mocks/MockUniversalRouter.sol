// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MockUniversalRouter
 * @notice Mock PancakeSwap Universal Router for testing
 * @dev Simulates swap by transferring tokens at 1:1 ratio
 */
contract MockUniversalRouter {
    using SafeERC20 for IERC20;

    address public wbnb;

    constructor(address _wbnb) {
        wbnb = _wbnb;
    }

    /**
     * @notice Mock execute - simulates swap
     * @dev For testing: decodes first input to get swap params and executes 1:1 swap
     */
    function execute(
        bytes calldata commands,
        bytes[] calldata inputs,
        uint256 /* deadline */
    ) external payable {
        // Simple mock: transfer output tokens to msg.sender
        // In real tests, we pre-fund this contract with output tokens

        // Check first command
        if (commands.length > 0) {
            bytes1 command = commands[0];

            // V2_SWAP_EXACT_IN (0x08) or V3_SWAP_EXACT_IN (0x00)
            if (command == 0x08 || command == 0x00) {
                // Decode V2 input: (address recipient, uint256 amountIn, uint256 amountOutMin, address[] path, bool payerIsUser)
                // For simplicity, we just do a 1:1 swap
                if (inputs.length > 0) {
                    (address recipient, uint256 amountIn, , address[] memory path, ) =
                        abi.decode(inputs[0], (address, uint256, uint256, address[], bool));

                    address tokenIn = path[0];
                    address tokenOut = path[path.length - 1];

                    // Transfer input tokens from sender (adapter) to this contract
                    if (tokenIn != address(0) && tokenIn != wbnb) {
                        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
                    }

                    // Transfer output tokens to recipient (1:1 ratio for testing)
                    if (tokenOut != address(0) && tokenOut != wbnb) {
                        IERC20(tokenOut).safeTransfer(recipient, amountIn);
                    } else {
                        // Send BNB
                        (bool success, ) = recipient.call{value: amountIn}("");
                        require(success, "BNB transfer failed");
                    }
                }
            }
        }
    }

    receive() external payable {}
}
