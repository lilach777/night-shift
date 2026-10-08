const { expect } = require('chai');
const { ethers } = require('hardhat');

const FEE = ethers.parseEther('0.001');
const SP = 1, HOST = 2;
const ref = s => ethers.keccak256(ethers.toUtf8Bytes(s));

describe('NightShiftEntry', () => {
  let c, owner, host, joiner, other;
  beforeEach(async () => {
    [owner, host, joiner, other] = await ethers.getSigners();
    c = await (await ethers.getContractFactory('NightShiftEntry')).deploy(FEE, owner.address);
  });

  it('stores the configured fee and owner', async () => {
    expect(await c.entryFee()).to.equal(FEE);
    expect(await c.owner()).to.equal(owner.address);
  });

  it('rejects a zero fee at deployment', async () => {
    const F = await ethers.getContractFactory('NightShiftEntry');
    await expect(F.deploy(0, owner.address)).to.be.revertedWithCustomError(F, 'InvalidFee');
  });

  it('single player: the exact fee enters and emits Entered', async () => {
    const r = ref('sp-1');
    await expect(c.connect(host).enter(r, SP, { value: FEE })).to.emit(c, 'Entered').withArgs(host.address, r, SP, FEE);
    const [mode] = await c.entryOf(host.address, r);
    expect(mode).to.equal(SP);
    expect(await ethers.provider.getBalance(await c.getAddress())).to.equal(FEE);
  });

  it('party creator pays once: entry recorded for the host', async () => {
    const r = ref('party-ABCDE');
    await c.connect(host).enter(r, HOST, { value: FEE });
    const [mode] = await c.entryOf(host.address, r);
    expect(mode).to.equal(HOST);
  });

  it('joiners need no transaction: the party is verifiable read-only, joiner has no entry', async () => {
    const r = ref('party-XYZ');
    await c.connect(host).enter(r, HOST, { value: FEE });
    const [hostMode] = await c.entryOf(host.address, r);
    const [joinerMode] = await c.entryOf(joiner.address, r);
    expect(hostMode).to.equal(HOST);
    expect(joinerMode).to.equal(0);          // joiner never paid and never needs to
  });

  it('rejects zero payment', async () => {
    await expect(c.connect(host).enter(ref('a'), SP, { value: 0 })).to.be.revertedWithCustomError(c, 'WrongFee').withArgs(0, FEE);
  });

  it('rejects underpayment and overpayment', async () => {
    await expect(c.connect(host).enter(ref('a'), SP, { value: FEE - 1n })).to.be.revertedWithCustomError(c, 'WrongFee');
    await expect(c.connect(host).enter(ref('a'), SP, { value: FEE + 1n })).to.be.revertedWithCustomError(c, 'WrongFee');
  });

  it('rejects a duplicate entry for the same payer + session', async () => {
    const r = ref('dup');
    await c.connect(host).enter(r, SP, { value: FEE });
    await expect(c.connect(host).enter(r, SP, { value: FEE })).to.be.revertedWithCustomError(c, 'AlreadyEntered').withArgs(host.address, r);
  });

  it('a different payer cannot squat or block someone else\'s session reference', async () => {
    const r = ref('shared');
    await c.connect(other).enter(r, HOST, { value: FEE });          // front-runs the same ref
    await expect(c.connect(host).enter(r, HOST, { value: FEE })).to.emit(c, 'Entered');   // host still enters
  });

  it('rejects an empty session reference and invalid modes', async () => {
    await expect(c.connect(host).enter(ethers.ZeroHash, SP, { value: FEE })).to.be.revertedWithCustomError(c, 'InvalidSession');
    await expect(c.connect(host).enter(ref('m'), 0, { value: FEE })).to.be.revertedWithCustomError(c, 'InvalidMode');
    await expect(c.connect(host).enter(ref('m'), 3, { value: FEE })).to.be.reverted;   // out of enum range
  });

  it('refuses plain ETH transfers and unknown calls', async () => {
    await expect(host.sendTransaction({ to: await c.getAddress(), value: FEE })).to.be.revertedWithCustomError(c, 'DirectPaymentRejected');
    await expect(host.sendTransaction({ to: await c.getAddress(), value: FEE, data: '0x12345678' })).to.be.revertedWithCustomError(c, 'DirectPaymentRejected');
  });

  it('only the owner can withdraw, to a real address, and only when funds exist', async () => {
    await expect(c.connect(owner).withdraw(owner.address)).to.be.revertedWithCustomError(c, 'NothingToWithdraw');
    await c.connect(host).enter(ref('w'), SP, { value: FEE });
    await expect(c.connect(host).withdraw(host.address)).to.be.revertedWithCustomError(c, 'OwnableUnauthorizedAccount');
    await expect(c.connect(owner).withdraw(ethers.ZeroAddress)).to.be.revertedWithCustomError(c, 'InvalidRecipient');
    await expect(c.connect(owner).withdraw(other.address)).to.changeEtherBalances([c, other], [-FEE, FEE]);
  });

  it('ownership moves only in two steps', async () => {
    await c.connect(owner).transferOwnership(other.address);
    expect(await c.owner()).to.equal(owner.address);
    await c.connect(other).acceptOwnership();
    expect(await c.owner()).to.equal(other.address);
  });
});
