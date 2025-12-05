import { run, network } from "hardhat"
import * as fs from "fs"
import * as path from "path"

// BSC Mainnet addresses
const BSC_UNIVERSAL_ROUTER = "0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB"
const BSC_WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"

// BSC Testnet addresses
const BSC_TESTNET_WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd"

interface DeploymentInfo {
  contracts: {
    HPPropTrading_Proxy: string
    HPPropTrading_Implementation: string
    ProxyAdmin: string
    PancakeSwapAdapter: string
  }
}

async function main() {
  console.log("Verifying contracts on", network.name)

  // Load deployment info
  const deploymentsDir = path.join(__dirname, "..", "deployments")
  const filename = `${network.name}.json`
  const filepath = path.join(deploymentsDir, filename)

  if (!fs.existsSync(filepath)) {
    throw new Error(`Deployment file not found: ${filepath}`)
  }

  const deploymentInfo: DeploymentInfo = JSON.parse(fs.readFileSync(filepath, "utf8"))

  // Verify PancakeSwapAdapter
  console.log("\n1. Verifying PancakeSwapAdapter...")
  const wbnbAddress = network.name === "bscTestnet" ? BSC_TESTNET_WBNB : BSC_WBNB
  try {
    await run("verify:verify", {
      address: deploymentInfo.contracts.PancakeSwapAdapter,
      constructorArguments: [BSC_UNIVERSAL_ROUTER, wbnbAddress],
    })
    console.log("   PancakeSwapAdapter verified!")
  } catch (error: any) {
    if (error.message.includes("Already Verified")) {
      console.log("   PancakeSwapAdapter already verified")
    } else {
      console.error("   Error:", error.message)
    }
  }

  // Verify HPPropTrading Implementation
  console.log("\n2. Verifying HPPropTrading Implementation...")
  try {
    await run("verify:verify", {
      address: deploymentInfo.contracts.HPPropTrading_Implementation,
      constructorArguments: [],
    })
    console.log("   HPPropTrading Implementation verified!")
  } catch (error: any) {
    if (error.message.includes("Already Verified")) {
      console.log("   HPPropTrading Implementation already verified")
    } else {
      console.error("   Error:", error.message)
    }
  }

  console.log("\n========== Verification Complete ==========")
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
