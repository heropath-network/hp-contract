// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IHPAdapter.sol";

/**
 * @title MockAdapter
 * @notice Mock adapter for testing HPPropTrading
 */
contract MockAdapter is IHPAdapter {
    bytes32 public immutable ADAPTER_ID;

    constructor(string memory name) {
        ADAPTER_ID = keccak256(bytes(name));
    }
}
