// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IHPAdapter
 * @notice Interface that all adapters must implement
 */
interface IHPAdapter {
    /**
     * @notice Returns the adapter's unique identifier
     * @return Adapter ID (typically keccak256 of adapter name)
     */
    function ADAPTER_ID() external view returns (bytes32);
}
