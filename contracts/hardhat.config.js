// NIGHT SHIFT contracts - Hardhat configuration.
// Secrets come ONLY from environment variables (contracts/.env, git-ignored):
//   DEPLOYER_PRIVATE_KEY   the testnet deployer key - never committed, never printed
//   HEMI_RPC_URL           optional override of the public Hemi Testnet RPC
//   ENTRY_FEE_ETH          the entry fee to deploy with (default 0.001 test ETH)
//   LOCAL_CHAIN_ID         chain id of the local test node (743111 mirrors Hemi for UI testing)
require('dotenv').config();
require('@nomicfoundation/hardhat-toolbox');

const key = process.env.DEPLOYER_PRIVATE_KEY;

module.exports = {
  solidity: { version: '0.8.24', settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris' } },
  networks: {
    hardhat: { chainId: Number(process.env.LOCAL_CHAIN_ID || 31337) },
    localhost: { url: 'http://127.0.0.1:8545', chainId: Number(process.env.LOCAL_CHAIN_ID || 31337) },
    hemiTestnet: {
      url: process.env.HEMI_RPC_URL || 'https://testnet.rpc.hemi.network/rpc',
      chainId: 743111,
      accounts: key ? [key] : [],
    },
  },
};

