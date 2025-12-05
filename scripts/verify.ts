import { run, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

interface DeploymentInfo {
  contracts: {
    HPPropTrading_Proxy: string;
    HPPropTrading_Implementation: string;
    ProxyAdmin: string;
    PancakeSwapAdapter: string;
  };
}

async function main() {
  console.log("Verifying contracts on", network.name);

  // Load deployment info
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const filename = `${network.name}.json`;
  const filepath = path.join(deploymentsDir, filename);

  if (!fs.existsSync(filepath)) {
    throw new Error(`Deployment file not found: ${filepath}`);
  }

  const deploymentInfo: DeploymentInfo = JSON.parse(fs.readFileSync(filepath, "utf8"));

  // Verify PancakeSwapAdapter
  console.log("\n1. Verifying PancakeSwapAdapter...");
  try {
    await run("verify:verify", {
      address: deploymentInfo.contracts.PancakeSwapAdapter,
      constructorArguments: [],
    });
    console.log("   PancakeSwapAdapter verified!");
  } catch (error: any) {
    if (error.message.includes("Already Verified")) {
      console.log("   PancakeSwapAdapter already verified");
    } else {
      console.error("   Error:", error.message);
    }
  }

  // Verify HPPropTrading Implementation
  console.log("\n2. Verifying HPPropTrading Implementation...");
  try {
    await run("verify:verify", {
      address: deploymentInfo.contracts.HPPropTrading_Implementation,
      constructorArguments: [],
    });
    console.log("   HPPropTrading Implementation verified!");
  } catch (error: any) {
    if (error.message.includes("Already Verified")) {
      console.log("   HPPropTrading Implementation already verified");
    } else {
      console.error("   Error:", error.message);
    }
  }

  console.log("\n========== Verification Complete ==========");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
