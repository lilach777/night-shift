// Read-only pre-deployment check for Hemi Testnet. Never prints the key - only the public address.
//   npx hardhat run scripts/preflight.js --network hemiTestnet
const fs = require('fs');
const path = require('path');
const hre = require('hardhat');

function scan(dir, needle, hits, skip) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (skip.some(s => p.includes(s))) continue;
    if (e.isDirectory()) scan(p, needle, hits, skip);
    else if (e.isFile() && fs.statSync(p).size < 20 * 1024 * 1024) {
      try { if (fs.readFileSync(p, 'utf8').toLowerCase().includes(needle)) hits.push(path.relative(path.join(__dirname, '..', '..'), p)); } catch { /* binary */ }
    }
  }
}

async function main() {
  const { ethers, network } = hre;
  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error('DEPLOYER_PRIVATE_KEY did not load');
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const bal = await ethers.provider.getBalance(signer.address);
  const nonce = await ethers.provider.getTransactionCount(signer.address);
  const fee = ethers.parseEther(process.env.ENTRY_FEE_ETH || '0.001');
  // a realistic cost estimate: deployment gas + one smoke entry (fee + gas) at the current gas price
  const F = await ethers.getContractFactory('NightShiftEntry');
  const deployTx = await F.getDeployTransaction(fee, signer.address);
  const deployGas = await ethers.provider.estimateGas({ ...deployTx, from: signer.address });
  const gp = (await ethers.provider.getFeeData()).gasPrice;
  const estimate = (deployGas + 120000n) * gp + fee;
  // the key must exist nowhere except contracts/.env
  const key = (process.env.DEPLOYER_PRIVATE_KEY || '').toLowerCase().replace(/^0x/, '');
  const hits = [];
  const root = path.join(__dirname, '..', '..');
  for (const d of ['src', 'public', 'dist', 'blender', 'tools', 'contracts']) {
    const p = path.join(root, d);
    if (fs.existsSync(p)) scan(p, key, hits, ['node_modules', path.join('contracts', '.env'), path.join('contracts', 'cache')]);
  }
  for (const f of ['index.html', 'vite.config.js', 'package.json', 'README.md']) { const p = path.join(root, f); if (fs.existsSync(p) && fs.readFileSync(p, 'utf8').toLowerCase().includes(key)) hits.push(f); }
  console.log(JSON.stringify({
    network: network.name, rpc: network.config.url, chainId,
    deployer: signer.address, balanceEth: ethers.formatEther(bal), nonce,
    entryFeeEth: ethers.formatEther(fee),
    estDeployGas: deployGas.toString(), gasPriceGwei: ethers.formatUnits(gp, 'gwei'),
    estTotalCostEth: ethers.formatEther(estimate), enoughFunds: bal > estimate,
    keyFoundOutsideEnv: hits,
  }, null, 1));
}
main().catch(e => { console.error(e.message || e); process.exitCode = 1; });
