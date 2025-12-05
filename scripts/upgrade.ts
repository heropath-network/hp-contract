import { ethers, upgrades, network } from "hardhat"
import { DeploymentInfo, loadExistingDeployment, saveDeployment } from "./deployTools"

// BSC Mainnet addresses
const BSC_UNIVERSAL_ROUTER = "0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB"
const BSC_WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"

// Global deployment state
let deployment: DeploymentInfo

/**
 * Upgrade HPPropTrading (proxy upgrade)
 */
async function upgradeFund() {
  const [deployer] = await ethers.getSigners()
  const proxyAddress = deployment.contracts.HPPropTrading_Proxy!

  console.log("\n========== Upgrading HPPropTrading ==========")
  console.log("Proxy:", proxyAddress)
  console.log("Old Implementation:", deployment.contracts.HPPropTrading_Implementation)

  const HPPropTradingV2 = await ethers.getContractFactory("HPPropTrading")
  const upgraded = await upgrades.upgradeProxy(proxyAddress, HPPropTradingV2)
  await upgraded.waitForDeployment()

  const newImplementation = await upgrades.erc1967.getImplementationAddress(proxyAddress)
  deployment.contracts.HPPropTrading_Implementation = newImplementation
  deployment.deployedAt = new Date().toISOString()
  console.log("New Implementation:", newImplementation)

  // Verify upgrade
  const hpPropTrading = await ethers.getContractAt("HPPropTrading", proxyAddress)
  const DEFAULT_ADMIN_ROLE = await hpPropTrading.DEFAULT_ADMIN_ROLE()
  console.log("Admin role preserved:", await hpPropTrading.hasRole(DEFAULT_ADMIN_ROLE, deployer.address))
  console.log("Registered adapters:", (await hpPropTrading.getAdapterIds()).length)
}

/**
 * Upgrade PancakeSwapAdapter (redeploy & re-register)
 * Note: PancakeSwapAdapter is not upgradeable, so we deploy new and swap registration
 */
async function upgradeAdapter() {
  const proxyAddress = deployment.contracts.HPPropTrading_Proxy!
  const oldAdapterAddress = deployment.contracts.PancakeSwapAdapter

  console.log("\n========== Upgrading PancakeSwapAdapter ==========")
  console.log("Old Adapter:", oldAdapterAddress)

  // Deploy new adapter
  const PancakeSwapAdapter = await ethers.getContractFactory("PancakeSwapAdapter")
  const newAdapter = await PancakeSwapAdapter.deploy(BSC_UNIVERSAL_ROUTER, BSC_WBNB, proxyAddress)
  await newAdapter.waitForDeployment()
  const newAdapterAddress = await newAdapter.getAddress()
  console.log("New Adapter:", newAdapterAddress)

  // Get adapter ID
  const adapterId = await newAdapter.ADAPTER_ID()
  const hpPropTrading = await ethers.getContractAt("HPPropTrading", proxyAddress)

  // Remove old adapter if exists
  const registeredAdapter = await hpPropTrading.getAdapter(adapterId)
  if (registeredAdapter !== ethers.ZeroAddress) {
    console.log("Removing old adapter registration...")
    const removeTx = await hpPropTrading.removeAdapter(adapterId)
    await removeTx.wait()
  }

  // Register new adapter
  console.log("Registering new adapter...")
  const registerTx = await hpPropTrading.registerAdapter(newAdapterAddress)
  await registerTx.wait()

  deployment.contracts.PancakeSwapAdapter = newAdapterAddress
  deployment.deployedAt = new Date().toISOString()
  console.log("PancakeSwapAdapter upgraded!")
}

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log("Upgrading contracts with account:", deployer.address)
  console.log("Network:", network.name)

  deployment = loadExistingDeployment()!
  if (!deployment || !deployment.contracts.HPPropTrading_Proxy) {
    throw new Error("No deployment found. Run deploy.ts first.")
  }

  try {
    // await upgradeFund()
    // await upgradeAdapter()
  } finally {
    saveDeployment(deployment)
  }

  console.log("\n========== Upgrade Summary ==========")
  console.log("HPPropTrading Proxy:", deployment.contracts.HPPropTrading_Proxy)
  console.log("HPPropTrading Implementation:", deployment.contracts.HPPropTrading_Implementation)
  console.log("PancakeSwapAdapter:", deployment.contracts.PancakeSwapAdapter)
  console.log("=====================================\n")
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
