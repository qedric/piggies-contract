// We import Chai to use its asserting functions here.
const { expect, assert } = require("chai")
const { ethers, upgrades, network } = require("hardhat")
const helpers = require("@nomicfoundation/hardhat-network-helpers")
const { deploy, deployVaultImplementation, deployGenerator, deployTreasury, getTypedData, getRevertReason, getCurrentBlockTime, deployMockToken, deployMockOETHToken, generateMintRequest, makeVault, makeLockedVault, makeOpenVault, makeUnlockedVault } = require("./test_helpers")

const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000'

describe(" -- Testing Treasury Contract -- ", function () {
  let deployedContracts, factory, treasury
  let user1, user2, feeRecipient, TREASURER

  before(async function () {
    [user1, user2, feeRecipient, TREASURER] = await ethers.getSigners()
  })

  beforeEach(async function () {
    deployedContracts = await deploy(feeRecipient.address, 'SepoliaETH', 'https://zebra.xyz/')
    treasury = deployedContracts.treasury
    factory = deployedContracts.factory
    // grant TREASURY ROLE
    const treasurerRole = treasury.TREASURER_ROLE()
    await treasury.grantRole(treasurerRole, TREASURER.address)
  })

  describe("Configuration", function () {
    /*setOETHContractAddress*/
    it("should set OETH contract address", async function () {

      const oldOETHAddress = await treasury.oETHTokenAddress()

      // Set the OETH contract address by a TREASURER
      const tx = await treasury.connect(TREASURER).setOETHContractAddress(user1.address)
      const txReceipt = await tx.wait()

      const OriginProtocolTokenUpdatedEvent = txReceipt.events.find(event => event.event === 'OriginProtocolTokenUpdated')

      // Verify that the event was emitted with the new address
      expect(OriginProtocolTokenUpdatedEvent.args[0]).to.equal(oldOETHAddress)
      expect(OriginProtocolTokenUpdatedEvent.args[1]).to.equal(user1.address)

      // Verify that the OETH contract address has been updated
      const updatedOETHAddress = await treasury.oETHTokenAddress()
      expect(updatedOETHAddress).to.equal(user1.address)
    })

    it("should add and remove native staked tokens", async function () {
      const ns_token1 = await deployMockToken("Token1", "T1");
      const ns_token2 = await deployMockToken("Token2", "T2");

      // Add ns_token1 as a supported token
      let tx = await treasury.addNativeStakedToken(ns_token1.address)
      tx.wait()
      let supportedTokens = await treasury.nativeStakedTokens()
      expect(supportedTokens[0]).to.equal(ns_token1.address)

      // Add ns_token2 as a supported token
      tx = await treasury.addNativeStakedToken(ns_token2.address)
      tx.wait()

      supportedTokens = await treasury.nativeStakedTokens()
      expect(supportedTokens[1]).to.equal(ns_token2.address)

      // Remove ns_token1 from supported tokens
      await treasury.removeNativeStakedToken(ns_token1.address)
      supportedTokens = await treasury.nativeStakedTokens()
      expect(supportedTokens[0]).to.equal(ns_token2.address)

      // Remove ns_token2 from supported tokens
      await treasury.removeNativeStakedToken(ns_token2.address)
      supportedTokens = await treasury.nativeStakedTokens()
      expect(supportedTokens.length).to.equal(0)
    })

    it("should add and remove supported tokens", async function () {
      const ns_token1 = await deployMockToken("Token1", "T1");
      const ns_token2 = await deployMockToken("Token2", "T2");

      // Add ns_token1 as a supported token
      let tx = await treasury.addSupportedToken(ns_token1.address)
      tx.wait()
      let supportedTokens = await treasury.supportedTokens()
      expect(supportedTokens[0]).to.equal(ns_token1.address)

      // Add ns_token2 as a supported token
      tx = await treasury.addSupportedToken(ns_token2.address)
      tx.wait()

      supportedTokens = await treasury.supportedTokens()
      expect(supportedTokens[1]).to.equal(ns_token2.address)

      // Remove ns_token1 from supported tokens
      await treasury.removeSupportedToken(ns_token1.address)
      supportedTokens = await treasury.supportedTokens()
      expect(supportedTokens[0]).to.equal(ns_token2.address)

      // Remove ns_token2 from supported tokens
      await treasury.removeSupportedToken(ns_token2.address)
      supportedTokens = await treasury.supportedTokens()
      expect(supportedTokens.length).to.equal(0)
    })
  })

  describe("Vault State arrays", function () {

    /*addOpenVault*/
    it("should add a vault to the openVaults array", async function () {
      // get the deployed factory
      const makeVaultFee = ethers.utils.parseUnits("0.004", "ether")
      const mr = await generateMintRequest(factory.address, user1, user1.address)
      const tx = await factory.connect(user1).mintWithSignature(
        mr.typedData.message, mr.signature, { value: makeVaultFee })
      const txReceipt = await tx.wait()

      // get the vault
      const vaultCreatedEvent = txReceipt.events.find(event => event.event === 'VaultDeployed')
      const Vault = await ethers.getContractFactory("Vault")
      const vault = Vault.attach(vaultCreatedEvent.args.vault)

      // move time forward 100 days
      await helpers.time.increase(60 * 60 * 24 * 100)

      // send 1 ETH to the vault to unlock it
      const amountToSend = ethers.utils.parseEther("1")
      await user1.sendTransaction({
        to: vault.address,
        value: amountToSend,
      })

      const txPayout = await factory.connect(user1).payout(0)
      const txPayoutReceipt = await txPayout.wait()

      const filter = treasury.filters.AddedOpenVault();
      const events = await treasury.queryFilter(filter, txPayoutReceipt.blockNumber)

      expect(events[0].args[0]).to.equal(vault.address)

      // Verify that the vault address is a member of the open vaults array
      const openVault = await treasury.openVaults(0)
      expect(openVault).to.equal(vault.address)
      expect(await treasury.isOpenVault(vault.address)).to.be.true
    })
  })

  describe("Collect & Distribute", function () {
    let lockedVault, unlockedVault, openVault
    let ns_token1, ns_token2, s_token1, s_token2

    beforeEach(async function () {

      lockedVault = await makeLockedVault(factory, user1, user1)
      unlockedVault = await makeUnlockedVault(factory, user1, user1)
      openVault = await makeOpenVault(factory, user1, user1)

      // Deploy mock ERC20 tokens for testing native staked tokens
      const MockToken = await ethers.getContractFactory("MockToken")
      ns_token1 = await MockToken.deploy("Native Staked Token 1", "ETH1")
      await ns_token1.deployed()
      ns_token2 = await MockToken.deploy("Native Staked Token 2", "ETH2")
      await ns_token2.deployed()

      // Deploy mock ERC20 tokens for testing supported tokens
      s_token1 = await MockToken.deploy("Supported Token 1", "ST1")
      await s_token1.deployed()
      s_token2 = await MockToken.deploy("Supported Token 2", "ST2")
      await s_token2.deployed()

      // Approve our mock tokens:
      await treasury.addNativeStakedToken(ns_token1.address)
      await treasury.addNativeStakedToken(ns_token2.address)
      await treasury.addSupportedToken(s_token1.address)
      await treasury.addSupportedToken(s_token2.address)
    })

    it("should fail if there are no vaults to collect from", async function () {
      const treasury_with_no_vaults = await deploy(feeRecipient.address, 'SepoliaETH', 'https://zebra.xyz/').then((x) => x.treasury)
      await expect(treasury_with_no_vaults.connect(user1).collect()).to.be.revertedWith("No open vaults to collect from")
    })

    it("should collect open vault assets and not locked or unlocked assets", async function () {

      // 1. setup a locked vault with native, staked, and supported tokens:

      let tokenAmount = ethers.utils.parseUnits("10", 18)

      /*
        Locked vault has 10 of each native, staked, and supported tokens
      */
      await user2.sendTransaction({
        to: lockedVault.address,
        value: tokenAmount,
      })
      await ns_token1.transfer(lockedVault.address, tokenAmount)
      await ns_token2.transfer(lockedVault.address, tokenAmount)
      await s_token1.transfer(lockedVault.address, tokenAmount)
      await s_token2.transfer(lockedVault.address, tokenAmount)

      /*
        UnLocked vault has 50 of each staked & supported tokens
      */
      tokenAmount = ethers.utils.parseUnits("50", 18)
      await ns_token1.transfer(unlockedVault.address, tokenAmount)
      await ns_token2.transfer(unlockedVault.address, tokenAmount)

      /*
        Open vault gets 50 of each native, staked, and supported tokens
      */
      await user2.sendTransaction({
        to: openVault.address,
        value: tokenAmount,
      })
      await ns_token1.transfer(openVault.address, tokenAmount)
      await ns_token2.transfer(openVault.address, tokenAmount)
      await s_token1.transfer(openVault.address, tokenAmount)
      await s_token2.transfer(openVault.address, tokenAmount)

      // confirm we have one of each vault in correct states
      expect(await treasury.isOpenVault(openVault.address)).to.be.true
      expect(await treasury.isOpenVault(lockedVault.address)).to.be.false
      expect(await treasury.isOpenVault(unlockedVault.address)).to.be.false

      // check states again using direct method
      expect(await lockedVault.state()).to.equal(0)
      expect(await unlockedVault.state()).to.equal(1)
      expect(await openVault.state()).to.equal(2)

      /*console.log('lockedVault.address', lockedVault.address)
      console.log('unlockedVault.address', unlockedVault.address)
      console.log('openVault.address', openVault.address)*/

      // Get the initial balances of native tokens and supported tokens in the treasury
      const initial_ETH_Balance = await ethers.provider.getBalance(treasury.address)
      const initial_NS_Token1Balance = await ns_token1.balanceOf(treasury.address)
      const initial_NS_Token2Balance = await ns_token1.balanceOf(treasury.address)
      const initial_S_Token1Balance = await s_token1.balanceOf(treasury.address)
      const initial_S_Token2Balance = await s_token1.balanceOf(treasury.address)

      /*console.log('initial native token treasury balance', initial_ETH_Balance)
      console.log('initial native staked token 1 treasury balance', initial_NS_Token1Balance)
      console.log('initial native staked token 2 treasury balance', initial_NS_Token2Balance)
      console.log('initial supported token 1 treasury balance', initial_S_Token1Balance)
      console.log('initial supported token 2 treasury balance', initial_S_Token2Balance)*/

      // call collect on the treasury which should pull balance from the Open Vault only
      tx = await treasury.connect(user1).collect()
      const txReceipt = await tx.wait()

      // Get the updated balances after collecting from the Open Vault
      const updated_ETH_Balance = await ethers.provider.getBalance(treasury.address)
      const updated_NS_Token1Balance = await ns_token1.balanceOf(treasury.address)
      const updated_NS_Token2Balance = await ns_token1.balanceOf(treasury.address)
      const updated_S_Token1Balance = await s_token1.balanceOf(treasury.address)
      const updated_S_Token2Balance = await s_token1.balanceOf(treasury.address)

      /*console.log('updated Native Token Treasury Balance', updated_ETH_Balance)
      console.log('updated native staked token 1 treasury balance', updated_NS_Token1Balance)
      console.log('updated native staked token 2 treasury balance', updated_NS_Token2Balance)
      console.log('updated supported token 1 treasury balance', updated_S_Token1Balance)
      console.log('updated supported token 2 treasury balance', updated_S_Token2Balance)*/

      // Verify that balances have changed as expected
      const amountCollectedOfEachToken = ethers.utils.parseUnits("50", 18)
      expect(updated_ETH_Balance).to.equal(initial_ETH_Balance.add(amountCollectedOfEachToken))
      expect(updated_NS_Token1Balance).to.equal(initial_NS_Token1Balance.add(amountCollectedOfEachToken))
      expect(updated_NS_Token2Balance).to.equal(initial_NS_Token2Balance.add(amountCollectedOfEachToken))
      expect(updated_S_Token1Balance).to.equal(initial_S_Token1Balance.add(amountCollectedOfEachToken))
      expect(updated_S_Token2Balance).to.equal(initial_S_Token2Balance.add(amountCollectedOfEachToken))
    })

    it("should distribute native token balance to locked vaults", async function () {

      // send some native token to the open vault 
      tokenAmount = ethers.utils.parseUnits("60", 18)
      await user2.sendTransaction({
        to: openVault.address,
        value: tokenAmount,
      })

      // deploy a couple more lockedVaults
      const lockedVault2 = await makeLockedVault(factory, user1, user1)
      const lockedVault3 = await makeLockedVault(factory, user1, user1)
      
      // Count the number of locked and open vaults
      let numLockedVaults = 0
      let numVaults = 0
      let f

      // Count the number of locked vaults
      while (true) {
        try {
          const F = await ethers.getContractFactory("Vault")
          const fAddress = await factory.vaults(numVaults)
          const vault = F.attach(fAddress)
          if (await vault.state() == 0) {
            numLockedVaults++
          }
          numVaults++
        } catch {
          break
        }
      }

      expect(await ethers.provider.getBalance(lockedVault.address)).to.equal(0)
      expect(await ethers.provider.getBalance(lockedVault2.address)).to.equal(0)
      expect(await ethers.provider.getBalance(lockedVault3.address)).to.equal(0)
      expect(await ethers.provider.getBalance(openVault.address)).to.equal(ethers.utils.parseEther("60"))
      expect(numLockedVaults).to.equal(3)

      const openVaultNativeBalance = await ethers.provider.getBalance(openVault.address)
      //console.log('open vault balance:', openVaultNativeBalance)

      // send some ETH to vaults 2 & 3:
      await user2.sendTransaction({
        to: lockedVault2.address,
        value: ethers.utils.parseUnits("20", 18),
      })
      expect(await ethers.provider.getBalance(lockedVault2.address)).to.equal(ethers.utils.parseUnits("20", 18))
      // send some ETH to vaults 2 & 3:
      await user2.sendTransaction({
        to: lockedVault3.address,
        value: ethers.utils.parseUnits("30", 18),
      })
      expect(await ethers.provider.getBalance(lockedVault3.address)).to.equal(ethers.utils.parseUnits("30", 18))

      // check that all our locked vaults are actually locked
      expect(await lockedVault.state()).to.equal(0)
      expect(await lockedVault2.state()).to.equal(0)
      expect(await lockedVault3.state()).to.equal(0)

      // there should be nothing yet to distribute
      await expect(treasury.distributeNativeTokenRewards()).to.be.revertedWith('No native tokens')

      // call collect on the treasury which should pull balance from the Open Vault only
      const collectTx = await treasury.connect(user1).collect()
      const txReceipt = await collectTx.wait()
      expect(await ethers.provider.getBalance(openVault.address)).to.equal(0)

      // Check if the locked vaults received the expected amount of native token (ETH)
      let treasuryBalanceBefore = await ethers.provider.getBalance(treasury.address)
      let balance1Before = await ethers.provider.getBalance(lockedVault.address)
      let balance2Before = await ethers.provider.getBalance(lockedVault2.address)
      let balance3Before = await ethers.provider.getBalance(lockedVault3.address)

      // Distribute vaults to the locked vaults
      const tx = await treasury.distributeNativeTokenRewards() // Distribute to the three locked vaults
      const distVaultEvents = await treasury.queryFilter("DistributedNativeTokensToLockedVault")
      const distEvents = await treasury.queryFilter("DistributedNativeTokensToLockedVaults")
      expect(distEvents[0].args.balanceBeforeDistribution).to.equal(treasuryBalanceBefore)
      expect(distEvents[0].args.numberOfRecipients).to.equal(2)

      // Retrieve Receive events emitted by each locked vault
      const receiveEvents1 = await lockedVault3.queryFilter("Received")
      //console.log(receiveEvents1)

      // Check if the locked vaults received the expected amount of native token (ETH)
      const balance1After = await ethers.provider.getBalance(lockedVault.address)
      const balance2After = await ethers.provider.getBalance(lockedVault2.address)
      const balance3After = await ethers.provider.getBalance(lockedVault3.address)
      /*console.log('locked vault 1 after distribute:', balance1After)
      console.log('locked vault 2 after distribute:', balance2After)
      console.log('locked vault 3 after distribute:', balance3After)*/
      expect(balance1After).to.equal(balance1Before)
      expect(balance2After).to.equal(balance2Before.add(ethers.utils.parseEther("24")))
      expect(balance3After).to.equal(balance3Before.add(ethers.utils.parseEther("36")))
    })

    it("distribute should fail if there are no native tokens in the treasury", async function () {
      // there should be nothing yet to distribute
      await expect(treasury.distributeNativeTokenRewards()).to.be.revertedWith('No native tokens')
    })

    it("should distribute staked & supported token balances to locked vaults", async function () {

      // send some tokens to the open vault 
      tokenAmount = ethers.utils.parseUnits("60", 18)
      await ns_token1.transfer(openVault.address, tokenAmount)
      await s_token2.transfer(openVault.address, tokenAmount)

      // deploy a couple more lockedVaults
      const lockedVault2 = await makeLockedVault(factory, user1, user1)
      const lockedVault3 = await makeLockedVault(factory, user1, user1)

      // Transfer staked tokens to lockedvault 
      await ns_token1.transfer(lockedVault.address, ethers.utils.parseUnits("1", 18))
      await s_token2.transfer(lockedVault.address, ethers.utils.parseUnits("10", 18))

      // Transfer staked tokens to lockedvault 3
      await ns_token1.transfer(lockedVault3.address, ethers.utils.parseUnits("25", 18))
      await s_token2.transfer(lockedVault3.address, ethers.utils.parseUnits("0.5", 18))

      expect(await ns_token1.balanceOf(lockedVault.address)).to.equal(ethers.utils.parseUnits("1", 18))
      expect(await s_token2.balanceOf(lockedVault.address)).to.equal(ethers.utils.parseUnits("10", 18))

      expect(await ns_token1.balanceOf(lockedVault2.address)).to.equal(ethers.utils.parseUnits("0", 18))
      expect(await s_token2.balanceOf(lockedVault2.address)).to.equal(ethers.utils.parseUnits("0", 18))

      expect(await ns_token1.balanceOf(lockedVault3.address)).to.equal(ethers.utils.parseUnits("25", 18))
      expect(await s_token2.balanceOf(lockedVault3.address)).to.equal(ethers.utils.parseUnits("0.5", 18))

      // check that all our locked vaults are actually locked
      expect(await lockedVault.state()).to.equal(0)
      expect(await lockedVault2.state()).to.equal(0)
      expect(await lockedVault3.state()).to.equal(0)

      // there should be nothing yet to distribute
      await expect(treasury.distributeSupportedTokenRewards(ns_token1.address)).to.be.revertedWith('No supported tokens')
      await expect(treasury.distributeSupportedTokenRewards(s_token2.address)).to.be.revertedWith('No supported tokens')

      // call collect on the treasury which should pull balance from the Open Vault only
      const collectTx = await treasury.connect(user1).collect()
      const txReceipt = await collectTx.wait()
      expect(await ethers.provider.getBalance(openVault.address)).to.equal(0)

      // check that the token balances have been collected from open vault into the treasury
      expect(await ns_token1.balanceOf(treasury.address)).to.equal(ethers.utils.parseUnits("60", 18))
      expect(await s_token2.balanceOf(treasury.address)).to.equal(ethers.utils.parseUnits("60", 18))

      // Check if the locked vaults received the expected amount of supported tokens
      let treasuryTokenBalanceBefore = ethers.utils.parseUnits("60", 18)

      let token1balance1Before = await ns_token1.balanceOf(lockedVault.address)
      let token1balance2Before = await ns_token1.balanceOf(lockedVault2.address)
      let token1balance3Before = await ns_token1.balanceOf(lockedVault3.address)
      let token2balance1Before = await s_token2.balanceOf(lockedVault.address)
      let token2balance2Before = await s_token2.balanceOf(lockedVault2.address)
      let token2balance3Before = await s_token2.balanceOf(lockedVault3.address)

      /*console.log('token1balance1Before', token1balance1Before)
      console.log('token1balance2Before', token1balance2Before)
      console.log('token1balance3Before', token1balance3Before)
      console.log('token2balance1Before', token2balance1Before)
      console.log('token2balance2Before', token2balance2Before)
      console.log('token2balance3Before', token2balance3Before)*/

      // Distribute token 1 to the locked vaults
      const tx1 = await treasury.distributeSupportedTokenRewards(ns_token1.address)
      let distVaultEvents = await treasury.queryFilter("DistributedSupportedTokenToLockedVault")
      let distEvents = await treasury.queryFilter("DistributedSupportedTokensToLockedVaults")
      expect(distEvents[0].args.supportedToken).to.equal(ns_token1.address)
      expect(distEvents[0].args.balanceBeforeDistribution).to.equal(treasuryTokenBalanceBefore)
      expect(distEvents[0].args.numberOfRecipients).to.equal(2)

      // Distribute token 2 to the locked vaults
      const tx2 = await treasury.distributeSupportedTokenRewards  (s_token2.address)
      distVaultEvents = await treasury.queryFilter("DistributedSupportedTokenToLockedVault")
      distEvents = await treasury.queryFilter("DistributedSupportedTokensToLockedVaults")
      expect(distEvents[1].args.supportedToken).to.equal(s_token2.address)
      expect(distEvents[1].args.balanceBeforeDistribution).to.equal(treasuryTokenBalanceBefore)
      expect(distEvents[1].args.numberOfRecipients).to.equal(2)

      // Retrieve Receive events emitted by each locked vault
      //const receiveEvents1 = await lockedVault2.queryFilter("Received")
      //console.log(receiveEvents1)

      //proportionateShare = (treasuryTokenBalance * lockedBalances[i]) / tokenTotalBalance;

      const token1_share_vault1 = treasuryTokenBalanceBefore.mul(token1balance1Before).div(token1balance1Before.add(token1balance2Before).add(token1balance3Before))
      const token2_share_vault1 = treasuryTokenBalanceBefore.mul(token2balance1Before).div(token2balance1Before.add(token2balance2Before).add(token2balance3Before))

      const token1_share_vault3 = treasuryTokenBalanceBefore.mul(token1balance3Before).div(token1balance1Before.add(token1balance2Before).add(token1balance3Before))
      const token2_share_vault3 = treasuryTokenBalanceBefore.mul(token2balance3Before).div(token2balance1Before.add(token2balance2Before).add(token2balance3Before))
      /*console.log(token1_share_vault1)
      console.log(token2_share_vault1)
      console.log(token1_share_vault3)
      console.log(token2_share_vault3)*/

      // Check if the locked vaults received the expected amount of native token (ETH)
      let token1balance1After = await ns_token1.balanceOf(lockedVault.address)
      let token1balance2After = await ns_token1.balanceOf(lockedVault2.address)
      let token1balance3After = await ns_token1.balanceOf(lockedVault3.address)
      let token2balance1After = await s_token2.balanceOf(lockedVault.address)
      let token2balance2After = await s_token2.balanceOf(lockedVault2.address)
      let token2balance3After = await s_token2.balanceOf(lockedVault3.address)
      /*console.log('locked vault 1 after distribute:', balance1After)
      console.log('locked vault 2 after distribute:', balance2After)
      console.log('locked vault 3 after distribute:', balance3After)*/
      
      expect(token1balance1After).to.equal(token1balance1Before.add(token1_share_vault1))
      expect(token2balance1After).to.equal(token2balance1Before.add(token2_share_vault1))

      expect(token1balance2After).to.equal(token1balance2Before)
      expect(token2balance2After).to.equal(token2balance2Before)

      expect(token1balance3After).to.equal(token1balance3Before.add(token1_share_vault3))
      expect(token2balance3After).to.equal(token2balance3Before.add(token2_share_vault3))
    })

    it("distribute should fail if there are no native staked tokens in the treasury", async function () {
      // there should be nothing yet to distribute
      await expect(treasury.distributeSupportedTokenRewards(ns_token1.address)).to.be.revertedWith('No supported tokens')
      await expect(treasury.distributeSupportedTokenRewards(ns_token2.address)).to.be.revertedWith('No supported tokens')
    })

    it("should fail if there are no supported tokens in the treasury", async function () {
      // there should be nothing yet to distribute
      await expect(treasury.distributeSupportedTokenRewards(s_token1.address)).to.be.revertedWith('No supported tokens')
      await expect(treasury.distributeSupportedTokenRewards(s_token2.address)).to.be.revertedWith('No supported tokens')
    })

    it("should fail to distribute if token is unsupported", async function () {
      // there should be nothing yet to distribute
      await expect(treasury.distributeSupportedTokenRewards(user1.address)).to.be.revertedWith('Unsupported token')
      await expect(treasury.distributeSupportedTokenRewards(factory.address)).to.be.revertedWith('Unsupported token')
    })

    it("should distribute supported token balances to many locked vaults", async function () {

      // first, create n vaults
      //
      const nLockedVaults = 100

      const lockedVaults = []
      for (var i = nLockedVaults - 1; i >= 0; i--) {

        const randomNum1 = 0.1 + Math.random() * (100 - 0.1)
        const randomNum2 = 0.1 + Math.random() * (100 - 0.1)

        lockedVaults[i] = await makeLockedVault(factory, user1, user1)

        // Transfer supported tokens to lockedvault 
        await s_token1.transfer(lockedVaults[i].address, ethers.utils.parseUnits(randomNum1.toString(), 18))
        await s_token2.transfer(lockedVaults[i].address, ethers.utils.parseUnits(randomNum2.toString(), 18))

        expect(await s_token1.balanceOf(lockedVaults[i].address)).to.equal(ethers.utils.parseUnits(randomNum1.toString(), 18))
        expect(await s_token2.balanceOf(lockedVaults[i].address)).to.equal(ethers.utils.parseUnits(randomNum2.toString(), 18))
      }

      // transfer tokens to the treasury so there's something to distribute
      //
      let s_token1Amount = ethers.utils.parseUnits("250", 18)
      let s_token2Amount = ethers.utils.parseUnits("2", 18)
      await s_token1.transfer(treasury.address, s_token1Amount)
      await s_token2.transfer(treasury.address, s_token2Amount)

      let treasuryBalanceToken1 = await s_token1.balanceOf(treasury.address)
      let treasuryBalanceToken2 = await s_token2.balanceOf(treasury.address)
      
      //console.log(treasuryBalanceToken1)
      //console.log(treasuryBalanceToken2)

      // Distribute supported token 1 to the locked vaults
      //
      const tx1 = await treasury.distributeSupportedTokenRewards(s_token1.address)
      let distVaultEvents = await treasury.queryFilter("DistributedSupportedTokenToLockedVault")
      let distEvents = await treasury.queryFilter("DistributedSupportedTokensToLockedVaults")
      expect(distVaultEvents.length).to.equal(nLockedVaults)
      expect(distEvents[0].args.supportedToken).to.equal(s_token1.address)
      expect(distEvents[0].args.balanceBeforeDistribution).to.equal(s_token1Amount)
      expect(distEvents[0].args.numberOfRecipients).to.equal(nLockedVaults)

      // Distribute supported token 2 to the locked vaults
      //
      const tx2 = await treasury.distributeSupportedTokenRewards(s_token2.address)
      distVaultEvents = await treasury.queryFilter("DistributedSupportedTokenToLockedVault")
      distEvents = await treasury.queryFilter("DistributedSupportedTokensToLockedVaults")
      expect(distVaultEvents.length).to.equal(nLockedVaults * 2)
      expect(distEvents[1].args.supportedToken).to.equal(s_token2.address)
      expect(distEvents[1].args.balanceBeforeDistribution).to.equal(s_token2Amount)
      expect(distEvents[1].args.numberOfRecipients).to.equal(nLockedVaults)

      //console.log('distribution summary:',distEvents)


      treasuryBalanceToken1 = await s_token1.balanceOf(treasury.address)
      treasuryBalanceToken2 = await s_token2.balanceOf(treasury.address)
      
      //console.log(treasuryBalanceToken1)
      //console.log(treasuryBalanceToken2)

      // Expect the treasury to be empty of both tokens now
      expect(await s_token1.balanceOf(treasury.address)).to.be.closeTo(0, 5000)
      expect(await s_token2.balanceOf(treasury.address)).to.be.closeTo(0, 5000)
    })
  })
})