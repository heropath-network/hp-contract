// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";

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
    using EnumerableMap for EnumerableMap.Bytes32ToAddressMap;

    // ============ Roles ============
    bytes32 public constant HP_DAO_ROLE = keccak256("HP_DAO_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");

    // ============ State Variables ============

    /// @notice Registered adapters using EnumerableMap for efficient enumeration
    EnumerableMap.Bytes32ToAddressMap private _adapters;

    // ============ Events ============

    // Fund events
    event Deposited(address indexed token, address indexed from, uint256 amount);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    // Aggregator events
    event AdapterRegistered(bytes32 indexed adapterId, address indexed adapter);
    event AdapterRemoved(bytes32 indexed adapterId);
    event AdapterExecuted(bytes32 indexed adapterId, bytes data);

    // ============ Errors ============

    string private constant ERR_INVALID_ADDRESS = "Invalid address";
    string private constant ERR_INSUFFICIENT_BALANCE = "Insufficient balance";
    string private constant ERR_TRANSFER_FAILED = "Transfer failed";
    string private constant ERR_ADAPTER_EXISTS = "Adapter already exists";
    string private constant ERR_ADAPTER_NOT_FOUND = "Adapter not found";
    string private constant ERR_ADAPTER_CALL_FAILED = "Adapter call failed";

    // ============ Initializer ============

    /**
     * @notice Initialize the contract
     * @dev Grants all roles to msg.sender
     */
    function initialize() public initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(HP_DAO_ROLE, msg.sender);
        _grantRole(EXECUTOR_ROLE, msg.sender);
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
        require(token != address(0), ERR_INVALID_ADDRESS);
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
        require(to != address(0), ERR_INVALID_ADDRESS);

        if (token == address(0)) {
            // Withdraw BNB
            require(address(this).balance >= amount, ERR_INSUFFICIENT_BALANCE);
            (bool success, ) = to.call{ value: amount }("");
            require(success, ERR_TRANSFER_FAILED);
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
        require(adapter != address(0), ERR_INVALID_ADDRESS);
        require(_adapters.set(adapterId, adapter), ERR_ADAPTER_EXISTS);
        emit AdapterRegistered(adapterId, adapter);
    }

    /**
     * @notice Remove an adapter
     * @param adapterId Adapter identifier to remove
     */
    function removeAdapter(bytes32 adapterId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_adapters.remove(adapterId), ERR_ADAPTER_NOT_FOUND);
        emit AdapterRemoved(adapterId);
    }

    /**
     * @notice Execute arbitrary call to an adapter (ALLOCATOR only)
     * @param adapterId Adapter to call
     * @param data Encoded function call data
     * @return result Return data from adapter call
     */
    function execute(
        bytes32 adapterId,
        bytes calldata data
    ) external payable onlyRole(EXECUTOR_ROLE) nonReentrant returns (bytes memory result) {
        (bool exists, address adapter) = _adapters.tryGet(adapterId);
        require(exists, ERR_ADAPTER_NOT_FOUND);

        bool success;
        (success, result) = adapter.call{value: msg.value}(data);
        require(success, _getRevertMsg(result));

        emit AdapterExecuted(adapterId, data);
    }

    /**
     * @notice Approve token for adapter to spend (ALLOCATOR only)
     * @param adapterId Adapter to approve
     * @param token Token to approve
     * @param amount Amount to approve
     */
    function approveForAdapter(
        bytes32 adapterId,
        address token,
        uint256 amount
    ) external onlyRole(EXECUTOR_ROLE) {
        (bool exists, address adapter) = _adapters.tryGet(adapterId);
        require(exists, ERR_ADAPTER_NOT_FOUND);
        require(token != address(0), ERR_INVALID_ADDRESS);
        IERC20(token).forceApprove(adapter, amount);
    }

    /**
     * @notice Parse revert message from failed call
     * @param returnData Return data from failed call
     * @return Revert message string
     */
    function _getRevertMsg(bytes memory returnData) internal pure returns (string memory) {
        if (returnData.length < 68) {
            return ERR_ADAPTER_CALL_FAILED;
        }
        assembly {
            returnData := add(returnData, 0x04)
        }
        return abi.decode(returnData, (string));
    }

    /**
     * @notice Get number of registered adapters
     * @return Number of adapters
     */
    function getAdapterCount() external view returns (uint256) {
        return _adapters.length();
    }

    /**
     * @notice Get adapter at index
     * @param index Index in the adapter list
     * @return adapterId Adapter identifier
     * @return adapter Adapter address
     */
    function getAdapterAt(uint256 index) external view returns (bytes32 adapterId, address adapter) {
        return _adapters.at(index);
    }

    /**
     * @notice Get all registered adapter IDs
     * @return Array of adapter IDs
     */
    function getAdapterIds() external view returns (bytes32[] memory) {
        return _adapters.keys();
    }

    /**
     * @notice Get adapter address by ID
     * @param adapterId Adapter identifier
     * @return Adapter address (returns address(0) if not found)
     */
    function getAdapter(bytes32 adapterId) external view returns (address) {
        (bool exists, address adapter) = _adapters.tryGet(adapterId);
        return exists ? adapter : address(0);
    }

    /**
     * @notice Check if adapter exists
     * @param adapterId Adapter identifier
     * @return True if adapter exists
     */
    function hasAdapter(bytes32 adapterId) external view returns (bool) {
        return _adapters.contains(adapterId);
    }

    // ============ Receive ============

    /// @notice Allow contract to receive BNB
    receive() external payable {
        emit Deposited(address(0), msg.sender, msg.value);
    }
}
