// After deploying to Hemi Testnet: one real entry transaction from the deployer, then verify the
// receipt, the Entered event and the on-chain record.   npm run smoke:hemi
const fs = require('fs');
const path = require('path');
const hre = require('hardhat');

async function main() {
  const { ethers, network } = hre;
  const meta = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'deployments', `${network.name}.json`), 'utf8'));
  const [signer] = await ethers.getSigners();
  const c = new ethers.Contract(meta.address, meta.abi, signer);
  const fee = await c.entryFee();
  const ref = ethers.hexlify(ethers.randomBytes(32));
  console.log(`entering session ${ref} with ${ethers.formatEther(fee)} ETH from ${signer.address}`);
  const tx = await c.enter(ref, 1, { value: fee });
  console.log(`tx ${tx.hash}`);
  const rc = await tx.wait(1);
  const ev = rc.logs.map(l => { try { return c.interface.parseLog(l); } catch { return null; } }).find(e => e?.name === 'Entered');
  const [mode] = await c.entryOf(signer.address, ref);
  console.log(`status ${rc.status}  block ${rc.blockNumber}  event ${ev ? 'Entered' : 'MISSING'}  recorded mode ${mode}`);
  if (meta.explorer) console.log(`explorer https://testnet.explorer.hemi.xyz/tx/${tx.hash}`);
  try { await c.enter(ref, 1, { value: fee }); console.log('DUPLICATE WAS ACCEPTED (unexpected)'); }
  catch (e) { console.log('duplicate entry correctly rejected'); }
}
main().catch(e => { console.error(e.message || e); process.exitCode = 1; });
