// NIGHT SHIFT - the ONE place the chain and RPC are defined.
// Everything Web3 in the game imports from here; nothing else hard-codes an RPC.
//
//   Hemi Testnet (Hemi Sepolia)   chain 743111   currency ETH
//   RPC        https://testnet.rpc.hemi.network/rpc   (override: VITE_HEMI_RPC_URL)
//   Explorer   https://testnet.explorer.hemi.xyz
//
// The game is free to play: it only connects a wallet on this network and never sends a transaction.
import { defineChain } from 'viem';

export const HEMI_CHAIN_ID = 743111;
export const HEMI_EXPLORER = 'https://testnet.explorer.hemi.xyz';
const RPC = import.meta.env.VITE_HEMI_RPC_URL || 'https://testnet.rpc.hemi.network/rpc';

// DEV ONLY: `?devwallet=1` points the game at a local Hardhat node that mirrors chain 743111 (see
// src/web3/devwallet.js) so the wallet flow can be tested without a browser extension.
// A production build ignores it entirely.
export const DEV_LOCAL = import.meta.env.DEV && ['1', 'multi'].includes(new URLSearchParams(location.search).get('devwallet'));

export const hemiTestnet = defineChain({
  id: HEMI_CHAIN_ID,
  name: 'Hemi Testnet',
  nativeCurrency: { name: 'Testnet Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [DEV_LOCAL ? 'http://127.0.0.1:8545' : RPC] } },
  blockExplorers: { default: { name: 'Hemi Explorer', url: HEMI_EXPLORER } },
  testnet: true,
});

export const WALLETCONNECT_PROJECT_ID = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '';

export const shortAddr = a => (a && /^0x[0-9a-fA-F]{40}$/.test(a) ? `${a.slice(0, 6)}...${a.slice(-4)}`.toUpperCase().replace('0X', '0x') : '');
