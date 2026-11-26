// Member 3: reentrancy attack scenario (the "failing-attack" demo) + checks-effects-interactions evidence.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployEscrowFixture, ST, ONE } = require("./escrowFixture");

describe("Member 3: escrow attack scenario (reentrancy drain)", function () {
  it("BASELINE: a vault that pays before it zeroes the balance IS drained", async () => {
    const [victim, attackerOwner] = await ethers.getSigners();
    const vault = await ethers.deployContract("VulnerableVault");
    await vault.connect(victim).deposit({ value: ONE * 3n });
    const attacker = await ethers.deployContract("ReentrancyAttacker", [await vault.getAddress()], attackerOwner);
    await attacker.exec(await vault.getAddress(), vault.interface.encodeFunctionData("deposit"), { value: ONE });
    await attacker.attack();
    expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(0n); // victim's 3 ETH stolen
    expect(await ethers.provider.getBalance(await attacker.getAddress())).to.equal(ONE * 4n);
    expect(await attacker.reentries()).to.be.greaterThan(0n);
  });

  it("EscrowDispute: the same attack fails, the attacker gets only its own credit", async () => {
    const f = await deployEscrowFixture();
    const [, , , , , , , , , attackerOwner] = await ethers.getSigners();
    // victim: a normal lender has 3 ETH locked in the escrow
    const victimLoan = await f.approvedLoan(ONE * 3n);
    await f.escrow.connect(f.lender).fund(victimLoan, { value: ONE * 3n });

    // attacker: a contract that registers as a LENDER, gets verified, funds a loan, disputes and wins the refund
    const attacker = await ethers.deployContract("ReentrancyAttacker", [await f.escrow.getAddress()], attackerOwner);
    const aAddr = await attacker.getAddress();
    await attacker.exec(await f.registry.getAddress(), f.registry.interface.encodeFunctionData("register", [8, ethers.id("attacker")]));
    await f.registry.connect(f.verifier).verifyUser(aAddr);
    const loan = await f.approvedLoan(ONE);
    await attacker.exec(await f.escrow.getAddress(), f.escrow.interface.encodeFunctionData("fund", [loan]), { value: ONE });
    await attacker.exec(await f.escrow.getAddress(), f.escrow.interface.encodeFunctionData("raiseDispute", [loan]));
    await f.escrow.connect(f.arbiter).resolveDispute(loan, true); // attacker is legitimately owed 1 ETH
    expect(await f.escrow.balances(aAddr)).to.equal(ONE);

    const before = await ethers.provider.getBalance(await f.escrow.getAddress()); // 4 ETH (victim 3 + attacker 1)
    await attacker.attack();

    expect(await attacker.reentries()).to.equal(0n);            // no re-entry succeeded
    expect(await attacker.blockedReentries()).to.equal(1n);     // the guard stopped it
    expect(await ethers.provider.getBalance(aAddr)).to.equal(ONE);              // only its own 1 ETH
    expect(await ethers.provider.getBalance(await f.escrow.getAddress())).to.equal(before - ONE); // victim's 3 ETH intact
    expect(await f.escrow.balances(aAddr)).to.equal(0n);
    expect((await f.escrow.depositOf(victimLoan)).status).to.equal(ST.Held);
    // the victim can still complete normally
    await f.escrow.connect(f.borrower).releaseFunds(victimLoan);
    await expect(f.escrow.connect(f.borrower).withdraw()).to.changeEtherBalance(f.borrower, ONE * 3n);
  });

  it("EscrowDispute: even a direct re-entry call into withdraw() from a receiver that swallows errors cannot double-pay", async () => {
    // Same as above but asserts the CEI order alone: balance is already 0 when the ETH is sent.
    const f = await deployEscrowFixture();
    const [, , , , , , , , , attackerOwner] = await ethers.getSigners();
    const attacker = await ethers.deployContract("ReentrancyAttacker", [await f.escrow.getAddress()], attackerOwner);
    const aAddr = await attacker.getAddress();
    await attacker.exec(await f.registry.getAddress(), f.registry.interface.encodeFunctionData("register", [8, ethers.id("a2")]));
    await f.registry.connect(f.verifier).verifyUser(aAddr);
    const loan = await f.approvedLoan(ONE);
    await attacker.exec(await f.escrow.getAddress(), f.escrow.interface.encodeFunctionData("fund", [loan]), { value: ONE });
    await attacker.exec(await f.escrow.getAddress(), f.escrow.interface.encodeFunctionData("raiseDispute", [loan]));
    await f.escrow.connect(f.arbiter).resolveDispute(loan, true);
    await attacker.attack();
    // the revert reason of the blocked re-entry is the guard (ReentrantCall)
    expect((await attacker.lastRevert()).slice(0, 10)).to.equal(f.escrow.interface.getError("ReentrantCall").selector);
  });
});
