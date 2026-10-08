const hre = require('hardhat');
(async () => {
  const meta = require('../deployments/hemiTestnet.json');
  const p = hre.ethers.provider; const c = new hre.ethers.Contract(meta.address, meta.abi, p);
  const h = process.env.SMOKE_TX;
  const [rc, tx] = await Promise.all([p.getTransactionReceipt(h), p.getTransaction(h)]);
  const ev = rc.logs.filter(l => l.address.toLowerCase() === meta.address.toLowerCase()).map(l => c.interface.parseLog(l)).find(e => e?.name === 'Entered');
  const [mode] = await c.entryOf(ev.args.payer, ev.args.sessionRef);
  console.log(JSON.stringify({ status: rc.status, block: rc.blockNumber, to: rc.to, valueEth: hre.ethers.formatEther(tx.value),
    event: ev.name, payer: ev.args.payer, sessionRef: ev.args.sessionRef, mode: Number(ev.args.mode), feeEth: hre.ethers.formatEther(ev.args.fee), onChainEntryMode: Number(mode),
    contractBalanceEth: hre.ethers.formatEther(await p.getBalance(meta.address)), deployerBalanceEth: hre.ethers.formatEther(await p.getBalance(tx.from)) }, null, 1));   // the smoke tx is sent by the deployer
})().catch(e => { console.error(e.message); process.exitCode = 1; });
