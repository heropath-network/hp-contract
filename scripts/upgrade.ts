import { ethers, upgrades, network } from "hardhat"
import * as fs from "fs"
import * as path from "path"

interface DeploymentInfo {
  network: string
  chainId: number
  deployedAt: string
  contracts: {
    HPPropTrading_Proxy: string
    HPPropTrading_Implementation: string
    ProxyAdmin: string
    PancakeSwapAdapter: string
  }
}

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log("Upgrading contracts with account:", deployer.address)
  console.log("Network:", network.name)

  // 1. Load existing deployment
  const deploymentsDir = path.join(__dirname, "..", "deployments")
  const filename = `${network.name}.json`
  const filepath = path.join(deploymentsDir, filename)

  if (!fs.existsSync(filepath)) {
    throw new Error(`Deployment file not found: ${filepath}`)
  }

  const deploymentInfo: DeploymentInfo = JSON.parse(fs.readFileSync(filepath, "utf8"))
  const proxyAddress = deploymentInfo.contracts.HPPropTrading_Proxy

  console.log("\n1. Current deployment info:")
  console.log("   Proxy:", proxyAddress)
  console.log("   Old Implementation:", deploymentInfo.contracts.HPPropTrading_Implementation)

  // 2. Get new implementation contract factory
  console.log("\n2. Preparing new implementation...")
  const HPPropTradingV2 = await ethers.getContractFactory("HPPropTrading")

  // 3. Upgrade
  console.log("\n3. Upgrading proxy...")
  const upgraded = await upgrades.upgradeProxy(proxyAddress, HPPropTradingV2)
  await upgraded.waitForDeployment()

  // 4. Get new implementation address
  const newImplementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress)
  console.log("   New Implementation:", newImplementationAddress)

  // 5. Update deployment info
  deploymentInfo.contracts.HPPropTrading_Implementation = newImplementationAddress
  deploymentInfo.deployedAt = new Date().toISOString()
  fs.writeFileSync(filepath, JSON.stringify(deploymentInfo, null, 2))
  console.log("\n4. Deployment info updated:", filepath)

  // 6. Verify upgrade was successful
  console.log("\n5. Verifying upgrade...")
  const hpPropTrading = await ethers.getContractAt("HPPropTrading", proxyAddress)

  // Check roles still work
  const DEFAULT_ADMIN_ROLE = await hpPropTrading.DEFAULT_ADMIN_ROLE()
  const hasAdminRole = await hpPropTrading.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)
  console.log("   Admin role preserved:", hasAdminRole)

  // Check adapters still registered
  const adapterIds = await hpPropTrading.getAdapterIds()
  console.log("   Registered adapters:", adapterIds.length)

  console.log("\n========== Upgrade Complete ==========")
  console.log("Proxy (unchanged):", proxyAddress)
  console.log("New Implementation:", newImplementationAddress)
  console.log("=======================================\n")
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
