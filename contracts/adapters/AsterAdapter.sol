// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title AsterAdapter
 * @notice Adapter for Binance Aster perpetual trading on BSC
 * @dev NOT IMPLEMENTED - Aster is a centralized service, cannot integrate on-chain
 *
 * This adapter is a placeholder for future implementation if Aster
 * provides on-chain integration capabilities.
 */
contract AsterAdapter {
    /// @notice Adapter ID for registration in HPPropTrading
    bytes32 public constant ADAPTER_ID = keccak256("ASTER");

    error NotImplemented();
}
