import { ethers, upgrades, network } from "hardhat"
import { DeploymentInfo, loadExistingDeployment, saveDeployment, isContractDeployed } from "./deployTools"

// BSC Mainnet addresses
const BSC_UNIVERSAL_ROUTER = "0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB"
const BSC_WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"

// Global deployment state
let deployment: DeploymentInfo

async function deploy() {
  const [deployer] = await ethers.getSigners()

  // 1. HPPropTrading
  if (
    deployment.contracts.HPPropTrading_Proxy &&
    (await isContractDeployed(deployment.contracts.HPPropTrading_Proxy))
  ) {
    console.log("\n1. HPPropTrading already deployed:", deployment.contracts.HPPropTrading_Proxy)
  } else {
    console.log("\n1. Deploying HPPropTrading (Transparent Proxy)...")
    const HPPropTrading = await ethers.getContractFactory("HPPropTrading")
    const hpPropTrading = await upgrades.deployProxy(HPPropTrading, [], {
      initializer: "initialize",
      kind: "transparent",
    })
    await hpPropTrading.waitForDeployment()
    const proxyAddress = await hpPropTrading.getAddress()
    deployment.contracts.HPPropTrading_Proxy = proxyAddress
    deployment.contracts.HPPropTrading_Implementation = await upgrades.erc1967.getImplementationAddress(proxyAddress)
    deployment.contracts.ProxyAdmin = await upgrades.erc1967.getAdminAddress(proxyAddress)
    deployment.deployedAt = new Date().toISOString()
    console.log("   Proxy:", proxyAddress)
    console.log("   Implementation:", deployment.contracts.HPPropTrading_Implementation)
    console.log("   ProxyAdmin:", deployment.contracts.ProxyAdmin)
  }

  // 2. PancakeSwapAdapter
  if (deployment.contracts.PancakeSwapAdapter && (await isContractDeployed(deployment.contracts.PancakeSwapAdapter))) {
    console.log("\n2. PancakeSwapAdapter already deployed:", deployment.contracts.PancakeSwapAdapter)
  } else {
    console.log("\n2. Deploying PancakeSwapAdapter...")
    console.log("   Using WBNB:", BSC_WBNB)
    console.log("   Using Universal Router:", BSC_UNIVERSAL_ROUTER)
    console.log("   Authorized Caller:", deployment.contracts.HPPropTrading_Proxy)

    const PancakeSwapAdapter = await ethers.getContractFactory("PancakeSwapAdapter")
    const pancakeAdapter = await PancakeSwapAdapter.deploy(
      BSC_UNIVERSAL_ROUTER,
      BSC_WBNB,
      deployment.contracts.HPPropTrading_Proxy!
    )
    await pancakeAdapter.waitForDeployment()
    deployment.contracts.PancakeSwapAdapter = await pancakeAdapter.getAddress()
    deployment.deployedAt = new Date().toISOString()
    console.log("   PancakeSwapAdapter deployed to:", deployment.contracts.PancakeSwapAdapter)
  }

  // 3. Register PancakeSwapAdapter
  console.log("\n3. Checking adapter registration...")
  const hpPropTrading = await ethers.getContractAt("HPPropTrading", deployment.contracts.HPPropTrading_Proxy!)
  const pancakeAdapter = await ethers.getContractAt("PancakeSwapAdapter", deployment.contracts.PancakeSwapAdapter!)
  const adapterId = await pancakeAdapter.ADAPTER_ID()
  const registeredAdapter = await hpPropTrading.getAdapter(adapterId)

  if (registeredAdapter === deployment.contracts.PancakeSwapAdapter) {
    console.log("   PancakeSwapAdapter already registered")
  } else {
    console.log("   Registering PancakeSwapAdapter...")
    const tx = await hpPropTrading.registerAdapter(deployment.contracts.PancakeSwapAdapter!)
    await tx.wait()
    console.log("   PancakeSwapAdapter registered!")
  }

  // 4. Verify roles
  console.log("\n4. Verifying roles...")
  const DEFAULT_ADMIN_ROLE = await hpPropTrading.DEFAULT_ADMIN_ROLE()
  const HP_DAO_ROLE = await hpPropTrading.HP_DAO_ROLE()
  const EXECUTOR_ROLE = await hpPropTrading.EXECUTOR_ROLE()

  console.log("   DEFAULT_ADMIN_ROLE:", await hpPropTrading.hasRole(DEFAULT_ADMIN_ROLE, deployer.address))
  console.log("   HP_DAO_ROLE:", await hpPropTrading.hasRole(HP_DAO_ROLE, deployer.address))
  console.log("   EXECUTOR_ROLE:", await hpPropTrading.hasRole(EXECUTOR_ROLE, deployer.address))
}

async function main() {
  const [deployer] = await ethers.getSigners()
  const chainId = Number((await ethers.provider.getNetwork()).chainId)
  console.log("Deploying contracts with account:", deployer.address)

  // Load existing deployment or create new
  deployment = loadExistingDeployment() || {
    network: network.name,
    chainId,
    deployedAt: new Date().toISOString(),
    contracts: {},
  }

  try {
    await deploy()
  } finally {
    saveDeployment(deployment)
  }

  // Summary
  console.log("\n========== Deployment Summary ==========")
  console.log("HPPropTrading Proxy:", deployment.contracts.HPPropTrading_Proxy)
  console.log("HPPropTrading Implementation:", deployment.contracts.HPPropTrading_Implementation)
  console.log("ProxyAdmin:", deployment.contracts.ProxyAdmin)
  console.log("PancakeSwapAdapter:", deployment.contracts.PancakeSwapAdapter)
  console.log("=========================================\n")
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
