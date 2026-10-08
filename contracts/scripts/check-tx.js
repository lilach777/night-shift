const hre = require('hardhat');
(async () => {
  const meta = require('../deployments/localhost.json');
  const c = new hre.ethers.Contract(meta.address, meta.abi, hre.ethers.provider);
  const rc = await hre.ethers.provider.getTransactionReceipt(process.argv[2] || process.env.TX);
  const ev = rc.logs.map(l => { try { return c.interface.parseLog(l); } catch { return null; } }).filter(Boolean);
  const e = ev.find(x => x.name === 'Entered');
  const [mode] = await c.entryOf(e.args.payer, e.args.sessionRef);
  console.log(JSON.stringify({ status: rc.status, to: rc.to, event: e.name, payer: e.args.payer, mode: Number(mode), fee: e.args.fee.toString(), balance: (await hre.ethers.provider.getBalance(meta.address)).toString() }));
})();
