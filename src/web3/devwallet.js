// DEV ONLY (import.meta.env.DEV && ?devwallet=1 | multi) - never part of a production build.
// Real EIP-1193 providers, announced through EIP-6963 exactly like wallet extensions, that forward every
// JSON-RPC call to a local Hardhat node (`npx hardhat node` in contracts/ with LOCAL_CHAIN_ID=743111).
// The node signs eth_sendTransaction with its own unlocked TEST accounts, so no key exists in the browser.
//   ?devwallet=1      one "Dev Test Wallet (local)"
//   ?devwallet=multi  ALSO three mocks announcing MetaMask's, Rabby's and Trust Wallet's real EIP-6963 ids
//                     (named "... (dev mock)"), each with its own account and request log - to prove that
//                     several injected wallets coexist and that picking one never talks to another.
//                     They are NOT the real extensions.
// Controls (window.__devWallet = the primary one, window.__devWallets[rdns] = each):
//   .reject = 'connect' | 'tx' | 'switch'   simulate the user pressing "Reject"
//   .setChain(1)                           pretend the wallet is on another network
//   .account(i) / .disconnect()            account switch / wallet disconnect
//   .tamperValue = '0x1'                   send the wrong fee once (on-chain revert)
//   .calls                                 every method this provider was asked for
const NODE = 'http://127.0.0.1:8545';
let rpcId = 0;
const node = async (method, params = []) => {
  const r = await fetch(NODE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  const j = await r.json();
  if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data });
  return j.result;
};
const hex = n => '0x' + n.toString(16);
const rejected = () => Object.assign(new Error('User rejected the request.'), { code: 4001 });
const glyph = (c, col) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#222"/><text x="12" y="16" font-size="12" text-anchor="middle" fill="${col}" font-family="monospace">${c}</text></svg>`)}`;

function makeWallet(key, defaultIdx) {
  const store = 'nightshift.devwallet' + (key ? '.' + key : '');
  const remembered = (() => { try { return JSON.parse(localStorage.getItem(store) || 'null'); } catch { return null; } })();
  const S = { accounts: null, idx: remembered?.idx ?? defaultIdx, chain: 743111, connected: !!remembered?.connected, reject: null, txs: [], calls: [], tamperValue: null };
  const remember = () => { try { localStorage.setItem(store, JSON.stringify({ connected: S.connected, idx: S.idx })); } catch { /* ignore */ } };   // like an extension's site permission
  const listeners = {};
  const emit = (ev, v) => (listeners[ev] || []).forEach(f => { try { f(v); } catch (e) { console.error(e); } });
  const provider = {
    isDevWallet: true,
    on(ev, f) { (listeners[ev] ||= []).push(f); return provider; },
    removeListener(ev, f) { listeners[ev] = (listeners[ev] || []).filter(x => x !== f); return provider; },
    async request({ method, params = [] }) {
      S.calls.push(method);
      if (!S.accounts) S.accounts = await node('eth_accounts');
      const me = S.accounts[S.idx];
      switch (method) {
        case 'eth_requestAccounts':
          if (S.reject === 'connect') { S.reject = null; throw rejected(); }
          S.connected = true; remember(); emit('connect', { chainId: hex(S.chain) }); return [me];
        case 'eth_accounts': return S.connected ? [me] : [];
        case 'eth_chainId': return hex(S.chain);
        case 'net_version': return String(S.chain);
        case 'wallet_requestPermissions': S.connected = true; remember(); return [{ parentCapability: 'eth_accounts' }];
        case 'wallet_revokePermissions': S.connected = false; remember(); return null;
        case 'wallet_switchEthereumChain': {
          if (S.reject === 'switch') { S.reject = null; throw rejected(); }
          const want = parseInt(params[0].chainId, 16);
          if (want !== 743111) throw Object.assign(new Error('Unrecognized chain'), { code: 4902 });
          S.chain = want; emit('chainChanged', hex(want)); return null;
        }
        case 'wallet_addEthereumChain': return null;
        case 'eth_sendTransaction': {
          if (S.reject === 'tx') { S.reject = null; throw rejected(); }
          if (S.chain !== 743111) throw new Error('wrong chain');
          const tx = { ...params[0], from: me };
          if (S.tamperValue != null) { tx.value = S.tamperValue; S.tamperValue = null; tx.gas = '0x30000'; }   // force a revert (wrong fee)
          const h = await node('eth_sendTransaction', [tx]);
          S.txs.push(h);
          return h;
        }
        default: return node(method, params);
      }
    },
  };
  return Object.assign(S, {
    provider,
    account(i) { S.idx = i; remember(); emit('accountsChanged', S.connected ? [S.accounts[i]] : []); },
    setChain(c) { S.chain = c; emit('chainChanged', hex(c)); },
    disconnect() { S.connected = false; remember(); emit('accountsChanged', []); emit('disconnect', { code: 4900 }); },
  });
}

function announce(info, provider) {
  const detail = Object.freeze({ info: Object.freeze(info), provider });
  const fire = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
  window.addEventListener('eip6963:requestProvider', fire);
  fire();
}

export function installDevWallet() {
  const mode = new URLSearchParams(location.search).get('devwallet');
  const primary = makeWallet('', 1);
  window.__devWallet = primary;
  window.__devWallets = { 'dev.nightshift.testwallet': primary };
  announce({ uuid: 'b7e2c0de-0000-4000-8000-000000000001', name: 'Dev Test Wallet (local)', icon: glyph('D', '#aaa'), rdns: 'dev.nightshift.testwallet' }, primary.provider);
  if (mode === 'multi') {
    const mocks = [
      ['io.metamask', 'MetaMask (dev mock)', 'M', '#e8831d', 2],
      ['io.rabby', 'Rabby (dev mock)', 'R', '#7084ff', 3],
      ['com.trustwallet.app', 'Trust Wallet (dev mock)', 'T', '#3375bb', 4],
    ];
    mocks.forEach(([rdns, name, c, col, idx], i) => {
      const w = makeWallet(rdns, idx);
      window.__devWallets[rdns] = w;
      announce({ uuid: `b7e2c0de-0000-4000-8000-00000000001${i}`, name, icon: glyph(c, col), rdns }, w.provider);
    });
  }
  console.info('[devwallet] local test wallet(s) installed:', Object.keys(window.__devWallets).join(', '));
}
