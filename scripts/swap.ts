/**
 * Swap Tool - Execute swaps through HPPropTrading contract
 *
 * Usage:
 *   npx ts-node scripts/swap.ts --from USDT --to BNB --amount 100 --slippage 0.5
 *   npx ts-node scripts/swap.ts --from USDT --to 0x02e75d28a8aa2a0033b8cf866fcf0bb0e1ee4444 --amount 100 --slippage 1
 */

import { ethers } from "ethers"
import { program } from "commander"
import * as fs from "fs"
import * as path from "path"
import * as dotenv from "dotenv"

dotenv.config()

// BSC Addresses
const TOKENS: Record<string, string> = {
  BNB: ethers.ZeroAddress, // Native BNB
  WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  USDT: "0x55d398326f99059fF775485246999027B3197955",
  USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  BUSD: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
  PALU: "0x02e75d28A8AA2a0033b8cf866fCf0bB0E1eE4444",
}

const PANCAKE_UNIVERSAL_ROUTER = "0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB"
const PANCAKE_V2_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E"
const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"

const PANCAKE_ADAPTER_ID = ethers.keccak256(ethers.toUtf8Bytes("PANCAKESWAP"))

// Universal Router command codes
const COMMAND_V2_SWAP_EXACT_IN = 0x08
const COMMAND_V3_SWAP_EXACT_IN = 0x00

// ABIs
const HP_PROP_TRADING_ABI = [
  "function execute(bytes32 adapterId, bytes data) payable returns (bytes)",
  "function approveForAdapter(bytes32 adapterId, address token, uint256 amount)",
  "function getBalance(address token) view returns (uint256)",
  "function getAdapter(bytes32 adapterId) view returns (address)",
]

const PANCAKE_ADAPTER_ABI = [
  "function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, bytes extraData) payable returns (uint256)",
]

const V2_ROUTER_ABI = ["function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)"]

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]

interface DeploymentInfo {
  contracts: {
    HPPropTrading_Proxy: string
    PancakeSwapAdapter: string
  }
}

function loadDeployment(network: string): DeploymentInfo {
  const filepath = path.join(__dirname, "..", "deployments", `${network}.json`)
  if (!fs.existsSync(filepath)) {
    throw new Error(`Deployment not found: ${filepath}`)
  }
  return JSON.parse(fs.readFileSync(filepath, "utf8"))
}

function encodeV2SwapExactIn(
  recipient: string,
  amountIn: bigint,
  minAmountOut: bigint,
  path: string[],
  payerIsUser: boolean
): { commands: string; inputs: string[] } {
  // Command: V2_SWAP_EXACT_IN (0x08)
  const commands = ethers.hexlify(new Uint8Array([COMMAND_V2_SWAP_EXACT_IN]))

  // Input encoding for V2_SWAP_EXACT_IN:
  // (address recipient, uint256 amountIn, uint256 amountOutMin, address[] path, bool payerIsUser)
  const abiCoder = ethers.AbiCoder.defaultAbiCoder()
  const input = abiCoder.encode(
    ["address", "uint256", "uint256", "address[]", "bool"],
    [recipient, amountIn, minAmountOut, path, payerIsUser]
  )

  return { commands, inputs: [input] }
}

async function getQuote(
  provider: ethers.Provider,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint
): Promise<bigint> {
  const router = new ethers.Contract(PANCAKE_V2_ROUTER, V2_ROUTER_ABI, provider)

  // Use WBNB for native BNB in path
  const pathIn = tokenIn === ethers.ZeroAddress ? WBNB : tokenIn
  const pathOut = tokenOut === ethers.ZeroAddress ? WBNB : tokenOut

  try {
    const amounts = await router.getAmountsOut(amountIn, [pathIn, pathOut])
    return amounts[1]
  } catch {
    throw new Error("No liquidity available for this pair")
  }
}

async function main() {
  program
    .requiredOption("--from <token>", "Input token symbol or address")
    .requiredOption("--to <token>", "Output token symbol or address")
    .requiredOption("--amount <number>", "Amount to swap")
    .option("--slippage <percent>", "Slippage tolerance in percent", "0.5")
    .option("--network <network>", "Network name", "bscMainnet")
    .option("--dry-run", "Simulate without sending transaction")
    .parse()

  const opts = program.opts()

  // Resolve token addresses
  const tokenIn = TOKENS[opts.from.toUpperCase()] || opts.from
  const tokenOut = TOKENS[opts.to.toUpperCase()] || opts.to

  // Load deployment
  const deployment = loadDeployment(opts.network)
  const hpPropTradingAddress = deployment.contracts.HPPropTrading_Proxy

  console.log("\n========== HP Prop Trading Swap ==========\n")
  console.log(`Contract: ${hpPropTradingAddress}`)
  console.log(`Network: ${opts.network}`)

  // Connect to BSC
  const rpc = process.env.BSC_RPC || "https://bsc-dataseed1.binance.org"
  const provider = new ethers.JsonRpcProvider(rpc)

  const privateKey = process.env.PRIVATE_KEY
  if (!privateKey) {
    throw new Error("PRIVATE_KEY not set in .env")
  }
  const wallet = new ethers.Wallet(privateKey, provider)
  console.log(`Signer: ${wallet.address}\n`)

  // Get token decimals
  let tokenInDecimals = 18
  let tokenInSymbol = "BNB"
  if (tokenIn !== ethers.ZeroAddress) {
    const token = new ethers.Contract(tokenIn, ERC20_ABI, provider)
    tokenInDecimals = Number(await token.decimals())
    tokenInSymbol = await token.symbol()
  }

  let tokenOutDecimals = 18
  let tokenOutSymbol = "BNB"
  if (tokenOut !== ethers.ZeroAddress) {
    const token = new ethers.Contract(tokenOut, ERC20_ABI, provider)
    tokenOutDecimals = Number(await token.decimals())
    tokenOutSymbol = await token.symbol()
  }

  const amountIn = ethers.parseUnits(opts.amount, tokenInDecimals)

  console.log(`Swap: ${opts.amount} ${tokenInSymbol} -> ${tokenOutSymbol}`)
  console.log(`Slippage: ${opts.slippage}%\n`)

  // Get quote
  console.log("Getting quote...")
  const expectedOut = await getQuote(provider, tokenIn, tokenOut, amountIn)
  const slippageBps = Math.floor(parseFloat(opts.slippage) * 100)
  const minAmountOut = (expectedOut * BigInt(10000 - slippageBps)) / 10000n

  console.log(`Expected output: ${ethers.formatUnits(expectedOut, tokenOutDecimals)} ${tokenOutSymbol}`)
  console.log(
    `Min output (${opts.slippage}% slippage): ${ethers.formatUnits(minAmountOut, tokenOutDecimals)} ${tokenOutSymbol}\n`
  )

  // Encode swap data for Universal Router
  // Use WBNB in path for native BNB
  const pathIn = tokenIn === ethers.ZeroAddress ? WBNB : tokenIn
  const pathOut = tokenOut === ethers.ZeroAddress ? WBNB : tokenOut
  const swapPath = [pathIn, pathOut]

  const deadline = Math.floor(Date.now() / 1000) + 300 // 5 minutes

  const { commands, inputs } = encodeV2SwapExactIn(
    hpPropTradingAddress, // recipient is the contract (adapter will forward)
    amountIn,
    minAmountOut,
    swapPath,
    false // payerIsUser = false, contract pays
  )

  // Encode extraData for PancakeSwapAdapter
  const abiCoder = ethers.AbiCoder.defaultAbiCoder()
  const extraData = abiCoder.encode(["bytes", "bytes[]", "uint256"], [commands, inputs, deadline])

  console.log("Encoded extraData:", extraData.substring(0, 100) + "...\n")

  // Encode swap function call for adapter
  const adapterInterface = new ethers.Interface(PANCAKE_ADAPTER_ABI)
  const swapCalldata = adapterInterface.encodeFunctionData("swap", [
    tokenIn,
    tokenOut,
    amountIn,
    minAmountOut,
    extraData,
  ])

  console.log("Encoded swap calldata:", swapCalldata.substring(0, 100) + "...\n")

  if (opts.dryRun) {
    console.log("=== DRY RUN - No transaction sent ===\n")
    console.log("Transaction parameters:")
    console.log(`  adapterId: ${PANCAKE_ADAPTER_ID}`)
    console.log(`  tokenIn: ${tokenIn}`)
    console.log(`  tokenOut: ${tokenOut}`)
    console.log(`  amountIn: ${amountIn.toString()}`)
    console.log(`  minAmountOut: ${minAmountOut.toString()}`)
    return
  }

  // Execute swap
  console.log("Executing swap...")
  const hpPropTrading = new ethers.Contract(hpPropTradingAddress, HP_PROP_TRADING_ABI, wallet)

  // Check if adapter is registered
  const adapterAddress = await hpPropTrading.getAdapter(PANCAKE_ADAPTER_ID)
  if (adapterAddress === ethers.ZeroAddress) {
    throw new Error("PancakeSwap adapter not registered")
  }
  console.log(`Adapter address: ${adapterAddress}`)

  // Execute via HPPropTrading.execute()
  const tx = await hpPropTrading.execute(PANCAKE_ADAPTER_ID, swapCalldata)

  console.log(`Transaction sent: ${tx.hash}`)
  console.log("Waiting for confirmation...\n")

  const receipt = await tx.wait()
  console.log(`Transaction confirmed in block ${receipt.blockNumber}`)
  console.log(`Gas used: ${receipt.gasUsed.toString()}`)

  console.log("\n========================================\n")
}

main().catch(console.error)
