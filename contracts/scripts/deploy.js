// Deploy NightShiftEntry and record it for the game.
//   npm run deploy:hemi    (needs DEPLOYER_PRIVATE_KEY in contracts/.env and test ETH on that address)
//   npm run deploy:local   (a local Hardhat node, for testing the game's wallet flow)
// Writes:
//   contracts/deployments/<network>.json   metadata (address, block, fee, ABI)
//   src/web3/deployments.json              what the game reads (keyed by target: hemiTestnet | local)
// The private key is only read from the environment and is never printed or written anywhere.
// The deployer / owner address is only printed to this local console - never written to a repository file.
const fs = require('fs');
const path = require('path');
const hre = require('hardhat');

async function main() {
  const { ethers, network } = hre;
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error(`No deployer account for "${network.name}". Put DEPLOYER_PRIVATE_KEY in contracts/.env (never commit it).`);
  }
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (network.name === 'hemiTestnet' && chainId !== 743111) throw new Error(`RPC reports chain ${chainId}, expected Hemi Testnet 743111`);
  const fee = ethers.parseEther(process.env.ENTRY_FEE_ETH || '0.001');
  const owner = process.env.OWNER_ADDRESS || deployer.address;
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`network ${network.name} (chain ${chainId})  deployer ${deployer.address}  balance ${ethers.formatEther(bal)} ETH`);
  console.log(`entry fee ${ethers.formatEther(fee)} ETH   owner ${owner}`);
  if (bal === 0n) throw new Error('The deployer has no ETH on this network. Fund it from the Hemi testnet faucet first.');

  const F = await ethers.getContractFactory('NightShiftEntry');
  const c = await F.deploy(fee, owner);
  const tx = c.deploymentTransaction();
  console.log(`deploy tx ${tx.hash} - waiting for confirmation...`);
  const rc = await tx.wait(network.name === 'hemiTestnet' ? 2 : 1);
  const address = await c.getAddress();
  console.log(`NightShiftEntry deployed at ${address} (block ${rc.blockNumber})`);

  const target = network.name === 'hemiTestnet' ? 'hemiTestnet' : 'local';
  const artifact = await hre.artifacts.readArtifact('NightShiftEntry');
  const meta = {
    contract: 'NightShiftEntry', network: network.name, target, chainId, address,
    block: rc.blockNumber,   // no tx hash: it would point at the deployer (verify-deploy.js checks code + state)
    entryFeeWei: fee.toString(), entryFeeEth: ethers.formatEther(fee), deployedAt: new Date().toISOString(),
    explorer: target === 'hemiTestnet' ? `https://testnet.explorer.hemi.xyz/address/${address}` : null,
  };
  const outDir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${network.name}.json`), JSON.stringify({ ...meta, abi: artifact.abi }, null, 2));

  // the game's view: only the known deployment per target (the ABI lives in src/web3/abi.js)
  const gameFile = path.join(__dirname, '..', '..', 'src', 'web3', 'deployments.json');
  const all = fs.existsSync(gameFile) ? JSON.parse(fs.readFileSync(gameFile, 'utf8').replace(/^﻿/, '')) : {};
  // block = where the game starts searching for entry events; no tx hash (it would point at the deployer)
  all[target] = { chainId, address, block: rc.blockNumber, entryFeeWei: meta.entryFeeWei, deployedAt: meta.deployedAt };
  fs.writeFileSync(gameFile, JSON.stringify(all, null, 2) + '\n');
  console.log(`recorded in contracts/deployments/${network.name}.json and src/web3/deployments.json (${target})`);
}

main().catch(e => { console.error(e.message || e); process.exitCode = 1; });
