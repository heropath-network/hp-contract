import { ethers, network } from "hardhat"
import * as fs from "fs"
import * as path from "path"

export interface DeploymentContracts {
  HPPropTrading_Proxy?: string
  HPPropTrading_Implementation?: string
  ProxyAdmin?: string
  PancakeSwapAdapter?: string
}

export interface DeploymentInfo {
  network: string
  chainId: number
  deployedAt: string
  contracts: DeploymentContracts
}

export function getDeploymentsDir(): string {
  return path.join(__dirname, "..", "deployments")
}

export function getDeploymentFilePath(): string {
  return path.join(getDeploymentsDir(), `${network.name}.json`)
}

export function loadExistingDeployment(): DeploymentInfo | null {
  const filepath = getDeploymentFilePath()
  if (fs.existsSync(filepath)) {
    return JSON.parse(fs.readFileSync(filepath, "utf8"))
  }
  return null
}

export function saveDeployment(info: DeploymentInfo): void {
  const deploymentsDir = getDeploymentsDir()
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true })
  }
  const filepath = getDeploymentFilePath()
  fs.writeFileSync(filepath, JSON.stringify(info, null, 2))
  console.log("Deployment info saved to:", filepath)
}

export async function isContractDeployed(address: string): Promise<boolean> {
  const code = await ethers.provider.getCode(address)
  return code !== "0x"
}

export interface DeploymentStatus {
  info: DeploymentInfo
  proxyDeployed: boolean
  adapterDeployed: boolean
  allDeployed: boolean
}

/**
 * Check deployment status - returns partial deployment info if any contracts exist
 */
export async function checkDeploymentStatus(): Promise<DeploymentStatus | null> {
  const existing = loadExistingDeployment()
  if (!existing) {
    return null
  }

  console.log("\n⚠️  Found existing deployment, verifying on-chain...")

  const proxyDeployed = existing.contracts.HPPropTrading_Proxy
    ? await isContractDeployed(existing.contracts.HPPropTrading_Proxy)
    : false
  const adapterDeployed = existing.contracts.PancakeSwapAdapter
    ? await isContractDeployed(existing.contracts.PancakeSwapAdapter)
    : false

  const allDeployed = proxyDeployed && adapterDeployed

  if (allDeployed) {
    console.log("✅ All contracts already deployed and verified on-chain!")
    console.log("\n========== Existing Deployment ==========")
    console.log("HPPropTrading Proxy:", existing.contracts.HPPropTrading_Proxy)
    console.log("HPPropTrading Implementation:", existing.contracts.HPPropTrading_Implementation)
    console.log("ProxyAdmin:", existing.contracts.ProxyAdmin)
    console.log("PancakeSwapAdapter:", existing.contracts.PancakeSwapAdapter)
    console.log("Deployed at:", existing.deployedAt)
    console.log("=========================================\n")
    console.log("To redeploy, delete deployments/" + network.name + ".json first.")
  } else if (proxyDeployed) {
    console.log("⚡ HPPropTrading deployed, continuing with remaining contracts...")
  }

  return { info: existing, proxyDeployed, adapterDeployed, allDeployed }
}

/**
 * Check if all contracts are deployed (legacy function for backwards compatibility)
 */
export async function checkExistingDeployment(): Promise<DeploymentInfo | null> {
  const status = await checkDeploymentStatus()
  return status?.allDeployed ? status.info : null
}
