/*
    The MIT License (MIT)

    Copyright 2017 - 2018, Alchemy Limited, LLC.

    Permission is hereby granted, free of charge, to any person obtaining
    a copy of this software and associated documentation files (the
    "Software"), to deal in the Software without restriction, including
    without limitation the rights to use, copy, modify, merge, publish,
    distribute, sublicense, and/or sell copies of the Software, and to
    permit persons to whom the Software is furnished to do so, subject to
    the following conditions:

    The above copyright notice and this permission notice shall be included
    in all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
    OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
    MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
    IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
    CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
    TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
    SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

/* globals _ */
const assert = require('assert')
const ethjsABI = require('ethjs-abi')
const Token = artifacts.require('Token')
const Auctions = artifacts.require('Auctions')
const MockContractReceiver = artifacts.require('MockContractReceiver')

contract('Token', accounts => {
  const actors = {
    owner: accounts[0],
    alice: accounts[1],
    bob: accounts[2],
    charlie: accounts[8],
    minter: accounts[3],
    autonomousConverter: accounts[4],
    tokenPorter: accounts[5],
    badAutonomousConverter: accounts[6],
    badMinter: accounts[7],
    proceesds: accounts[9]
  }

  const contracts = {
    tokenMock: null,
    receiverMock: null
  }

  const decMult = 10 ** 18

  function findMethod (abi, name, args) {
    for (var i = 0; i < abi.length; i++) {
      const methodArgs = _.map(abi[i].inputs, 'type').join(',')
      if ((abi[i].name === name) && (methodArgs === args)) {
        return abi[i]
      }
    }
  }

  beforeEach(async () => {
    const initialSupply = 1000

    contracts.tokenMock = await Token.new(actors.autonomousConverter, actors.minter, initialSupply, decMult, { from: actors.owner })
    contracts.receiverMock = await MockContractReceiver.new({ from: actors.owner })

    assert.equal(await contracts.tokenMock.autonomousConverter(), actors.autonomousConverter, 'autonomousConverter was not set')
    assert.equal(await contracts.tokenMock.minter(), actors.minter, 'minter was not set')

    const expectedTotalSupply = initialSupply * decMult
    assert.equal(await contracts.tokenMock.totalSupply(), expectedTotalSupply, 'Total supply is incorrect')
    assert.equal((await contracts.tokenMock.balanceOf(actors.autonomousConverter)).toNumber(), expectedTotalSupply)

    // set token porter
    assert(await contracts.tokenMock.setTokenPorter.call(actors.tokenPorter, { from: actors.owner }), 'setTokenPorter did not return true')
    await contracts.tokenMock.setTokenPorter(actors.tokenPorter, { from: actors.owner })
    assert(await contracts.tokenMock.tokenPorter(), actors.tokenPorter, 'tokenPorter was not set')
  })

  describe('Initialize', () => {
    it('Contract should not allow re-initialization', () => {
      return new Promise(async (resolve, reject) => {
        const newAutonomousConverter = actors.badAutonomousConverter
        const newMinter = actors.badMinter
        const newInitialSupply = 2000
        const newDecMult = 10 ** 8
        let thrown = false
        try {
          await contracts.tokenMock.init(newAutonomousConverter, newMinter, newInitialSupply, newDecMult, { from: actors.owner })
        } catch (error) {
          thrown = true
        }
        assert(thrown, 'Init did not throw after 2nd call')

        resolve()
      })
    })

    it('Contract should not allow 0x0 for TokenPorter', () => {
      return new Promise(async (resolve, reject) => {
        let thrown = false
        try {
          await contracts.tokenMock.setTokenPorter(0x0, { from: actors.owner })
        } catch (error) {
          thrown = true
        }
        assert(thrown, 'setTokenPorter accepted 0x0 for tokenPorter')
        resolve()
      })
    })

    it('Alice should not be able to set the TokenPorter', () => {
      return new Promise(async (resolve, reject) => {
        let thrown = false
        try {
          await contracts.tokenMock.setTokenPorter(actors.tokenPorter, { from: actors.alice })
        } catch (error) {
          thrown = true
        }
        assert(thrown, 'setTokenPorter was successful for Alice')
        resolve()
      })
    })
  })

  describe('Mint', () => {
    it('Minter or TokenPorter should be able to mint tokens to Alice', () => {
      return new Promise(async (resolve, reject) => {
        const minters = [actors.minter, actors.tokenPorter]
        for (let idx = 0; idx < minters.length; idx++) {
          const actor = minters[idx]
          const mintAmount = 1 * decMult

          const aliceBeforeMint = await contracts.tokenMock.balanceOf(actors.alice)
          const totalSupplyBeforeMint = await contracts.tokenMock.totalSupply()

          assert(await contracts.tokenMock.mint.call(actors.alice, mintAmount, { from: actor }), 'mint did not return true for actor ' + idx)
          const tx = await contracts.tokenMock.mint(actors.alice, mintAmount, { from: actor })
          assert(tx.logs.length, 2, 'Incorrect number of logs emitted for actor ' + idx)

          let log = tx.logs[1]
          assert.equal(log.event, 'Transfer', 'Transfer event was not emitted for actor ' + idx)

          let logArgs = {
            from: log.args._from,
            to: log.args._to,
            value: log.args._value
          }
          assert.equal(logArgs.from, 0x0, 'From is wrong for actor ' + idx)
          assert.equal(logArgs.to, actors.alice, 'To is wrong for actor ' + idx)
          assert.equal(logArgs.value.toNumber(), mintAmount, 'Transfer amount is wrong for actor ' + idx)

          log = tx.logs[0]
          assert.equal(log.event, 'Mint', 'Mint event was not emitted for actor ' + idx)

          logArgs = {
            to: log.args._to,
            value: log.args._value
          }
          assert.equal(logArgs.to, actors.alice, 'To is wrong for actor in mint event' + idx)
          assert.equal(logArgs.value.toNumber(), mintAmount, 'Mint amount is wrong for actor ' + idx)

          const aliceAfterMint = await contracts.tokenMock.balanceOf(actors.alice)
          assert.equal(aliceAfterMint.toNumber() - aliceBeforeMint.toNumber(), mintAmount, 'Alice did not receive the correct amount of tokens for actor ' + idx)

          const totalSupplyAftreMint = await contracts.tokenMock.totalSupply()
          assert.equal(totalSupplyAftreMint.toNumber() - totalSupplyBeforeMint.toNumber(), mintAmount, 'Total supply did not get updated for actor ' + idx)
        }

        resolve()
      })
    })

    it('Alice should not be able to mint tokens to Bob', () => {
      return new Promise(async (resolve, reject) => {
        const mintAmount = 1 * decMult
        let thrown = false
        try {
          await contracts.tokenMock.mint(actors.bob, mintAmount, { from: actors.alice })
        } catch (error) {
          thrown = true
        }
        assert(thrown, 'Mint did not throw')

        resolve()
      })
    })
  })

  describe('Destroy', () => {
    it('AutonomousConverter or TokenPorter should be able to destroy tokens', () => {
      return new Promise(async (resolve, reject) => {
        const destroyers = [actors.autonomousConverter, actors.tokenPorter]
        for (let idx = 0; idx < destroyers.length; idx++) {
          const destroyer = destroyers[idx]

          // mint tokens for alice
          const mintAmount = 1 * decMult
          await contracts.tokenMock.mint(actors.alice, mintAmount, { from: actors.minter })

          // capture balances
          const beforeBalances = { alice: 0, totalSupply: 0 }
          beforeBalances.alice = await contracts.tokenMock.balanceOf(actors.alice)
          beforeBalances.totalSupply = await contracts.tokenMock.totalSupply()

          // destroy tokens
          const destroyAmt = mintAmount
          assert(await contracts.tokenMock.destroy.call(actors.alice, destroyAmt, { from: destroyer }), 'Destroy did not return true for ' + idx)
          const tx = await contracts.tokenMock.destroy(actors.alice, destroyAmt, { from: destroyer })
          assert.equal(tx.logs.length, 2, 'Incorrect number of logs were emitted')

          let log = tx.logs[1]
          assert.equal(log.event, 'Transfer', 'Transfer event was not emitted')

          let logArgs = {
            from: log.args._from,
            to: log.args._to,
            value: log.args._value
          }
          assert.equal(logArgs.from, actors.alice, 'From is wrong')
          assert.equal(logArgs.to, 0x0, 'To is wrong')
          assert.equal(logArgs.value.toNumber(), destroyAmt, 'Transfer amount is wrong')

          log = tx.logs[0]
          assert.equal(log.event, 'Destroy', 'Destroy event was not emitted')

          logArgs = {
            from: log.args._from,
            value: log.args._value
          }
          assert.equal(logArgs.from, actors.alice, 'From is wrong in destroy event')
          assert.equal(logArgs.value.toNumber(), destroyAmt, 'Destroy amount is wrong')

          const afterBalances = { alice: 0, totalSupply: 0 }
          afterBalances.alice = await contracts.tokenMock.balanceOf(actors.alice)
          afterBalances.totalSupply = await contracts.tokenMock.totalSupply()
          assert.equal(beforeBalances.alice.toNumber() - afterBalances.alice.toNumber(), destroyAmt, 'Alice balance is incorrect')
          assert.equal(beforeBalances.totalSupply.toNumber() - afterBalances.totalSupply.toNumber(), destroyAmt, 'Total supply is incorrect')
        }
        resolve()
      })
    })

    it('Alice should not be able to destroy tokens for Bob', () => {
      return new Promise(async (resolve, reject) => {
        const mintAmount = 1 * decMult

        await contracts.tokenMock.mint(actors.bob, mintAmount, { from: actors.minter })

        let thrown = false
        try {
          const destroyAmt = mintAmount
          await contracts.tokenMock.destroy(actors.bob, destroyAmt, { from: actors.alice })
        } catch (error) {
          thrown = true
        }
        assert(thrown, 'Destroy did not throw')

        resolve()
      })
    })
  })

  describe('Transfers', () => {
    beforeEach(async () => {
      const auctions = await Auctions.new()

      contracts.tokenMock = await Token.new(actors.autonomousConverter, auctions.address, 0, decMult, { from: actors.owner })
      const founders = []
      founders.push(actors.owner + '0000D3C214DE7193CD4E0000')
      founders.push(actors.alice + '0000D3C214DE7193CD4E0000')
      await auctions.mintInitialSupply(founders, contracts.tokenMock.address, actors.proceesds, actors.autonomousConverter, {from: actors.owner})

      // // set token porter
      assert(await contracts.tokenMock.setTokenPorter.call(actors.tokenPorter, { from: actors.owner }), 'setTokenPorter did not return true')
      await contracts.tokenMock.setTokenPorter(actors.tokenPorter, { from: actors.owner })
      assert(await contracts.tokenMock.tokenPorter(), actors.tokenPorter, 'tokenPorter was not set')
    })

    it('Alice should not be able to send tokens to Bob with insufficient funds', () => {
      return new Promise(async (resolve, reject) => {
        const transferAmount = 1 * decMult

        const aliceBalance = await contracts.tokenMock.balanceOf(actors.alice)
        assert(aliceBalance.toNumber() < transferAmount, 'Alice should not have enough tokens')

        let thrown = false
        try {
          await contracts.tokenMock.transfer(actors.bob, transferAmount, { from: actors.alice })
        } catch (error) {
          thrown = true
        }
        assert(thrown, 'Transfer did not throw')

        resolve()
      })
    })

    it('Alice should not be able to send tokens to the minter or Token contract', () => {
      return new Promise(async (resolve, reject) => {
        const badTos = [actors.minter, contracts.tokenMock.address]
        for (let idx = 0; idx < badTos.length; idx++) {
          const badTo = badTos[idx]
          const transferAmount = 1 * decMult

          let thrown = false
          try {
            await contracts.tokenMock.transfer(badTo, transferAmount, { from: actors.alice })
          } catch (error) {
            thrown = true
          }
          assert(thrown, 'Transfer did not throw')
        }

        resolve()
      })
    })

    it('Alice should be able to send tokens to Bob', () => {
      return new Promise(async (resolve, reject) => {
        const mintAmount = 1 * decMult

        // give alice tokens for test
        await contracts.tokenMock.mint(actors.alice, mintAmount, { from: actors.tokenPorter })

        const beforeBalances = { alice: 0, bob: 0 }
        beforeBalances.alice = await contracts.tokenMock.balanceOf(actors.alice)
        beforeBalances.bob = await contracts.tokenMock.balanceOf(actors.bob)

        const transferAmount = 1 * decMult
        assert(await contracts.tokenMock.transfer.call(actors.bob, transferAmount, { from: actors.alice }), 'Transfer did not return true')
        const tx = await contracts.tokenMock.transfer(actors.bob, transferAmount, { from: actors.alice })
        assert.equal(tx.logs.length, 1, 'Incorrect number of logs emitted')

        const log = tx.logs[0]
        assert.equal(log.event, 'Transfer', 'Transfer event was not emitted')

        const logArgs = {
          from: log.args._from,
          to: log.args._to,
          value: log.args._value
        }
        assert.equal(logArgs.from, actors.alice, 'From is wrong')
        assert.equal(logArgs.to, actors.bob, 'To is wrong')
        assert.equal(logArgs.value.toNumber(), transferAmount, 'Transfer amount is wrong')

        const afterBalances = { alice: 0, bob: 0 }
        afterBalances.alice = await contracts.tokenMock.balanceOf(actors.alice)
        afterBalances.bob = await contracts.tokenMock.balanceOf(actors.bob)
        assert.equal(afterBalances.alice.toNumber() - beforeBalances.alice.toNumber(), -transferAmount, 'Alice balance is incorrect')
        assert.equal(afterBalances.bob.toNumber() - beforeBalances.bob.toNumber(), transferAmount, 'Bob balance is incorrect')
        resolve()
      })
    })
  })

  describe('Transfers with data', () => {
    beforeEach(async () => {
      const auctions = await Auctions.new()

      contracts.tokenMock = await Token.new(actors.autonomousConverter, auctions.address, 0, decMult, { from: actors.owner })
      const founders = []
      founders.push(actors.owner + '0000D3C214DE7193CD4E0000')
      founders.push(actors.alice + '0000D3C214DE7193CD4E0000')
      await auctions.mintInitialSupply(founders, contracts.tokenMock.address, actors.proceesds, actors.autonomousConverter, {from: actors.owner})

      // // set token porter
      assert(await contracts.tokenMock.setTokenPorter.call(actors.tokenPorter, { from: actors.owner }), 'setTokenPorter did not return true')
      await contracts.tokenMock.setTokenPorter(actors.tokenPorter, { from: actors.owner })
      assert(await contracts.tokenMock.tokenPorter(), actors.tokenPorter, 'tokenPorter was not set')
    })

    it('Alice should be able to send tokens to contract with function call', () => {
      return new Promise(async (resolve, reject) => {
        const mintAmount = 1 * decMult

        // give alice tokens for test
        await contracts.tokenMock.mint(actors.alice, mintAmount, { from: actors.tokenPorter })

        const beforeBalances = { alice: 0, contract: 0 }
        beforeBalances.alice = await contracts.tokenMock.balanceOf(actors.alice)
        beforeBalances.contract = await contracts.tokenMock.balanceOf(contracts.receiverMock.address)

        const transferAmount = 1 * decMult

        // create raw transaction with contract data
        const testNumber = 24
        const extraData = contracts.receiverMock.contract.onTokenTransfer.getData(testNumber)
        const abiMethod = findMethod(contracts.tokenMock.abi, 'transfer', 'address,uint256,bytes')
        const transferData = ethjsABI.encodeMethod(abiMethod, [contracts.receiverMock.contract.address, transferAmount, extraData])
        const tx = await contracts.tokenMock.sendTransaction({ from: actors.alice, data: transferData })

        // check logs for event triggered in receiver contract
        assert.equal(tx.receipt.logs.length, 3, 'Incorrect number of logs emitted for tx.receipt')
        assert.equal(tx.receipt.logs[1].data, testNumber, 'TestLog did not emit with correct value')
        assert.equal(tx.logs.length, 2, 'Incorrect number of logs emitted for tx')

        // check standard transfer event
        const log0 = tx.logs[0]
        assert.equal(log0.event, 'Transfer', 'Transfer event was not emitted')
        const log0Args = {
          from: log0.args._from,
          to: log0.args._to,
          value: log0.args._value
        }
        assert.equal(log0Args.from, actors.alice, 'From is wrong')
        assert.equal(log0Args.to, contracts.receiverMock.address, 'To is wrong')
        assert.equal(log0Args.value.toNumber(), transferAmount, 'Transfer amount is wrong')

        // check new data transfer event
        const log1 = tx.logs[1]
        assert.equal(log1.event, 'Transfer', 'Transfer event was not emitted')
        const log1Args = {
          from: log1.args._from,
          to: log1.args._to,
          value: log1.args._value,
          data: log1.args._data
        }
        assert.equal(log1Args.from, actors.alice, 'From is wrong')
        assert.equal(log1Args.to, contracts.receiverMock.address, 'To is wrong')
        assert.equal(log1Args.value.toNumber(), transferAmount, 'Transfer amount is wrong')
        assert.equal(log1Args.data, extraData, 'Data is wrong')

        // reconcile balances
        const afterBalances = { alice: 0, contract: 0 }
        afterBalances.alice = await contracts.tokenMock.balanceOf(actors.alice)
        afterBalances.contract = await contracts.tokenMock.balanceOf(contracts.receiverMock.address)
        assert.equal(afterBalances.alice.toNumber() - beforeBalances.alice.toNumber(), -transferAmount, 'Alice balance is incorrect')
        assert.equal(afterBalances.contract.toNumber() - beforeBalances.contract.toNumber(), transferAmount, 'Contract balance is incorrect')

        resolve()
      })
    })
  })

  describe('Approve', () => {
    const mintAmount = 1 * decMult

    beforeEach(async () => {
      await contracts.tokenMock.mint(actors.alice, mintAmount, { from: actors.minter })
    })

    it('Alice can approve Bob to transfer funds', () => {
      return new Promise(async (resolve, reject) => {
        const transferAmt = mintAmount
        const allowedBeforeAmt = await contracts.tokenMock.allowance(actors.alice, actors.bob)
        assert.equal(allowedBeforeAmt, 0, 'Bob should not already be allowed to transfer Alice\'s funds')

        assert(await contracts.tokenMock.approve.call(actors.bob, transferAmt, { from: actors.alice }), 'approve did not return true')
        const tx = await contracts.tokenMock.approve(actors.bob, transferAmt, { from: actors.alice })

        // check for Approval event
        assert.equal(tx.logs.length, 1, 'Incorrect number of logs emitted for tx')

        const log = tx.logs[0]
        assert.equal(log.event, 'Approval', 'Approval event was not emitted')
        const logArgs = {
          owner: log.args._owner,
          spender: log.args._spender,
          value: log.args._value
        }
        assert.equal(logArgs.owner, actors.alice, 'Owner is wrong')
        assert.equal(logArgs.spender, actors.bob, 'Spender is wrong')
        assert.equal(logArgs.value, transferAmt, 'Value is wrong')

        // check allowance
        const allowedAfterAmt = await contracts.tokenMock.allowance(actors.alice, actors.bob)
        assert.equal(allowedAfterAmt, transferAmt, 'Bob was not approved for correct amount')

        resolve()
      })
    })

    it('Alice can re-approve Bob to transfer funds', () => {
      return new Promise(async (resolve, reject) => {
        const transferAmt = mintAmount
        const allowedBeforeAmt = await contracts.tokenMock.allowance(actors.alice, actors.bob)
        assert.equal(allowedBeforeAmt, 0, 'Bob should not already be allowed to transfer Alice\'s funds')

        await contracts.tokenMock.approve(actors.bob, transferAmt, { from: actors.alice })

        // try to re-approve without first setting to zero
        const newApproveAmt = mintAmount * 2
        await contracts.tokenMock.approve(actors.bob, newApproveAmt, { from: actors.alice })
        const currentAllowance = await contracts.tokenMock.allowance.call(actors.alice, actors.bob)
        assert.equal(currentAllowance, newApproveAmt, 'allowance approved is not correct')

        resolve()
      })
    })

    it('Alice can reset approval for Bob (first setting it to zero)', () => {
      return new Promise(async (resolve, reject) => {
        const transferAmt = mintAmount
        const allowedBeforeAmt = await contracts.tokenMock.allowance(actors.alice, actors.bob)
        assert.equal(allowedBeforeAmt, 0, 'Bob should not already be allowed to transfer Alice\'s funds')

        await contracts.tokenMock.approve(actors.bob, transferAmt, { from: actors.alice })

        // reset approval to zero
        assert(await contracts.tokenMock.approve.call(actors.bob, 0, { from: actors.alice }), 'Zero approval failed')
        const txZero = await contracts.tokenMock.approve(actors.bob, 0, { from: actors.alice })
        assert.equal(txZero.logs.length, 1, 'Incorrect number of logs emitted for txZero')
        assert.equal(txZero.logs[0].event, 'Approval', 'Approval event was not emitted for txZero')

        // reset approval to new amount
        const newTransferAmt = mintAmount * 2
        assert(await contracts.tokenMock.approve.call(actors.bob, newTransferAmt, { from: actors.alice }), 'approve did not return true')
        const tx = await contracts.tokenMock.approve(actors.bob, newTransferAmt, { from: actors.alice })

        // check for Approval event
        assert.equal(tx.logs.length, 1, 'Incorrect number of logs emitted for tx')

        const log = tx.logs[0]
        assert.equal(log.event, 'Approval', 'Approval event was not emitted')
        const logArgs = {
          owner: log.args._owner,
          spender: log.args._spender,
          value: log.args._value
        }
        assert.equal(logArgs.owner, actors.alice, 'Owner is wrong')
        assert.equal(logArgs.spender, actors.bob, 'Spender is wrong')
        assert.equal(logArgs.value, newTransferAmt, 'Value is wrong')

        // check allowance
        const allowedAfterAmt = await contracts.tokenMock.allowance(actors.alice, actors.bob)
        assert.equal(allowedAfterAmt, newTransferAmt, 'Bob was not approved for the new amount')

        resolve()
      })
    })

    it('Alice should not be able to approve the Token contract', () => {
      return new Promise(async (resolve, reject) => {
        const transferAmt = mintAmount
        const allowedBeforeAmt = await contracts.tokenMock.allowance(actors.alice, contracts.tokenMock.address)
        assert.equal(allowedBeforeAmt, 0, 'Token contract should not already be allowed to transfer Alice\'s funds')

        let thrown = false
        try {
          await contracts.tokenMock.approve(contracts.tokenMock.address, transferAmt, { from: actors.alice })
        } catch (error) {
          thrown = true
        }
        assert(thrown, 'Approve did not throw')

        resolve()
      })
    })
  })

  describe('Approve with data', () => {
    it('Alice should be able to approve contract transfers with function call', () => {
      return new Promise(async (resolve, reject) => {
        const allowedBeforeAmt = await contracts.tokenMock.allowance(actors.alice, contracts.receiverMock.address)
        assert.equal(allowedBeforeAmt, 0, 'Contract should not already be allowed to transfer Alice\'s funds')

        const approveAmount = 1 * decMult

        // create raw transaction with contract data
        const testNumber = 8
        const extraData = contracts.receiverMock.contract.onTokenApprove.getData(testNumber)
        const abiMethod = findMethod(contracts.tokenMock.abi, 'approve', 'address,uint256,bytes')
        const transferData = ethjsABI.encodeMethod(abiMethod, [contracts.receiverMock.contract.address, approveAmount, extraData])
        const tx = await contracts.tokenMock.sendTransaction({ from: actors.alice, data: transferData })

        // check logs for event triggered in receiver contract
        assert.equal(tx.receipt.logs.length, 3, 'Incorrect number of logs emitted for tx.receipt')
        assert.equal(tx.receipt.logs[1].data, testNumber, 'TestLog did not emit with correct value')
        assert.equal(tx.logs.length, 2, 'Incorrect number of logs emitted for tx')

        // check standard transfer event
        const log0 = tx.logs[0]
        assert.equal(log0.event, 'Approval', 'Approval event was not emitted')
        const log0Args = {
          owner: log0.args._owner,
          spender: log0.args._spender,
          value: log0.args._value
        }
        assert.equal(log0Args.owner, actors.alice, 'Owner is wrong')
        assert.equal(log0Args.spender, contracts.receiverMock.address, 'Spender is wrong')
        assert.equal(log0Args.value.toNumber(), approveAmount, 'Approval amount is wrong')

        // check new data transfer event
        const log1 = tx.logs[1]
        assert.equal(log1.event, 'Approval', 'Approval event was not emitted')
        const log1Args = {
          owner: log1.args._owner,
          spender: log1.args._spender,
          value: log1.args._value,
          data: log1.args._data
        }
        assert.equal(log1Args.owner, actors.alice, 'Owner is wrong')
        assert.equal(log1Args.spender, contracts.receiverMock.address, 'Spender is wrong')
        assert.equal(log1Args.value.toNumber(), approveAmount, 'Approval amount is wrong')
        assert.equal(log1Args.data, extraData, 'Data is wrong')

        // reconcile balances
        const allowedAfterAmt = await contracts.tokenMock.allowance(actors.alice, contracts.receiverMock.address)
        assert.equal(allowedAfterAmt.toNumber() - allowedBeforeAmt.toNumber(), approveAmount, 'Contract approval amount is incorrect')

        resolve()
      })
    })
  })

  describe('Transfer from', () => {
    beforeEach(async () => {
      const auctions = await Auctions.new()

      contracts.tokenMock = await Token.new(actors.autonomousConverter, auctions.address, 0, decMult, { from: actors.owner })
      const founders = []
      founders.push(actors.owner + '0000D3C214DE7193CD4E0000')
      founders.push(actors.alice + '0000D3C214DE7193CD4E0000')
      await auctions.mintInitialSupply(founders, contracts.tokenMock.address, actors.proceesds, actors.autonomousConverter, {from: actors.owner})

      // // set token porter
      assert(await contracts.tokenMock.setTokenPorter.call(actors.tokenPorter, { from: actors.owner }), 'setTokenPorter did not return true')
      await contracts.tokenMock.setTokenPorter(actors.tokenPorter, { from: actors.owner })
      assert(await contracts.tokenMock.tokenPorter(), actors.tokenPorter, 'tokenPorter was not set')
    })

    it('Bob should not be able to transfer over the authorized amount for Alice', () => {
      return new Promise(async (resolve, reject) => {
        const mintAmount = 5 * decMult
        const approvedAmount = 1 * decMult
        const transferAmount = 2 * decMult

        // give alice tokens for test
        await contracts.tokenMock.mint(actors.alice, mintAmount, { from: actors.tokenPorter })

        // approve bob for the lower amount
        await contracts.tokenMock.approve(actors.bob, approvedAmount, { from: actors.alice })

        // attempt to transfer too much
        let thrown = false
        try {
          await contracts.tokenMock.transferFrom(actors.alice, actors.bob, transferAmount, { from: actors.bob })
        } catch (error) {
          thrown = true
        }
        assert(thrown, 'Transfer From did not throw')

        resolve()
      })
    })

    it('Bob should not be able to transfer funds when Alice does not have enough', () => {
      return new Promise(async (resolve, reject) => {
        const mintAmount = 1 * decMult
        const transferAmount = 5 * decMult

        // give alice tokens for test
        await contracts.tokenMock.mint(actors.alice, mintAmount, { from: actors.tokenPorter })

        // approve bob for the higher amount
        await contracts.tokenMock.approve(actors.bob, transferAmount, { from: actors.alice })

        // attempt to transfer too much
        let thrown = false
        try {
          await contracts.tokenMock.transferFrom(actors.alice, actors.bob, transferAmount, { from: actors.bob })
        } catch (error) {
          thrown = true
        }
        assert(thrown, 'Transfer From did not throw')

        resolve()
      })
    })

    it('Only approved accounts should be able to transfer funds from Alice', () => {
      return new Promise(async (resolve, reject) => {
        const mintAmount = 1 * decMult
        const transferAmount = 1 * decMult

        // give alice tokens for test
        await contracts.tokenMock.mint(actors.alice, mintAmount, { from: actors.tokenPorter })

        const approvedAccounts = [contracts.tokenMock.address, actors.bob, actors.minter]
        for (let idx = 0; idx < approvedAccounts.length; idx++) {
          const actor = approvedAccounts[idx]
          const allowedBeforeAmt = await contracts.tokenMock.allowance(actors.alice, actor)
          assert.equal(allowedBeforeAmt, 0, 'Approver ' + idx + ' should not already be allowed to transfer Alice\'s funds')

          let thrown = false
          try {
            await contracts.tokenMock.transferFrom(actors.alice, actor, transferAmount, { from: actor })
          } catch (error) {
            thrown = true
          }
          assert(thrown, 'Transfer From did not throw for actor ' + idx)
        }

        resolve()
      })
    })

    it('Bob should be able to send tokens to Chalrie on Alice\'s behalf', () => {
      return new Promise(async (resolve, reject) => {
        const mintAmount = 1 * decMult
        const transferAmount = 1 * decMult

        // give alice tokens for test
        await contracts.tokenMock.mint(actors.alice, mintAmount, { from: actors.tokenPorter })
        await contracts.tokenMock.approve(actors.bob, transferAmount, { from: actors.alice })

        const beforeBalances = { alice: 0, bob: 0, charlie: 0 }
        beforeBalances.alice = await contracts.tokenMock.balanceOf(actors.alice)
        beforeBalances.bob = await contracts.tokenMock.balanceOf(actors.bob)
        beforeBalances.charlie = await contracts.tokenMock.balanceOf(actors.charlie)
        const allowedBeforeAmt = await contracts.tokenMock.allowance(actors.alice, actors.bob)

        assert(await contracts.tokenMock.transferFrom.call(actors.alice, actors.charlie, transferAmount, { from: actors.bob }), 'Transfer From did not return true')
        const tx = await contracts.tokenMock.transferFrom(actors.alice, actors.charlie, transferAmount, { from: actors.bob })
        assert.equal(tx.logs.length, 1, 'Incorrect number of logs emitted')

        const log = tx.logs[0]
        assert.equal(log.event, 'Transfer', 'Transfer event was not emitted')

        const logArgs = {
          from: log.args._from,
          to: log.args._to,
          value: log.args._value
        }
        assert.equal(logArgs.from, actors.alice, 'From is wrong')
        assert.equal(logArgs.to, actors.charlie, 'To is wrong')
        assert.equal(logArgs.value.toNumber(), transferAmount, 'Transfer amount is wrong')

        const afterBalances = { alice: 0, bob: 0, charlie: 0 }
        afterBalances.alice = await contracts.tokenMock.balanceOf(actors.alice)
        afterBalances.bob = await contracts.tokenMock.balanceOf(actors.bob)
        afterBalances.charlie = await contracts.tokenMock.balanceOf(actors.charlie)
        assert.equal(afterBalances.alice.toNumber() - beforeBalances.alice.toNumber(), -transferAmount, 'Alice balance is incorrect')
        assert.equal(afterBalances.bob.toNumber(), beforeBalances.bob.toNumber(), 'Bob balance is incorrect')
        assert.equal(afterBalances.charlie.toNumber() - beforeBalances.charlie.toNumber(), transferAmount, 'Charlie balance is incorrect')

        const allowedAfterAmt = await contracts.tokenMock.allowance(actors.alice, actors.bob)
        assert.equal(allowedBeforeAmt.toNumber() - allowedAfterAmt.toNumber(), transferAmount, 'Bob allowance did not update after the transfer')

        resolve()
      })
    })

    it('Bob should be able to send tokens to himself on Alice\'s behalf', () => {
      return new Promise(async (resolve, reject) => {
        const mintAmount = 1 * decMult
        const transferAmount = 1 * decMult

        // give alice tokens for test
        await contracts.tokenMock.mint(actors.alice, mintAmount, { from: actors.tokenPorter })
        await contracts.tokenMock.approve(actors.bob, transferAmount, { from: actors.alice })

        const beforeBalances = { alice: 0, bob: 0 }
        beforeBalances.alice = await contracts.tokenMock.balanceOf(actors.alice)
        beforeBalances.bob = await contracts.tokenMock.balanceOf(actors.bob)
        const allowedBeforeAmt = await contracts.tokenMock.allowance(actors.alice, actors.bob)

        assert(await contracts.tokenMock.transferFrom.call(actors.alice, actors.bob, transferAmount, { from: actors.bob }), 'Transfer From did not return true')
        const tx = await contracts.tokenMock.transferFrom(actors.alice, actors.bob, transferAmount, { from: actors.bob })
        assert.equal(tx.logs.length, 1, 'Incorrect number of logs emitted')

        const log = tx.logs[0]
        assert.equal(log.event, 'Transfer', 'Transfer event was not emitted')

        const logArgs = {
          from: log.args._from,
          to: log.args._to,
          value: log.args._value
        }
        assert.equal(logArgs.from, actors.alice, 'From is wrong')
        assert.equal(logArgs.to, actors.bob, 'To is wrong')
        assert.equal(logArgs.value.toNumber(), transferAmount, 'Transfer amount is wrong')

        const afterBalances = { alice: 0, bob: 0 }
        afterBalances.alice = await contracts.tokenMock.balanceOf(actors.alice)
        afterBalances.bob = await contracts.tokenMock.balanceOf(actors.bob)
        assert.equal(afterBalances.alice.toNumber() - beforeBalances.alice.toNumber(), -transferAmount, 'Alice balance is incorrect')
        assert.equal(afterBalances.bob.toNumber() - beforeBalances.bob.toNumber(), transferAmount, 'Bob balance is incorrect')

        const allowedAfterAmt = await contracts.tokenMock.allowance(actors.alice, actors.bob)
        assert.equal(allowedBeforeAmt.toNumber() - allowedAfterAmt.toNumber(), transferAmount, 'Bob allowance did not update after the transfer')

        resolve()
      })
    })
  })

  describe('Transfer from with data', () => {
    beforeEach(async () => {
      const auctions = await Auctions.new()

      contracts.tokenMock = await Token.new(actors.autonomousConverter, auctions.address, 0, decMult, { from: actors.owner })
      const founders = []
      founders.push(actors.owner + '0000D3C214DE7193CD4E0000')
      founders.push(actors.alice + '0000D3C214DE7193CD4E0000')
      await auctions.mintInitialSupply(founders, contracts.tokenMock.address, actors.proceesds, actors.autonomousConverter, {from: actors.owner})

      // // set token porter
      assert(await contracts.tokenMock.setTokenPorter.call(actors.tokenPorter, { from: actors.owner }), 'setTokenPorter did not return true')
      await contracts.tokenMock.setTokenPorter(actors.tokenPorter, { from: actors.owner })
      assert(await contracts.tokenMock.tokenPorter(), actors.tokenPorter, 'tokenPorter was not set')
    })

    it('Bob should be able to send tokens to a contract with a function call on Alice\'s behalf', () => {
      return new Promise(async (resolve, reject) => {
        const mintAmount = 1 * decMult

        // give alice tokens for test
        await contracts.tokenMock.mint(actors.alice, mintAmount, { from: actors.tokenPorter })

        const beforeBalances = { alice: 0, contract: 0, bob: 0 }
        beforeBalances.alice = await contracts.tokenMock.balanceOf(actors.alice)
        beforeBalances.bob = await contracts.tokenMock.balanceOf(actors.bob)
        beforeBalances.contract = await contracts.tokenMock.balanceOf(contracts.receiverMock.address)

        // approve bob for the transfer
        const transferAmount = 1 * decMult
        await contracts.tokenMock.approve(actors.bob, transferAmount, { from: actors.alice })

        // create raw transaction with contract data
        const testNumber = 32
        const extraData = contracts.receiverMock.contract.onTokenTransfer.getData(testNumber)
        const abiMethod = findMethod(contracts.tokenMock.abi, 'transferFrom', 'address,address,uint256,bytes')
        const transferData = ethjsABI.encodeMethod(abiMethod, [actors.alice, contracts.receiverMock.contract.address, transferAmount, extraData])
        const tx = await contracts.tokenMock.sendTransaction({ from: actors.bob, data: transferData })

        // check logs for event triggered in receiver contract
        assert.equal(tx.receipt.logs.length, 3, 'Incorrect number of logs emitted for tx.receipt')
        assert.equal(tx.receipt.logs[1].data, testNumber, 'TestLog did not emit with correct value')
        assert.equal(tx.logs.length, 2, 'Incorrect number of logs emitted for tx')

        // check standard transfer event
        const log0 = tx.logs[0]
        assert.equal(log0.event, 'Transfer', 'Transfer event was not emitted')
        const log0Args = {
          from: log0.args._from,
          to: log0.args._to,
          value: log0.args._value
        }
        assert.equal(log0Args.from, actors.alice, 'From is wrong')
        assert.equal(log0Args.to, contracts.receiverMock.address, 'To is wrong')
        assert.equal(log0Args.value.toNumber(), transferAmount, 'Transfer amount is wrong')

        // check new data transfer event
        const log1 = tx.logs[1]
        assert.equal(log1.event, 'Transfer', 'Transfer event was not emitted')
        const log1Args = {
          from: log1.args._from,
          to: log1.args._to,
          value: log1.args._value,
          data: log1.args._data
        }
        assert.equal(log1Args.from, actors.alice, 'From is wrong')
        assert.equal(log1Args.to, contracts.receiverMock.address, 'To is wrong')
        assert.equal(log1Args.value.toNumber(), transferAmount, 'Transfer amount is wrong')
        assert.equal(log1Args.data, extraData, 'Data is wrong')

        // reconcile balances
        const afterBalances = { alice: 0, contract: 0, bob: 0 }
        afterBalances.alice = await contracts.tokenMock.balanceOf(actors.alice)
        afterBalances.bob = await contracts.tokenMock.balanceOf(actors.bob)
        afterBalances.contract = await contracts.tokenMock.balanceOf(contracts.receiverMock.address)
        assert.equal(afterBalances.alice.toNumber() - beforeBalances.alice.toNumber(), -transferAmount, 'Alice balance is incorrect')
        assert.equal(afterBalances.contract.toNumber() - beforeBalances.contract.toNumber(), transferAmount, 'Contract balance is incorrect')
        assert.equal(afterBalances.bob.toNumber(), beforeBalances.bob.toNumber(), transferAmount, 'Bob balance is incorrect')

        resolve()
      })
    })
  })
})
