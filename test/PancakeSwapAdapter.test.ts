import { expect } from "chai"
import { ethers, upgrades } from "hardhat"
import { HPPropTrading, PancakeSwapAdapter, MockERC20, MockUniversalRouter } from "../typechain-types"
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers"

describe("PancakeSwapAdapter", function () {
  let hpPropTrading: HPPropTrading
  let pancakeAdapter: PancakeSwapAdapter
  let mockRouter: MockUniversalRouter
  let mockToken: MockERC20
  let mockWBNB: MockERC20
  let admin: SignerWithAddress
  let allocator: SignerWithAddress
  let user: SignerWithAddress

  const PANCAKE_ADAPTER_ID = ethers.keccak256(ethers.toUtf8Bytes("PANCAKESWAP"))

  beforeEach(async function () {
    ;[admin, allocator, user] = await ethers.getSigners()

    // Deploy mock tokens
    const MockERC20Factory = await ethers.getContractFactory("MockERC20")
    mockToken = (await MockERC20Factory.deploy("Mock USDT", "USDT", 18)) as unknown as MockERC20
    await mockToken.waitForDeployment()

    mockWBNB = (await MockERC20Factory.deploy("Wrapped BNB", "WBNB", 18)) as unknown as MockERC20
    await mockWBNB.waitForDeployment()

    // Deploy mock Universal Router
    const MockUniversalRouterFactory = await ethers.getContractFactory("MockUniversalRouter")
    mockRouter = (await MockUniversalRouterFactory.deploy(await mockWBNB.getAddress())) as unknown as MockUniversalRouter
    await mockRouter.waitForDeployment()

    // Deploy HPPropTrading with proxy first (needed for adapter authorization)
    const HPPropTradingFactory = await ethers.getContractFactory("HPPropTrading", admin)
    hpPropTrading = (await upgrades.deployProxy(HPPropTradingFactory, [], {
      initializer: "initialize",
      kind: "transparent",
    })) as unknown as HPPropTrading
    await hpPropTrading.waitForDeployment()

    // Deploy PancakeSwapAdapter with HPPropTrading as authorized caller
    const PancakeSwapAdapterFactory = await ethers.getContractFactory("PancakeSwapAdapter")
    pancakeAdapter = (await PancakeSwapAdapterFactory.deploy(
      await mockRouter.getAddress(),
      await mockWBNB.getAddress(),
      await hpPropTrading.getAddress()
    )) as unknown as PancakeSwapAdapter
    await pancakeAdapter.waitForDeployment()
  })

  describe("Deployment", function () {
    it("should have correct ADAPTER_ID", async function () {
      expect(await pancakeAdapter.ADAPTER_ID()).to.equal(PANCAKE_ADAPTER_ID)
    })

    it("should have correct universalRouter address", async function () {
      expect(await pancakeAdapter.universalRouter()).to.equal(await mockRouter.getAddress())
    })

    it("should have correct wbnb address", async function () {
      expect(await pancakeAdapter.wbnb()).to.equal(await mockWBNB.getAddress())
    })

    it("should have correct authorizedCaller address", async function () {
      expect(await pancakeAdapter.authorizedCaller()).to.equal(await hpPropTrading.getAddress())
    })

    it("should revert deployment with zero router address", async function () {
      const PancakeSwapAdapterFactory = await ethers.getContractFactory("PancakeSwapAdapter")
      await expect(
        PancakeSwapAdapterFactory.deploy(ethers.ZeroAddress, await mockWBNB.getAddress(), admin.address)
      ).to.be.revertedWith("Invalid address")
    })

    it("should revert deployment with zero wbnb address", async function () {
      const PancakeSwapAdapterFactory = await ethers.getContractFactory("PancakeSwapAdapter")
      await expect(
        PancakeSwapAdapterFactory.deploy(await mockRouter.getAddress(), ethers.ZeroAddress, admin.address)
      ).to.be.revertedWith("Invalid address")
    })
  })

  describe("Authorization", function () {
    it("should revert swap from unauthorized caller", async function () {
      await expect(
        pancakeAdapter.connect(user).swap(
          await mockToken.getAddress(),
          await mockWBNB.getAddress(),
          ethers.parseEther("100"),
          0,
          "0x"
        )
      ).to.be.revertedWith("Unauthorized")
    })

    it("should allow owner to update authorizedCaller", async function () {
      await pancakeAdapter.connect(admin).setAuthorizedCaller(user.address)
      expect(await pancakeAdapter.authorizedCaller()).to.equal(user.address)
    })

    it("should revert setAuthorizedCaller from non-owner", async function () {
      await expect(
        pancakeAdapter.connect(user).setAuthorizedCaller(user.address)
      ).to.be.reverted
    })
  })

  describe("Swap Execution via HPPropTrading", function () {
    beforeEach(async function () {
      // Register PancakeSwapAdapter
      await hpPropTrading.connect(admin).registerAdapter(PANCAKE_ADAPTER_ID, await pancakeAdapter.getAddress())

      // Grant allocator role
      const ALLOCATOR_ROLE = await hpPropTrading.ALLOCATOR_ROLE()
      await hpPropTrading.connect(admin).grantRole(ALLOCATOR_ROLE, allocator.address)

      // Deposit ERC20 funds to HPPropTrading
      const amount = ethers.parseEther("1000")
      await mockToken.mint(user.address, amount)
      await mockToken.connect(user).approve(await hpPropTrading.getAddress(), amount)
      await hpPropTrading.connect(user).depositToken(await mockToken.getAddress(), amount)

      // Pre-fund mock router with output tokens for swap simulation
      await mockWBNB.mint(await mockRouter.getAddress(), ethers.parseEther("1000"))
    })

    it("should allow ALLOCATOR to execute swap via PancakeSwapAdapter", async function () {
      const amountIn = ethers.parseEther("100")
      const minAmountOut = ethers.parseEther("90")
      const deadline = Math.floor(Date.now() / 1000) + 3600

      // Encode extraData for Universal Router
      // V2_SWAP_EXACT_IN command (0x08)
      const commands = "0x08"
      const path = [await mockToken.getAddress(), await mockWBNB.getAddress()]
      const inputs = [
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "uint256", "address[]", "bool"],
          [await pancakeAdapter.getAddress(), amountIn, minAmountOut, path, false]
        ),
      ]
      const extraData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes[]", "uint256"],
        [commands, inputs, deadline]
      )

      // Execute swap
      await hpPropTrading
        .connect(allocator)
        .executeSwap(PANCAKE_ADAPTER_ID, await mockToken.getAddress(), await mockWBNB.getAddress(), amountIn, minAmountOut, extraData)
    })

    it("should revert swap for non-ALLOCATOR", async function () {
      const amountIn = ethers.parseEther("100")
      const extraData = "0x"
      await expect(
        hpPropTrading
          .connect(user)
          .executeSwap(PANCAKE_ADAPTER_ID, await mockToken.getAddress(), ethers.ZeroAddress, amountIn, 0, extraData)
      ).to.be.reverted
    })
  })
})
