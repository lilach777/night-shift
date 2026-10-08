// NIGHT SHIFT - wallet connection (wagmi core + viem; no React, no extra UI framework).
// Wallets:
//   * every injected browser wallet that announces itself (EIP-6963): MetaMask, Rabby, Coinbase Wallet
//     extension, Trust Wallet extension, Brave, OKX, Phantom (EVM), ... - plus a legacy window.ethereum
//   * Coinbase Wallet (extension / mobile app through its SDK)
//   * WalletConnect (any WalletConnect-compatible mobile wallet, e.g. Trust Wallet) - needs a project ID
//     (VITE_WALLETCONNECT_PROJECT_ID); without one the option is not offered
// State is event driven (account / chain / connection watchers) - nothing polls the RPC.
// The session persists through wagmi's storage and is silently restored on load (reconnect).
import {
  createConfig, createStorage, http, connect, disconnect, reconnect, getAccount, watchAccount,
  getConnectors, watchConnectors, switchChain,
} from '@wagmi/core';
import { injected, coinbaseWallet, walletConnect } from '@wagmi/connectors';
import { hemiTestnet, HEMI_CHAIN_ID, WALLETCONNECT_PROJECT_ID, DEV_LOCAL } from './chain.js';
import { safeError } from './privacy.js';

const listeners = new Set();

function makeConfig() {
  const connectors = [injected({ shimDisconnect: true })];
  connectors.push(coinbaseWallet({ appName: 'NIGHT SHIFT', preference: { options: 'eoaOnly' } }));
  if (WALLETCONNECT_PROJECT_ID) {
    connectors.push(walletConnect({
      projectId: WALLETCONNECT_PROJECT_ID, showQrModal: true,
      metadata: { name: 'NIGHT SHIFT', description: 'A first-person horror game.', url: location.origin, icons: [] },
      qrModalOptions: { themeMode: 'dark' },
    }));
  }
  return createConfig({
    chains: [hemiTestnet],
    connectors,
    multiInjectedProviderDiscovery: true,
    transports: { [HEMI_CHAIN_ID]: http() },
    storage: createStorage({ storage: window.localStorage, key: 'nightshift.wallet' }),
    ssr: false,
  });
}

export const config = makeConfig();

// ------------------------------------------------------------------ state
export const wallet = {
  status: 'disconnected',      // connecting | reconnecting | connected | disconnected
  address: null,
  chainId: null,
  connectorName: '',
  error: '',
  busy: false,                 // a wallet prompt is open (never stack a second one)
  get connected() { return this.status === 'connected' && !!this.address; },
  get onHemi() { return this.connected && this.chainId === HEMI_CHAIN_ID; },
  get ready() { return this.onHemi; },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
function emit(why) { for (const fn of listeners) { try { fn(wallet, why); } catch (e) { console.error('[wallet]', safeError(e)); } } }

function apply(acc, why) {
  const prevAddr = wallet.address, prevChain = wallet.chainId;
  wallet.status = acc.status;
  wallet.address = acc.address || null;
  wallet.chainId = acc.chainId ?? null;
  wallet.connectorName = acc.connector?.name || '';
  let reason = why;
  if (prevAddr && wallet.address && prevAddr.toLowerCase() !== wallet.address.toLowerCase()) reason = 'account';
  else if (prevChain && wallet.chainId && prevChain !== wallet.chainId) reason = 'chain';
  else if (prevAddr && !wallet.address) reason = 'disconnect';
  emit(reason);
}

let started = false;
export async function startWallet() {
  if (started) return; started = true;
  if (import.meta.env.DEV && DEV_LOCAL) await import('./devwallet.js').then(m => m.installDevWallet()).catch(e => console.warn('[wallet] dev wallet', safeError(e)));
  watchAccount(config, { onChange: acc => apply(acc, 'change') });
  watchConnectors(config, { onChange: () => emit('connectors') });
  apply(getAccount(config), 'init');
  // restore a previous session silently (no prompt): wallets that are locked or revoked stay disconnected
  try { await reconnect(config); } catch { /* stale session: stays disconnected */ }
  apply(getAccount(config), 'restored');
}

// ------------------------------------------------------------------ the wallets offered in the chooser
// Each named wallet is matched to ITS OWN provider by the EIP-6963 reverse-DNS id it announces
// (wagmi turns every announcement into a separate connector whose id is that rdns). Nothing ever
// guesses from window.ethereum, so with MetaMask + Rabby + Trust + Coinbase all installed, picking
// "MetaMask" can only ever talk to MetaMask's provider.
export const CATALOG = [
  { key: 'metamask', name: 'MetaMask', rdns: ['io.metamask', 'io.metamask.flask', 'io.metamask.mmi'], install: 'https://metamask.io/download/' },
  { key: 'rabby', name: 'Rabby', rdns: ['io.rabby'], install: 'https://rabby.io/' },
  { key: 'trust', name: 'Trust Wallet', rdns: ['com.trustwallet.app'], install: 'https://trustwallet.com/browser-extension', mobileViaWalletConnect: true },
  { key: 'coinbase', name: 'Coinbase Wallet', rdns: ['com.coinbase.wallet'], sdk: 'coinbaseWalletSDK' },
];
const CATALOG_RDNS = new Set(CATALOG.flatMap(w => w.rdns));

// legacy (pre-EIP-6963) injected provider: name it from its own flags, most specific first
function legacyName(p) {
  if (!p) return null;
  if (p.isRabby) return 'Rabby';
  if (p.isTrust || p.isTrustWallet) return 'Trust Wallet';
  if (p.isCoinbaseWallet) return 'Coinbase Wallet';
  if (p.isBraveWallet) return 'Brave Wallet';
  if (p.isOkxWallet || p.isOKExWallet) return 'OKX Wallet';
  if (p.isMetaMask) return 'MetaMask';
  return 'Browser Wallet';
}

/**
 * [{ key, name, icon, status, connector, install, note }]
 *   status 'installed'  the extension announced itself: connect with its own connector
 *          'mobile'     not installed here, but reachable through WalletConnect (QR / deep link)
 *          'available'  works without an extension (Coinbase Wallet SDK: mobile app / extension)
 *          'install'    not available here: an official install link only (no fake connect)
 * plus an "other" group: every other announced EVM wallet, a legacy injected one, and WalletConnect.
 */
export function walletOptions() {
  const list = getConnectors(config);
  const announced = list.filter(c => c.type === 'injected' && c.id !== 'injected');
  const byRdns = id => announced.find(c => c.id === id);
  const wc = list.find(c => c.id === 'walletConnect');
  const legacy = !announced.length && window.ethereum ? list.find(c => c.id === 'injected') : null;
  const legacyLabel = legacy ? legacyName(window.ethereum) : null;
  const named = CATALOG.map(w => {
    const inj = w.rdns.map(byRdns).find(Boolean);
    if (inj) return { key: w.key, name: w.name, icon: inj.icon || null, status: 'installed', connector: inj };
    // the Coinbase extension's announcement is folded into the Coinbase SDK connector by wagmi
    if (w.sdk) { const c = list.find(x => x.id === w.sdk); if (c) return { key: w.key, name: w.name, icon: c.icon || null, status: 'available', connector: c, note: 'Extension or mobile app' }; }
    if (legacy && legacyLabel === w.name) return { key: w.key, name: w.name, icon: null, status: 'installed', connector: legacy };
    if (w.mobileViaWalletConnect && wc) return { key: w.key, name: w.name, icon: null, status: 'mobile', connector: wc, note: 'Mobile app - scan the QR code' };
    return { key: w.key, name: w.name, icon: null, status: 'install', connector: null, install: w.install, note: w.mobileViaWalletConnect ? 'Mobile app needs WalletConnect (not configured)' : 'Not installed in this browser' };
  });
  const other = [];
  for (const c of announced) if (!CATALOG_RDNS.has(c.id)) other.push({ key: c.id, name: c.name, icon: c.icon || null, status: 'installed', connector: c });
  if (legacy && !CATALOG.some(w => w.name === legacyLabel)) other.push({ key: 'injected', name: legacyLabel, icon: null, status: 'installed', connector: legacy });
  if (wc) other.push({ key: 'walletconnect', name: 'WalletConnect', icon: null, status: 'mobile', connector: wc, note: 'Any WalletConnect mobile wallet' });
  return { named, other };
}

// ------------------------------------------------------------------ actions (each opens at most one prompt)
export async function connectWallet(opt) {
  if (wallet.busy) return false;
  wallet.busy = true; wallet.error = ''; emit('busy');
  try {
    await connect(config, { connector: opt.connector });
    return true;
  } catch (e) {
    wallet.error = describeWalletError(e, 'connect');
    // a stale / expired WalletConnect pairing: clear it so the next attempt starts a fresh session
    if (opt.connector?.id === 'walletConnect' && /EXPIRED/.test(wallet.error)) { try { await opt.connector.disconnect(); } catch { /* nothing to clear */ } }
    return false;
  } finally { wallet.busy = false; apply(getAccount(config), 'connect'); }
}

export async function disconnectWallet() {
  try { await disconnect(config); } catch { /* already gone */ }
  apply(getAccount(config), 'disconnect');
}

// the wallet's standard switch; wagmi falls back to wallet_addEthereumChain when Hemi is unknown to it
export async function switchToHemi() {
  if (wallet.busy) return false;
  wallet.busy = true; wallet.error = ''; emit('busy');
  try {
    await switchChain(config, { chainId: HEMI_CHAIN_ID });
    return true;
  } catch (e) {
    wallet.error = describeWalletError(e, 'switch');
    return false;
  } finally { wallet.busy = false; apply(getAccount(config), 'switch'); }
}

// ------------------------------------------------------------------ errors in the game's own words
export function isRejection(e) {
  let x = e; for (let i = 0; x && i < 8; i++) { if (x.code === 4001 || x.name === 'UserRejectedRequestError' || /user rejected|denied|rejected the request/i.test(x.message || '')) return true; x = x.cause; }
  return false;
}
export function describeWalletError(e, what) {
  const msg = [e?.shortMessage, e?.details, e?.message, e?.cause?.message].filter(Boolean).join(' | ');
  if (isRejection(e)) return what === 'switch' ? 'NETWORK SWITCH REJECTED IN THE WALLET.' : what === 'connect' ? 'CONNECTION REJECTED IN THE WALLET.' : 'TRANSACTION CANCELLED';
  if (/already pending|-32002/i.test(msg) || e?.code === -32002) return 'YOUR WALLET ALREADY HAS A REQUEST OPEN. CHECK THE WALLET.';
  if (/Connector not found|not installed|Provider not found/i.test(msg)) return 'WALLET UNAVAILABLE. IS THE EXTENSION INSTALLED AND ENABLED?';
  if (/locked|no accounts|unauthorized/i.test(msg)) return 'YOUR WALLET IS LOCKED. UNLOCK IT AND TRY AGAIN.';
  if (/expired|session|pairing/i.test(msg)) return 'THE WALLET SESSION EXPIRED. CONNECT AGAIN.';
  if (/Unrecognized chain|4902|not been added/i.test(msg)) return 'YOUR WALLET COULD NOT ADD HEMI TESTNET.';
  console.warn('[wallet]', what, safeError(e));
  return (what === 'switch' ? 'COULD NOT SWITCH NETWORK. ' : 'WALLET ERROR. ') + 'TRY AGAIN.';
}
