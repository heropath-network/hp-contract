import { run, network } from "hardhat"
import { loadExistingDeployment } from "./deployTools"

// BSC Mainnet addresses
const BSC_UNIVERSAL_ROUTER = "0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB"
const BSC_WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"

async function main() {
  console.log("Verifying contracts on", network.name)

  // Load deployment info
  const deployment = loadExistingDeployment()
  if (!deployment) {
    throw new Error("No deployment found. Run deploy.ts first.")
  }

  // Verify PancakeSwapAdapter (3 constructor args: router, wbnb, authorizedCaller)
  console.log("\n1. Verifying PancakeSwapAdapter...")
  try {
    await run("verify:verify", {
      address: deployment.contracts.PancakeSwapAdapter,
      constructorArguments: [
        BSC_UNIVERSAL_ROUTER,
        BSC_WBNB,
        deployment.contracts.HPPropTrading_Proxy,
      ],
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
      address: deployment.contracts.HPPropTrading_Implementation,
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
