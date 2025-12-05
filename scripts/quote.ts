/**
 * Quote Tool - Get swap quotes from PancakeSwap
 *
 * Usage:
 *   npx ts-node scripts/quote.ts --from USDT --to BNB --amount 100
 *   npx ts-node scripts/quote.ts --from 0x55d398326f99059fF775485246999027B3197955 --to 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c --amount 100
 */

import { ethers } from "ethers";
import { program } from "commander";
import * as dotenv from "dotenv";

dotenv.config();

// BSC Addresses
const TOKENS: Record<string, string> = {
  BNB: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", // Native BNB placeholder
  WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  USDT: "0x55d398326f99059fF775485246999027B3197955",
  USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  BUSD: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
  // Add more tokens as needed
};

const PANCAKE_QUOTER_V2 = "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997";

const QUOTER_ABI = [
  "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  "function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
];

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
];

// V2 Router for simple quotes
const PANCAKE_V2_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const V2_ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)",
];

interface QuoteResult {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  priceImpact: string;
  route: string;
  fee: string;
}

async function getTokenInfo(provider: ethers.Provider, address: string): Promise<{ decimals: number; symbol: string }> {
  if (address === TOKENS.BNB) {
    return { decimals: 18, symbol: "BNB" };
  }
  const contract = new ethers.Contract(address, ERC20_ABI, provider);
  const [decimals, symbol] = await Promise.all([contract.decimals(), contract.symbol()]);
  return { decimals: Number(decimals), symbol };
}

async function quoteV2(
  provider: ethers.Provider,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint
): Promise<QuoteResult | null> {
  try {
    const router = new ethers.Contract(PANCAKE_V2_ROUTER, V2_ROUTER_ABI, provider);

    // Use WBNB for native BNB in path
    const pathIn = tokenIn === TOKENS.BNB ? TOKENS.WBNB : tokenIn;
    const pathOut = tokenOut === TOKENS.BNB ? TOKENS.WBNB : tokenOut;

    const path = [pathIn, pathOut];
    const amounts = await router.getAmountsOut(amountIn, path);
    const amountOut = amounts[1];

    const tokenInInfo = await getTokenInfo(provider, tokenIn);
    const tokenOutInfo = await getTokenInfo(provider, tokenOut);

    const amountInFormatted = ethers.formatUnits(amountIn, tokenInInfo.decimals);
    const amountOutFormatted = ethers.formatUnits(amountOut, tokenOutInfo.decimals);

    // Calculate price impact (simplified)
    const inputPrice = Number(amountInFormatted);
    const outputPrice = Number(amountOutFormatted);
    const rate = outputPrice / inputPrice;

    return {
      tokenIn: `${tokenInInfo.symbol} (${tokenIn})`,
      tokenOut: `${tokenOutInfo.symbol} (${tokenOut})`,
      amountIn: amountInFormatted,
      amountOut: amountOutFormatted,
      priceImpact: "N/A (V2)",
      route: "V2 Direct",
      fee: "0.25%",
    };
  } catch (error) {
    console.error("V2 quote failed:", error);
    return null;
  }
}

async function quoteV3(
  provider: ethers.Provider,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  fee: number = 2500 // Default 0.25%
): Promise<QuoteResult | null> {
  try {
    const quoter = new ethers.Contract(PANCAKE_QUOTER_V2, QUOTER_ABI, provider);

    // Use WBNB for native BNB
    const pathIn = tokenIn === TOKENS.BNB ? TOKENS.WBNB : tokenIn;
    const pathOut = tokenOut === TOKENS.BNB ? TOKENS.WBNB : tokenOut;

    const params = {
      tokenIn: pathIn,
      tokenOut: pathOut,
      amountIn,
      fee,
      sqrtPriceLimitX96: 0n,
    };

    // Use staticCall to simulate
    const result = await quoter.quoteExactInputSingle.staticCall(params);
    const amountOut = result[0];

    const tokenInInfo = await getTokenInfo(provider, tokenIn);
    const tokenOutInfo = await getTokenInfo(provider, tokenOut);

    return {
      tokenIn: `${tokenInInfo.symbol} (${tokenIn})`,
      tokenOut: `${tokenOutInfo.symbol} (${tokenOut})`,
      amountIn: ethers.formatUnits(amountIn, tokenInInfo.decimals),
      amountOut: ethers.formatUnits(amountOut, tokenOutInfo.decimals),
      priceImpact: "Calculated from sqrtPrice",
      route: `V3 (${fee / 10000}% fee)`,
      fee: `${fee / 10000}%`,
    };
  } catch (error) {
    console.error("V3 quote failed:", error);
    return null;
  }
}

async function main() {
  program
    .requiredOption("--from <token>", "Input token symbol or address")
    .requiredOption("--to <token>", "Output token symbol or address")
    .requiredOption("--amount <number>", "Amount to swap")
    .option("--v2", "Force V2 quote only")
    .option("--v3", "Force V3 quote only")
    .option("--fee <number>", "V3 fee tier (100, 500, 2500, 10000)", "2500")
    .parse();

  const opts = program.opts();

  // Resolve token addresses
  const tokenIn = TOKENS[opts.from.toUpperCase()] || opts.from;
  const tokenOut = TOKENS[opts.to.toUpperCase()] || opts.to;

  // Connect to BSC
  const rpc = process.env.BSC_RPC || "https://bsc-dataseed1.binance.org";
  const provider = new ethers.JsonRpcProvider(rpc);

  console.log("\n========== PancakeSwap Quote ==========\n");

  // Get token info for amount parsing
  const tokenInInfo = await getTokenInfo(provider, tokenIn);
  const amountIn = ethers.parseUnits(opts.amount, tokenInInfo.decimals);

  console.log(`From: ${tokenInInfo.symbol}`);
  console.log(`To: ${opts.to.toUpperCase()}`);
  console.log(`Amount: ${opts.amount} ${tokenInInfo.symbol}\n`);

  // Get quotes
  if (!opts.v3) {
    console.log("--- V2 Quote ---");
    const v2Quote = await quoteV2(provider, tokenIn, tokenOut, amountIn);
    if (v2Quote) {
      console.log(`  Amount Out: ${v2Quote.amountOut}`);
      console.log(`  Route: ${v2Quote.route}`);
      console.log(`  Fee: ${v2Quote.fee}`);
    } else {
      console.log("  No V2 route available");
    }
    console.log();
  }

  if (!opts.v2) {
    const feeTiers = [100, 500, 2500, 10000];
    console.log("--- V3 Quotes ---");
    for (const fee of feeTiers) {
      const v3Quote = await quoteV3(provider, tokenIn, tokenOut, amountIn, fee);
      if (v3Quote) {
        console.log(`  [${fee / 100}bp] Amount Out: ${v3Quote.amountOut}`);
      }
    }
    console.log();
  }

  console.log("========================================\n");
}

main().catch(console.error);
