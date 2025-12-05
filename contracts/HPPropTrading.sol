// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IAdapter.sol";

/**
 * @title HPPropTrading
 * @notice HeroPath Prop Trading - Fund management and trading aggregator for HP DAO
 * @dev Upgradeable contract using OpenZeppelin's Transparent Proxy pattern
 *
 * Modules:
 * - Fund: Manages DAO funds (BNB/USDT/etc.), only HP_DAO_ROLE can withdraw
 * - Aggregator: Manages trading adapters, only ALLOCATOR_ROLE can execute trades
 */
contract HPPropTrading is Initializable, AccessControlUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ============ Roles ============
    bytes32 public constant HP_DAO_ROLE = keccak256("HP_DAO_ROLE");
    bytes32 public constant ALLOCATOR_ROLE = keccak256("ALLOCATOR_ROLE");

    // ============ State Variables ============

    /// @notice Registered adapters: adapterId => adapter address
    mapping(bytes32 => address) public adapters;

    /// @notice List of registered adapter IDs
    bytes32[] public adapterIds;

    // ============ Events ============

    // Fund events
    event Deposited(address indexed token, address indexed from, uint256 amount);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    // Aggregator events
    event AdapterRegistered(bytes32 indexed adapterId, address indexed adapter);
    event AdapterRemoved(bytes32 indexed adapterId);
    event SwapExecuted(
        bytes32 indexed adapterId,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    // ============ Errors ============

    error AdapterAlreadyExists(bytes32 adapterId);
    error AdapterNotFound(bytes32 adapterId);
    error InvalidAddress();
    error InsufficientBalance();
    error SwapFailed();

    // ============ Initializer ============

    /**
     * @notice Initialize the contract
     * @param admin Address to receive DEFAULT_ADMIN_ROLE, HP_DAO_ROLE, and ALLOCATOR_ROLE
     */
    function initialize(address admin) public initializer {
        if (admin == address(0)) revert InvalidAddress();

        __AccessControl_init();
        __ReentrancyGuard_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(HP_DAO_ROLE, admin);
        _grantRole(ALLOCATOR_ROLE, admin);
    }

    // ============ Fund Module ============

    /**
     * @notice Deposit native BNB to the contract
     */
    function deposit() external payable {
        emit Deposited(address(0), msg.sender, msg.value);
    }

    /**
     * @notice Deposit ERC20 tokens to the contract
     * @param token Token address
     * @param amount Amount to deposit
     */
    function depositToken(address token, uint256 amount) external {
        if (token == address(0)) revert InvalidAddress();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(token, msg.sender, amount);
    }

    /**
     * @notice Withdraw funds from the contract (HP_DAO only)
     * @param token Token address (address(0) for BNB)
     * @param amount Amount to withdraw
     * @param to Recipient address
     */
    function withdraw(address token, uint256 amount, address to) external onlyRole(HP_DAO_ROLE) nonReentrant {
        if (to == address(0)) revert InvalidAddress();

        if (token == address(0)) {
            // Withdraw BNB
            if (address(this).balance < amount) revert InsufficientBalance();
            (bool success, ) = to.call{ value: amount }("");
            if (!success) revert SwapFailed();
        } else {
            // Withdraw ERC20
            IERC20(token).safeTransfer(to, amount);
        }

        emit Withdrawn(token, to, amount);
    }

    /**
     * @notice Get balance of a token
     * @param token Token address (address(0) for BNB)
     * @return Balance amount
     */
    function getBalance(address token) external view returns (uint256) {
        if (token == address(0)) {
            return address(this).balance;
        }
        return IERC20(token).balanceOf(address(this));
    }

    // ============ Aggregator Module ============

    /**
     * @notice Register a new adapter
     * @param adapterId Unique identifier for the adapter
     * @param adapter Adapter contract address
     */
    function registerAdapter(bytes32 adapterId, address adapter) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (adapter == address(0)) revert InvalidAddress();
        if (adapters[adapterId] != address(0)) revert AdapterAlreadyExists(adapterId);

        adapters[adapterId] = adapter;
        adapterIds.push(adapterId);

        emit AdapterRegistered(adapterId, adapter);
    }

    /**
     * @notice Remove an adapter
     * @param adapterId Adapter identifier to remove
     */
    function removeAdapter(bytes32 adapterId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (adapters[adapterId] == address(0)) revert AdapterNotFound(adapterId);

        delete adapters[adapterId];

        // Remove from array
        for (uint256 i = 0; i < adapterIds.length; i++) {
            if (adapterIds[i] == adapterId) {
                adapterIds[i] = adapterIds[adapterIds.length - 1];
                adapterIds.pop();
                break;
            }
        }

        emit AdapterRemoved(adapterId);
    }

    /**
     * @notice Execute a swap through an adapter (ALLOCATOR only)
     * @param adapterId Adapter to use
     * @param tokenIn Input token address (address(0) for BNB)
     * @param tokenOut Output token address (address(0) for BNB)
     * @param amountIn Amount of input tokens
     * @param minAmountOut Minimum acceptable output (slippage protection)
     * @param extraData Protocol-specific data (swap path, deadline, etc.)
     * @return amountOut Actual output amount
     */
    function executeSwap(
        bytes32 adapterId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata extraData
    ) external onlyRole(ALLOCATOR_ROLE) nonReentrant returns (uint256 amountOut) {
        address adapter = adapters[adapterId];
        if (adapter == address(0)) revert AdapterNotFound(adapterId);

        uint256 value = 0;

        if (tokenIn == address(0)) {
            // Sending BNB
            if (address(this).balance < amountIn) revert InsufficientBalance();
            value = amountIn;
        } else {
            // Approve adapter to spend tokens
            IERC20(tokenIn).forceApprove(adapter, amountIn);
        }

        // Execute swap
        amountOut = IAdapter(adapter).swap{ value: value }(tokenIn, tokenOut, amountIn, minAmountOut, extraData);

        emit SwapExecuted(adapterId, tokenIn, tokenOut, amountIn, amountOut);
    }

    /**
     * @notice Get all registered adapter IDs
     * @return Array of adapter IDs
     */
    function getAdapterIds() external view returns (bytes32[] memory) {
        return adapterIds;
    }

    /**
     * @notice Get adapter address by ID
     * @param adapterId Adapter identifier
     * @return Adapter address
     */
    function getAdapter(bytes32 adapterId) external view returns (address) {
        return adapters[adapterId];
    }

    // ============ Receive ============

    /// @notice Allow contract to receive BNB
    receive() external payable {
        emit Deposited(address(0), msg.sender, msg.value);
    }
}
