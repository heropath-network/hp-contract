import { expect } from "chai"
import { ethers, upgrades } from "hardhat"
import { HPPropTrading, MockERC20 } from "../typechain-types"
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers"

describe("HPPropTrading", function () {
  let hpPropTrading: HPPropTrading
  let mockToken: MockERC20
  let admin: SignerWithAddress
  let dao: SignerWithAddress
  let executor: SignerWithAddress
  let user: SignerWithAddress

  const MOCK_ADAPTER_ID = ethers.keccak256(ethers.toUtf8Bytes("MOCK_ADAPTER"))

  beforeEach(async function () {
    ;[admin, dao, executor, user] = await ethers.getSigners()

    // Deploy mock token
    const MockERC20Factory = await ethers.getContractFactory("MockERC20")
    mockToken = (await MockERC20Factory.deploy("Mock USDT", "USDT", 18)) as unknown as MockERC20
    await mockToken.waitForDeployment()

    // Deploy HPPropTrading with proxy
    const HPPropTradingFactory = await ethers.getContractFactory("HPPropTrading", admin)
    hpPropTrading = (await upgrades.deployProxy(HPPropTradingFactory, [], {
      initializer: "initialize",
      kind: "transparent",
    })) as unknown as HPPropTrading
    await hpPropTrading.waitForDeployment()
  })

  describe("Initialization", function () {
    it("should set admin with all roles", async function () {
      const DEFAULT_ADMIN_ROLE = await hpPropTrading.DEFAULT_ADMIN_ROLE()
      const HP_DAO_ROLE = await hpPropTrading.HP_DAO_ROLE()
      const EXECUTOR_ROLE = await hpPropTrading.EXECUTOR_ROLE()

      expect(await hpPropTrading.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true
      expect(await hpPropTrading.hasRole(HP_DAO_ROLE, admin.address)).to.be.true
      expect(await hpPropTrading.hasRole(EXECUTOR_ROLE, admin.address)).to.be.true
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

    it("should allow admin to grant EXECUTOR_ROLE", async function () {
      const EXECUTOR_ROLE = await hpPropTrading.EXECUTOR_ROLE()
      await hpPropTrading.connect(admin).grantRole(EXECUTOR_ROLE, executor.address)
      expect(await hpPropTrading.hasRole(EXECUTOR_ROLE, executor.address)).to.be.true
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
    it("should allow admin to register adapter", async function () {
      await hpPropTrading.connect(admin).registerAdapter(MOCK_ADAPTER_ID, user.address)
      expect(await hpPropTrading.getAdapter(MOCK_ADAPTER_ID)).to.equal(user.address)
    })

    it("should revert if adapter already exists", async function () {
      await hpPropTrading.connect(admin).registerAdapter(MOCK_ADAPTER_ID, user.address)
      await expect(
        hpPropTrading.connect(admin).registerAdapter(MOCK_ADAPTER_ID, user.address)
      ).to.be.revertedWith("Adapter already exists")
    })

    it("should allow admin to remove adapter", async function () {
      await hpPropTrading.connect(admin).registerAdapter(MOCK_ADAPTER_ID, user.address)
      await hpPropTrading.connect(admin).removeAdapter(MOCK_ADAPTER_ID)
      expect(await hpPropTrading.getAdapter(MOCK_ADAPTER_ID)).to.equal(ethers.ZeroAddress)
    })

    it("should revert if removing non-existent adapter", async function () {
      await expect(hpPropTrading.connect(admin).removeAdapter(MOCK_ADAPTER_ID)).to.be.revertedWith("Adapter not found")
    })

    it("should track adapter IDs correctly", async function () {
      const adapterId2 = ethers.keccak256(ethers.toUtf8Bytes("ADAPTER_2"))
      await hpPropTrading.connect(admin).registerAdapter(MOCK_ADAPTER_ID, user.address)
      await hpPropTrading.connect(admin).registerAdapter(adapterId2, dao.address)

      const ids = await hpPropTrading.getAdapterIds()
      expect(ids.length).to.equal(2)
      expect(ids).to.include(MOCK_ADAPTER_ID)
      expect(ids).to.include(adapterId2)
    })

    it("should revert execute if adapter not found", async function () {
      const fakeAdapterId = ethers.keccak256(ethers.toUtf8Bytes("FAKE"))
      await expect(
        hpPropTrading.connect(admin).execute(fakeAdapterId, "0x")
      ).to.be.revertedWith("Adapter not found")
    })

    it("should revert execute for non-EXECUTOR", async function () {
      await hpPropTrading.connect(admin).registerAdapter(MOCK_ADAPTER_ID, user.address)
      await expect(
        hpPropTrading.connect(user).execute(MOCK_ADAPTER_ID, "0x")
      ).to.be.reverted
    })
  })
})
