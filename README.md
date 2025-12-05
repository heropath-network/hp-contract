# HeroPath Contract

HeroPath - Decentralized User-Empowering Prop Trading

## Overview

HP Contract is the execution layer of the HeroPath prop trading ecosystem. It receives aggregated trading insights from Hero accounts and executes trades across multiple DeFi protocols on BNB Chain and other needed networks.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                HeroPath                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Trader ──► Evaluation ──► Hero Account ──► Trading Signals             │
│                │                                  │                     │
│                │                                  ▼                     │
│                │                       ┌──────────────────┐             │
│                │                       │    HP Contract   │             │
│                ▼                       │   (This Module)  │             │
│         ┌───────────┐                  │                  │             │
│         │  hp-fe    │                  │    Aggregator    │             │
│         │  Training │                  │         │        │             │
│         │  Quests   │                  │         ▼        │             │
│         └───────────┘                  │   ┌──────────┐   │             │
│                                        │   │ Adapters │   │             │
│                                        │   └────┬─────┘   │             │
│                                        └────────┼─────────┘             │
│                                                 │                       │
│                    ┌────────────────────────────┼─────────────┐         │
│                    ▼                            ▼             ▼         │
│                  Aster            four.meme/PancakeSwap     gTrade...   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Architecture

### Core Contracts

| Contract                 | Description                                                    |
| ------------------------ | -------------------------------------------------------------- |
| `HPPropTrading.sol`      | Main upgradeable contract managing funds and adapter execution |
| `PancakeSwapAdapter.sol` | DEX adapter for PancakeSwap Universal Router V2                |
| `adapters/`              | Future adapters (Roadmap)                                      |

### Roles

| Role                 | Permission                             |
| -------------------- | -------------------------------------- |
| `DEFAULT_ADMIN_ROLE` | Register/remove adapters, manage roles |
| `HP_DAO_ROLE`        | Withdraw funds from the contract       |
| `EXECUTOR_ROLE`      | Execute trades via adapters            |

### Module Design

```
HPPropTrading (Transparent Proxy)
├── Fund Module
│   ├── deposit() / depositToken()
│   ├── withdraw() [HP_DAO_ROLE]
│   └── getBalance()
│
└── Aggregator Module
    ├── registerAdapter() [ADMIN]
    ├── removeAdapter() [ADMIN]
    ├── execute() [EXECUTOR_ROLE]
    └── requestApproval() [Adapters only]
```

## Dependencies

- OpenZeppelin Contracts `^5.0.0` - Security-audited contract libraries
- OpenZeppelin Upgrades `^3.0.0` - Transparent proxy pattern
- Hardhat `^2.19.0` - Ethereum development environment
- Ethers.js `^6.9.0` - Ethereum library
- TypeScript `^5.3.0` - Type-safe development

## Deployment

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your private key and API keys

# Compile contracts
npx hardhat compile

# Deploy (creates proxy + implementation)
npx hardhat --network bsc run scripts/deploy.ts

# Verify on BNB Chain
npx hardhat --network bsc run scripts/verify.ts
```
