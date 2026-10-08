// Read-only check that the recorded deployment is the NightShiftEntry built from this repository.
// Uses only the contract address and on-chain state - no deployment transaction hash.
//   npx hardhat run scripts/verify-deploy.js --network hemiTestnet
// Checks: chain id, the runtime bytecode equals the compiled artifact (immutable slots aside, then the
// immutable entryFee is checked through its getter), the code appears at the recorded block (where the
// RPC serves historical state), fee, two-step ownership state, and the rejection of plain transfers.
// The owner is printed shortened only.
const hre = require('hardhat');

const short = a => (a ? `${a.slice(0, 6)}...${a.slice(-4)}` : null);

// blank the immutable-variable byte ranges so compiled and deployed code can be compared
function maskImmutables(hex, refs) {
  const b = Buffer.from(hex.replace(/^0x/, ''), 'hex');
  for (const ranges of Object.values(refs || {})) for (const { start, length } of ranges) b.fill(0, start, start + length);
  return b.toString('hex');
}

(async () => {
  const meta = require(`../deployments/${hre.network.name}.json`);
  const p = hre.ethers.provider;
  const chainId = Number((await p.getNetwork()).chainId);
  const fqn = 'contracts/NightShiftEntry.sol:NightShiftEntry';
  const artifact = await hre.artifacts.readArtifact(fqn);
  const build = await hre.artifacts.getBuildInfo(fqn);
  const refs = build.output.contracts['contracts/NightShiftEntry.sol'].NightShiftEntry.evm.deployedBytecode.immutableReferences;

  const code = await p.getCode(meta.address);
  const hasCode = code && code !== '0x';
  const bytecodeMatches = hasCode && maskImmutables(code, refs) === maskImmutables(artifact.deployedBytecode, refs);
  if (!bytecodeMatches) {
    console.log(JSON.stringify({ network: hre.network.name, chainId, address: meta.address, hasCode, bytecodeMatchesArtifact: false, ok: false }, null, 1));
    process.exitCode = 1; return;
  }

  // the code exists at the recorded block and not before it (skipped if the RPC has no historical state)
  let deployedAtRecordedBlock = 'unavailable';
  try {
    const [before, at] = await Promise.all([p.getCode(meta.address, meta.block - 1), p.getCode(meta.address, meta.block)]);
    deployedAtRecordedBlock = before === '0x' && at === code;
  } catch { /* no archive state on this RPC */ }

  const c = new hre.ethers.Contract(meta.address, meta.abi, p);
  const [fee, owner, pendingOwner, balance] = await Promise.all([c.entryFee(), c.owner(), c.pendingOwner(), p.getBalance(meta.address)]);

  // a plain ETH transfer must be refused (receive() reverts) - a static call, nothing is sent
  let rejectsDirectPayment = false;
  try { await p.call({ to: meta.address, value: 1n, from: hre.ethers.ZeroAddress }); } catch { rejectsDirectPayment = true; }

  const result = {
    network: hre.network.name, chainId, address: meta.address,
    hasCode, bytecodeBytes: hasCode ? (code.length - 2) / 2 : 0, bytecodeMatchesArtifact: bytecodeMatches,
    deployedAtRecordedBlock, recordedBlock: meta.block,
    entryFeeEth: hre.ethers.formatEther(fee), feeMatchesRecord: fee.toString() === meta.entryFeeWei,
    owner: short(owner), pendingOwner: pendingOwner === hre.ethers.ZeroAddress ? 'none' : short(pendingOwner),
    rejectsDirectPayment, contractBalanceEth: hre.ethers.formatEther(balance),
  };
  result.ok = chainId === meta.chainId && hasCode && bytecodeMatches && result.feeMatchesRecord && rejectsDirectPayment && deployedAtRecordedBlock !== false;
  console.log(JSON.stringify(result, null, 1));
  if (!result.ok) process.exitCode = 1;
})().catch(e => { console.error(e.message); process.exitCode = 1; });
