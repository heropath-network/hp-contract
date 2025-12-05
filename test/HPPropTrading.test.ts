import { expect } from "chai"
import { ethers, upgrades } from "hardhat"
import { HPPropTrading, PancakeSwapAdapter, MockERC20, MockUniversalRouter } from "../typechain-types"
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers"

describe("HPPropTrading", function () {
  let hpPropTrading: HPPropTrading
  let pancakeAdapter: PancakeSwapAdapter
  let mockRouter: MockUniversalRouter
  let mockToken: MockERC20
  let mockWBNB: MockERC20
  let admin: SignerWithAddress
  let dao: SignerWithAddress
  let allocator: SignerWithAddress
  let user: SignerWithAddress

  // Use the same ADAPTER_ID as PancakeSwapAdapter
  const PANCAKE_ADAPTER_ID = ethers.keccak256(ethers.toUtf8Bytes("PANCAKESWAP"))

  beforeEach(async function () {
    ;[admin, dao, allocator, user] = await ethers.getSigners()

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

  describe("Initialization", function () {
    it("should set admin with all roles", async function () {
      const DEFAULT_ADMIN_ROLE = await hpPropTrading.DEFAULT_ADMIN_ROLE()
      const HP_DAO_ROLE = await hpPropTrading.HP_DAO_ROLE()
      const ALLOCATOR_ROLE = await hpPropTrading.ALLOCATOR_ROLE()

      expect(await hpPropTrading.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true
      expect(await hpPropTrading.hasRole(HP_DAO_ROLE, admin.address)).to.be.true
      expect(await hpPropTrading.hasRole(ALLOCATOR_ROLE, admin.address)).to.be.true
    })

    it("should not allow re-initialization", async function () {
      await expect(hpPropTrading.initialize()).to.be.reverted
    })
  })

  describe("Role Management", function () {
    it("should allow admin to grant HP_DAO_ROLE", async function () {
      const HP_DAO_ROLE = await hpPropTrading.HP_DAO_ROLE()
      await hpPropTrading.connect(admin).grantRole(HP_DAO_ROLE, dao.address)
      expect(await hpPropTrading.hasRole(HP_DAO_ROLE, dao.address)).to.be.true
    })

    it("should allow admin to grant ALLOCATOR_ROLE", async function () {
      const ALLOCATOR_ROLE = await hpPropTrading.ALLOCATOR_ROLE()
      await hpPropTrading.connect(admin).grantRole(ALLOCATOR_ROLE, allocator.address)
      expect(await hpPropTrading.hasRole(ALLOCATOR_ROLE, allocator.address)).to.be.true
    })
  })

  describe("Fund Module - Deposits", function () {
    it("should accept BNB deposits via deposit()", async function () {
      const amount = ethers.parseEther("1.0")
      await hpPropTrading.connect(user).deposit({ value: amount })
      expect(await hpPropTrading.getBalance(ethers.ZeroAddress)).to.equal(amount)
    })

    it("should accept BNB via receive()", async function () {
      const amount = ethers.parseEther("1.0")
      await user.sendTransaction({
        to: await hpPropTrading.getAddress(),
        value: amount,
      })
      expect(await hpPropTrading.getBalance(ethers.ZeroAddress)).to.equal(amount)
    })

    it("should accept ERC20 deposits", async function () {
      const amount = ethers.parseEther("100")
      await mockToken.mint(user.address, amount)
      await mockToken.connect(user).approve(await hpPropTrading.getAddress(), amount)
      await hpPropTrading.connect(user).depositToken(await mockToken.getAddress(), amount)
      expect(await hpPropTrading.getBalance(await mockToken.getAddress())).to.equal(amount)
    })
  })

  describe("Fund Module - Withdrawals", function () {
    beforeEach(async function () {
      // Deposit some funds
      await hpPropTrading.connect(user).deposit({ value: ethers.parseEther("10") })
      const amount = ethers.parseEther("1000")
      await mockToken.mint(user.address, amount)
      await mockToken.connect(user).approve(await hpPropTrading.getAddress(), amount)
      await hpPropTrading.connect(user).depositToken(await mockToken.getAddress(), amount)
    })

    it("should allow HP_DAO to withdraw BNB", async function () {
      const amount = ethers.parseEther("5")
      const balanceBefore = await ethers.provider.getBalance(dao.address)
      await hpPropTrading.connect(admin).withdraw(ethers.ZeroAddress, amount, dao.address)
      const balanceAfter = await ethers.provider.getBalance(dao.address)
      expect(balanceAfter - balanceBefore).to.equal(amount)
    })

    it("should allow HP_DAO to withdraw ERC20", async function () {
      const amount = ethers.parseEther("500")
      await hpPropTrading.connect(admin).withdraw(await mockToken.getAddress(), amount, dao.address)
      expect(await mockToken.balanceOf(dao.address)).to.equal(amount)
    })

    it("should revert withdrawal for non-HP_DAO", async function () {
      const amount = ethers.parseEther("1")
      await expect(hpPropTrading.connect(user).withdraw(ethers.ZeroAddress, amount, user.address)).to.be.reverted
    })

    it("should revert if insufficient balance", async function () {
      const amount = ethers.parseEther("100") // More than deposited
      await expect(
        hpPropTrading.connect(admin).withdraw(ethers.ZeroAddress, amount, admin.address)
      ).to.be.revertedWith("Insufficient balance")
    })
  })

  describe("Aggregator Module - Adapter Management", function () {
    it("should allow admin to register PancakeSwapAdapter", async function () {
      await hpPropTrading.connect(admin).registerAdapter(PANCAKE_ADAPTER_ID, await pancakeAdapter.getAddress())
      expect(await hpPropTrading.getAdapter(PANCAKE_ADAPTER_ID)).to.equal(await pancakeAdapter.getAddress())
    })

    it("should verify adapter's ADAPTER_ID matches", async function () {
      const adapterIdFromContract = await pancakeAdapter.ADAPTER_ID()
      expect(adapterIdFromContract).to.equal(PANCAKE_ADAPTER_ID)
    })

    it("should revert if adapter already exists", async function () {
      await hpPropTrading.connect(admin).registerAdapter(PANCAKE_ADAPTER_ID, await pancakeAdapter.getAddress())
      await expect(
        hpPropTrading.connect(admin).registerAdapter(PANCAKE_ADAPTER_ID, await pancakeAdapter.getAddress())
      ).to.be.revertedWith("Adapter already exists")
    })

    it("should allow admin to remove adapter", async function () {
      await hpPropTrading.connect(admin).registerAdapter(PANCAKE_ADAPTER_ID, await pancakeAdapter.getAddress())
      await hpPropTrading.connect(admin).removeAdapter(PANCAKE_ADAPTER_ID)
      expect(await hpPropTrading.getAdapter(PANCAKE_ADAPTER_ID)).to.equal(ethers.ZeroAddress)
    })

    it("should revert if removing non-existent adapter", async function () {
      await expect(hpPropTrading.connect(admin).removeAdapter(PANCAKE_ADAPTER_ID)).to.be.revertedWith("Adapter not found")
    })

    it("should track adapter IDs correctly", async function () {
      const adapterId2 = ethers.keccak256(ethers.toUtf8Bytes("ADAPTER_2"))
      await hpPropTrading.connect(admin).registerAdapter(PANCAKE_ADAPTER_ID, await pancakeAdapter.getAddress())
      await hpPropTrading.connect(admin).registerAdapter(adapterId2, await pancakeAdapter.getAddress())

      const ids = await hpPropTrading.getAdapterIds()
      expect(ids.length).to.equal(2)
      expect(ids).to.include(PANCAKE_ADAPTER_ID)
      expect(ids).to.include(adapterId2)
    })
  })

  describe("Aggregator Module - Swap Execution with PancakeSwapAdapter", function () {
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

    it("should revert if adapter not found", async function () {
      const fakeAdapterId = ethers.keccak256(ethers.toUtf8Bytes("FAKE"))
      await expect(
        hpPropTrading
          .connect(allocator)
          .executeSwap(fakeAdapterId, await mockToken.getAddress(), ethers.ZeroAddress, 100, 0, "0x")
      ).to.be.revertedWith("Adapter not found")
    })
  })

  describe("PancakeSwapAdapter", function () {
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

    it("should revert deployment with zero address", async function () {
      const PancakeSwapAdapterFactory = await ethers.getContractFactory("PancakeSwapAdapter")
      await expect(
        PancakeSwapAdapterFactory.deploy(ethers.ZeroAddress, await mockWBNB.getAddress(), admin.address)
      ).to.be.revertedWith("Invalid address")

      await expect(
        PancakeSwapAdapterFactory.deploy(await mockRouter.getAddress(), ethers.ZeroAddress, admin.address)
      ).to.be.revertedWith("Invalid address")
    })

    it("should revert swap from unauthorized caller", async function () {
      // Try to call swap directly (not through HPPropTrading)
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
})
