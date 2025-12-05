// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IHPPropTrading
 * @notice Interface for adapters to interact with HPPropTrading
 */
interface IHPPropTrading {
    /**
     * @notice Request token approval from the fund contract
     * @param adapterId Adapter's registered ID
     * @param token Token address to approve
     * @param amount Amount to approve
     */
    function requestApproval(bytes32 adapterId, address token, uint256 amount) external;
}
