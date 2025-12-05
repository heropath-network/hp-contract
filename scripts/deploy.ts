import { ethers, upgrades, network } from "hardhat"
import * as fs from "fs"
import * as path from "path"

// Computed locally for logging, but we read from contract to ensure consistency
const PANCAKE_ADAPTER_ID = ethers.keccak256(ethers.toUtf8Bytes("PANCAKESWAP"))

// BSC Mainnet addresses
const BSC_UNIVERSAL_ROUTER = "0xd9C500DfF816a1Da21A48A732d3498Bf09dc9AEB"
const BSC_WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"

// BSC Testnet addresses (same router, different WBNB)
const BSC_TESTNET_WBNB = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd"

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
  console.log("Deploying contracts with account:", deployer.address)
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)))
  console.log("Network:", network.name, "ChainId:", (await ethers.provider.getNetwork()).chainId)

  // 1. Deploy PancakeSwapAdapter
  console.log("\n1. Deploying PancakeSwapAdapter...")
  const wbnbAddress = network.name === "bscTestnet" ? BSC_TESTNET_WBNB : BSC_WBNB
  console.log("   Using WBNB:", wbnbAddress)
  console.log("   Using Universal Router:", BSC_UNIVERSAL_ROUTER)

  const PancakeSwapAdapter = await ethers.getContractFactory("PancakeSwapAdapter")
  const pancakeAdapter = await PancakeSwapAdapter.deploy(BSC_UNIVERSAL_ROUTER, wbnbAddress)
  await pancakeAdapter.waitForDeployment()
  const pancakeAdapterAddress = await pancakeAdapter.getAddress()
  console.log("   PancakeSwapAdapter deployed to:", pancakeAdapterAddress)

  // 2. Deploy HPPropTrading with Transparent Proxy
  console.log("\n2. Deploying HPPropTrading (Transparent Proxy)...")
  const HPPropTrading = await ethers.getContractFactory("HPPropTrading")
  const hpPropTrading = await upgrades.deployProxy(
    HPPropTrading,
    [], // initialize() uses msg.sender
    {
      initializer: "initialize",
      kind: "transparent",
    }
  )
  await hpPropTrading.waitForDeployment()
  const proxyAddress = await hpPropTrading.getAddress()
  console.log("   HPPropTrading Proxy deployed to:", proxyAddress)

  // Get implementation and ProxyAdmin addresses
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress)
  const proxyAdminAddress = await upgrades.erc1967.getAdminAddress(proxyAddress)
  console.log("   Implementation address:", implementationAddress)
  console.log("   ProxyAdmin address:", proxyAdminAddress)

  // 3. Register PancakeSwapAdapter
  console.log("\n3. Registering PancakeSwapAdapter...")
  const adapterId = await pancakeAdapter.ADAPTER_ID()
  console.log("   Adapter ID from contract:", adapterId)
  const tx = await hpPropTrading.registerAdapter(adapterId, pancakeAdapterAddress)
  await tx.wait()
  console.log("   PancakeSwapAdapter registered!")

  // 4. Verify roles
  console.log("\n4. Verifying roles...")
  const DEFAULT_ADMIN_ROLE = await hpPropTrading.DEFAULT_ADMIN_ROLE()
  const HP_DAO_ROLE = await hpPropTrading.HP_DAO_ROLE()
  const ALLOCATOR_ROLE = await hpPropTrading.ALLOCATOR_ROLE()

  console.log("   DEFAULT_ADMIN_ROLE:", await hpPropTrading.hasRole(DEFAULT_ADMIN_ROLE, deployer.address))
  console.log("   HP_DAO_ROLE:", await hpPropTrading.hasRole(HP_DAO_ROLE, deployer.address))
  console.log("   ALLOCATOR_ROLE:", await hpPropTrading.hasRole(ALLOCATOR_ROLE, deployer.address))

  // 5. Save deployment info
  const chainId = Number((await ethers.provider.getNetwork()).chainId)
  const deploymentInfo: DeploymentInfo = {
    network: network.name,
    chainId,
    deployedAt: new Date().toISOString(),
    contracts: {
      HPPropTrading_Proxy: proxyAddress,
      HPPropTrading_Implementation: implementationAddress,
      ProxyAdmin: proxyAdminAddress,
      PancakeSwapAdapter: pancakeAdapterAddress,
    },
  }

  const deploymentsDir = path.join(__dirname, "..", "deployments")
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true })
  }

  const filename = `${network.name}.json`
  const filepath = path.join(deploymentsDir, filename)
  fs.writeFileSync(filepath, JSON.stringify(deploymentInfo, null, 2))
  console.log("\n5. Deployment info saved to:", filepath)

  // Summary
  console.log("\n========== Deployment Summary ==========")
  console.log("HPPropTrading Proxy:", proxyAddress)
  console.log("HPPropTrading Implementation:", implementationAddress)
  console.log("ProxyAdmin:", proxyAdminAddress)
  console.log("PancakeSwapAdapter:", pancakeAdapterAddress)
  console.log("PancakeSwap Adapter ID:", adapterId)
  console.log("=========================================\n")
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
