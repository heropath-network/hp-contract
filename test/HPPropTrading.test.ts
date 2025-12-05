import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { HPPropTrading, MockAdapter, MockERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("HPPropTrading", function () {
  let hpPropTrading: HPPropTrading;
  let mockAdapter: MockAdapter;
  let mockToken: MockERC20;
  let admin: SignerWithAddress;
  let dao: SignerWithAddress;
  let allocator: SignerWithAddress;
  let user: SignerWithAddress;

  const ADAPTER_ID = ethers.keccak256(ethers.toUtf8Bytes("MOCK_ADAPTER"));

  beforeEach(async function () {
    [admin, dao, allocator, user] = await ethers.getSigners();

    // Deploy mock token
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    mockToken = await MockERC20Factory.deploy("Mock USDT", "USDT", 18);
    await mockToken.waitForDeployment();

    // Deploy mock adapter
    const MockAdapterFactory = await ethers.getContractFactory("MockAdapter");
    mockAdapter = await MockAdapterFactory.deploy();
    await mockAdapter.waitForDeployment();

    // Deploy HPPropTrading with proxy
    const HPPropTradingFactory = await ethers.getContractFactory("HPPropTrading");
    hpPropTrading = (await upgrades.deployProxy(HPPropTradingFactory, [admin.address], {
      initializer: "initialize",
      kind: "transparent",
    })) as unknown as HPPropTrading;
    await hpPropTrading.waitForDeployment();
  });

  describe("Initialization", function () {
    it("should set admin with all roles", async function () {
      const DEFAULT_ADMIN_ROLE = await hpPropTrading.DEFAULT_ADMIN_ROLE();
      const HP_DAO_ROLE = await hpPropTrading.HP_DAO_ROLE();
      const ALLOCATOR_ROLE = await hpPropTrading.ALLOCATOR_ROLE();

      expect(await hpPropTrading.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
      expect(await hpPropTrading.hasRole(HP_DAO_ROLE, admin.address)).to.be.true;
      expect(await hpPropTrading.hasRole(ALLOCATOR_ROLE, admin.address)).to.be.true;
    });

    it("should revert if initialized with zero address", async function () {
      const HPPropTradingFactory = await ethers.getContractFactory("HPPropTrading");
      await expect(
        upgrades.deployProxy(HPPropTradingFactory, [ethers.ZeroAddress], {
          initializer: "initialize",
          kind: "transparent",
        })
      ).to.be.revertedWithCustomError(hpPropTrading, "InvalidAddress");
    });
  });

  describe("Role Management", function () {
    it("should allow admin to grant HP_DAO_ROLE", async function () {
      const HP_DAO_ROLE = await hpPropTrading.HP_DAO_ROLE();
      await hpPropTrading.connect(admin).grantRole(HP_DAO_ROLE, dao.address);
      expect(await hpPropTrading.hasRole(HP_DAO_ROLE, dao.address)).to.be.true;
    });

    it("should allow admin to grant ALLOCATOR_ROLE", async function () {
      const ALLOCATOR_ROLE = await hpPropTrading.ALLOCATOR_ROLE();
      await hpPropTrading.connect(admin).grantRole(ALLOCATOR_ROLE, allocator.address);
      expect(await hpPropTrading.hasRole(ALLOCATOR_ROLE, allocator.address)).to.be.true;
    });
  });

  describe("Fund Module - Deposits", function () {
    it("should accept BNB deposits via deposit()", async function () {
      const amount = ethers.parseEther("1.0");
      await hpPropTrading.connect(user).deposit({ value: amount });
      expect(await hpPropTrading.getBalance(ethers.ZeroAddress)).to.equal(amount);
    });

    it("should accept BNB via receive()", async function () {
      const amount = ethers.parseEther("1.0");
      await user.sendTransaction({
        to: await hpPropTrading.getAddress(),
        value: amount,
      });
      expect(await hpPropTrading.getBalance(ethers.ZeroAddress)).to.equal(amount);
    });

    it("should accept ERC20 deposits", async function () {
      const amount = ethers.parseEther("100");
      await mockToken.mint(user.address, amount);
      await mockToken.connect(user).approve(await hpPropTrading.getAddress(), amount);
      await hpPropTrading.connect(user).depositToken(await mockToken.getAddress(), amount);
      expect(await hpPropTrading.getBalance(await mockToken.getAddress())).to.equal(amount);
    });
  });

  describe("Fund Module - Withdrawals", function () {
    beforeEach(async function () {
      // Deposit some funds
      await hpPropTrading.connect(user).deposit({ value: ethers.parseEther("10") });
      const amount = ethers.parseEther("1000");
      await mockToken.mint(user.address, amount);
      await mockToken.connect(user).approve(await hpPropTrading.getAddress(), amount);
      await hpPropTrading.connect(user).depositToken(await mockToken.getAddress(), amount);
    });

    it("should allow HP_DAO to withdraw BNB", async function () {
      const amount = ethers.parseEther("5");
      const balanceBefore = await ethers.provider.getBalance(dao.address);
      await hpPropTrading.connect(admin).withdraw(ethers.ZeroAddress, amount, dao.address);
      const balanceAfter = await ethers.provider.getBalance(dao.address);
      expect(balanceAfter - balanceBefore).to.equal(amount);
    });

    it("should allow HP_DAO to withdraw ERC20", async function () {
      const amount = ethers.parseEther("500");
      await hpPropTrading.connect(admin).withdraw(await mockToken.getAddress(), amount, dao.address);
      expect(await mockToken.balanceOf(dao.address)).to.equal(amount);
    });

    it("should revert withdrawal for non-HP_DAO", async function () {
      const amount = ethers.parseEther("1");
      await expect(
        hpPropTrading.connect(user).withdraw(ethers.ZeroAddress, amount, user.address)
      ).to.be.reverted;
    });

    it("should revert if insufficient balance", async function () {
      const amount = ethers.parseEther("100"); // More than deposited
      await expect(
        hpPropTrading.connect(admin).withdraw(ethers.ZeroAddress, amount, admin.address)
      ).to.be.revertedWithCustomError(hpPropTrading, "InsufficientBalance");
    });
  });

  describe("Aggregator Module - Adapter Management", function () {
    it("should allow admin to register adapter", async function () {
      await hpPropTrading.connect(admin).registerAdapter(ADAPTER_ID, await mockAdapter.getAddress());
      expect(await hpPropTrading.getAdapter(ADAPTER_ID)).to.equal(await mockAdapter.getAddress());
    });

    it("should revert if adapter already exists", async function () {
      await hpPropTrading.connect(admin).registerAdapter(ADAPTER_ID, await mockAdapter.getAddress());
      await expect(
        hpPropTrading.connect(admin).registerAdapter(ADAPTER_ID, await mockAdapter.getAddress())
      ).to.be.revertedWithCustomError(hpPropTrading, "AdapterAlreadyExists");
    });

    it("should allow admin to remove adapter", async function () {
      await hpPropTrading.connect(admin).registerAdapter(ADAPTER_ID, await mockAdapter.getAddress());
      await hpPropTrading.connect(admin).removeAdapter(ADAPTER_ID);
      expect(await hpPropTrading.getAdapter(ADAPTER_ID)).to.equal(ethers.ZeroAddress);
    });

    it("should revert if removing non-existent adapter", async function () {
      await expect(
        hpPropTrading.connect(admin).removeAdapter(ADAPTER_ID)
      ).to.be.revertedWithCustomError(hpPropTrading, "AdapterNotFound");
    });

    it("should track adapter IDs correctly", async function () {
      const adapterId2 = ethers.keccak256(ethers.toUtf8Bytes("ADAPTER_2"));
      await hpPropTrading.connect(admin).registerAdapter(ADAPTER_ID, await mockAdapter.getAddress());
      await hpPropTrading.connect(admin).registerAdapter(adapterId2, await mockAdapter.getAddress());

      const ids = await hpPropTrading.getAdapterIds();
      expect(ids.length).to.equal(2);
      expect(ids).to.include(ADAPTER_ID);
      expect(ids).to.include(adapterId2);
    });
  });

  describe("Aggregator Module - Swap Execution", function () {
    beforeEach(async function () {
      // Register adapter
      await hpPropTrading.connect(admin).registerAdapter(ADAPTER_ID, await mockAdapter.getAddress());

      // Grant allocator role
      const ALLOCATOR_ROLE = await hpPropTrading.ALLOCATOR_ROLE();
      await hpPropTrading.connect(admin).grantRole(ALLOCATOR_ROLE, allocator.address);

      // Deposit funds
      await hpPropTrading.connect(user).deposit({ value: ethers.parseEther("10") });
      const amount = ethers.parseEther("1000");
      await mockToken.mint(user.address, amount);
      await mockToken.connect(user).approve(await hpPropTrading.getAddress(), amount);
      await hpPropTrading.connect(user).depositToken(await mockToken.getAddress(), amount);
    });

    it("should allow ALLOCATOR to execute swap", async function () {
      const amountIn = ethers.parseEther("100");
      const minAmountOut = ethers.parseEther("90");
      const extraData = "0x";

      await hpPropTrading
        .connect(allocator)
        .executeSwap(ADAPTER_ID, await mockToken.getAddress(), ethers.ZeroAddress, amountIn, minAmountOut, extraData);
    });

    it("should revert swap for non-ALLOCATOR", async function () {
      const amountIn = ethers.parseEther("100");
      await expect(
        hpPropTrading
          .connect(user)
          .executeSwap(ADAPTER_ID, await mockToken.getAddress(), ethers.ZeroAddress, amountIn, 0, "0x")
      ).to.be.reverted;
    });

    it("should revert if adapter not found", async function () {
      const fakeAdapterId = ethers.keccak256(ethers.toUtf8Bytes("FAKE"));
      await expect(
        hpPropTrading
          .connect(allocator)
          .executeSwap(fakeAdapterId, await mockToken.getAddress(), ethers.ZeroAddress, 100, 0, "0x")
      ).to.be.revertedWithCustomError(hpPropTrading, "AdapterNotFound");
    });
  });
});
