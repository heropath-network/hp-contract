// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IPancakeUniversalRouter.sol";

/**
 * @title PancakeSwapAdapter
 * @notice Adapter for PancakeSwap Universal Router 2 on BSC
 * @dev Supports V2 and V3 swaps through encoded commands
 *
 * Universal Router Commands:
 * - 0x00: V3_SWAP_EXACT_IN
 * - 0x08: V2_SWAP_EXACT_IN
 * - 0x01: V3_SWAP_EXACT_OUT
 * - 0x09: V2_SWAP_EXACT_OUT
 */
contract PancakeSwapAdapter is Ownable {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    /// @notice Adapter ID for registration in HPPropTrading
    bytes32 public constant ADAPTER_ID = keccak256("PANCAKESWAP");

    // ============ Immutables ============

    /// @notice Universal Router address
    /// @dev https://developer.pancakeswap.finance/contracts/universal-router/addresses
    address public immutable universalRouter;

    /// @notice WBNB address
    address public immutable wbnb;

    // ============ State Variables ============

    /// @notice Authorized caller (HPPropTrading)
    address public authorizedCaller;

    // ============ Events ============

    event SwapExecuted(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);
    event AuthorizedCallerUpdated(address indexed oldCaller, address indexed newCaller);

    // ============ Errors ============

    string private constant ERR_INVALID_ADDRESS = "Invalid address";
    string private constant ERR_UNAUTHORIZED = "Unauthorized";
    string private constant ERR_INSUFFICIENT_OUTPUT = "Insufficient output";
    string private constant ERR_TRANSFER_FAILED = "Transfer failed";

    // ============ Modifiers ============

    modifier onlyAuthorized() {
        require(msg.sender == authorizedCaller, ERR_UNAUTHORIZED);
        _;
    }

    // ============ Constructor ============

    /**
     * @notice Constructor
     * @param _universalRouter PancakeSwap Universal Router address
     * @param _wbnb WBNB token address
     * @param _authorizedCaller Authorized caller address (HPPropTrading)
     */
    constructor(address _universalRouter, address _wbnb, address _authorizedCaller) Ownable(msg.sender) {
        require(_universalRouter != address(0) && _wbnb != address(0), ERR_INVALID_ADDRESS);
        universalRouter = _universalRouter;
        wbnb = _wbnb;
        authorizedCaller = _authorizedCaller;
    }

    // ============ Main Functions ============

    /**
     * @notice Execute a swap through PancakeSwap Universal Router
     * @param tokenIn Input token (address(0) for BNB)
     * @param tokenOut Output token (address(0) for BNB)
     * @param amountIn Amount of input tokens
     * @param minAmountOut Minimum acceptable output
     * @param extraData Encoded (commands, inputs, deadline) for Universal Router
     * @return amountOut Actual output amount
     *
     * @dev extraData format: abi.encode(bytes commands, bytes[] inputs, uint256 deadline)
     * The caller (typically HPPropTrading) is responsible for encoding the correct
     * commands and inputs for the desired swap path.
     */
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata extraData
    ) external payable onlyAuthorized returns (uint256 amountOut) {
        // Decode extraData
        (bytes memory commands, bytes[] memory inputs, uint256 deadline) = abi.decode(
            extraData,
            (bytes, bytes[], uint256)
        );

        // Handle input token
        uint256 value = 0;
        if (tokenIn == address(0)) {
            // BNB input - use msg.value
            value = msg.value;
        } else {
            // ERC20 input - transfer from caller and approve router
            IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
            IERC20(tokenIn).forceApprove(universalRouter, amountIn);
        }

        // Record balance before
        uint256 balanceBefore;
        if (tokenOut == address(0)) {
            balanceBefore = address(this).balance;
        } else {
            balanceBefore = IERC20(tokenOut).balanceOf(address(this));
        }

        // Execute swap
        IPancakeUniversalRouter(universalRouter).execute{ value: value }(commands, inputs, deadline);

        // Calculate output
        uint256 balanceAfter;
        if (tokenOut == address(0)) {
            balanceAfter = address(this).balance;
        } else {
            balanceAfter = IERC20(tokenOut).balanceOf(address(this));
        }

        amountOut = balanceAfter - balanceBefore;

        // Check slippage
        require(amountOut >= minAmountOut, ERR_INSUFFICIENT_OUTPUT);

        // Transfer output to caller
        if (tokenOut == address(0)) {
            (bool success, ) = msg.sender.call{ value: amountOut }("");
            require(success, ERR_TRANSFER_FAILED);
        } else {
            IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
        }

        emit SwapExecuted(tokenIn, tokenOut, amountIn, amountOut);
    }

    /**
     * @notice Update authorized caller (owner only)
     * @param _authorizedCaller New authorized caller address
     */
    function setAuthorizedCaller(address _authorizedCaller) external onlyOwner {
        address oldCaller = authorizedCaller;
        authorizedCaller = _authorizedCaller;
        emit AuthorizedCallerUpdated(oldCaller, _authorizedCaller);
    }

    /**
     * @notice Rescue stuck tokens (owner only)
     * @param token Token to rescue (address(0) for BNB)
     * @param to Recipient
     * @param amount Amount to rescue
     */
    function rescue(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            (bool success, ) = to.call{ value: amount }("");
            require(success, "BNB transfer failed");
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    // ============ Receive ============

    /// @notice Allow contract to receive BNB (for unwrapping WBNB)
    receive() external payable {}
}
