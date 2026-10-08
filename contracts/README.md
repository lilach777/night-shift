# NightShiftEntry - contract developer guide

Developer documentation for the game's entry-fee contract. Players do not need any of this.

`contracts/NightShiftEntry.sol` (Solidity 0.8.24, OpenZeppelin `Ownable2Step` + `ReentrancyGuard`):

- `enter(bytes32 sessionRef, uint8 mode)` - pays the exact, immutable `entryFee` for one session
  (`1` = single-player New Game, `2` = multiplayer party creator). Each `(payer, sessionRef)` can be paid once.
- `entryOf(payer, sessionRef)` - read-only lookup; the `Entered` event is what the game uses to verify parties.
- `withdraw(to)` - owner only: moves the collected testnet fees out.
- Plain ETH transfers and unknown calls are rejected. No tokens, NFTs, approvals, upgrades or pause switch.

The deployed address lives in `deployments/hemiTestnet.json` and `../src/web3/deployments.json`.

## Setup

```bash
cd contracts
npm install
npm test
```

Copy `.env.example` to `.env`. `.env` is git-ignored and must never be committed, shared or used in the frontend.
Only ever use a dedicated **throwaway testnet** wallet for deployment, never a personal wallet.

| Variable | Purpose |
|---|---|
| `DEPLOYER_PRIVATE_KEY` | key of the throwaway testnet deployer (required for Hemi deployment only) |
| `ENTRY_FEE_ETH` | entry fee, default `0.001` |
| `OWNER_ADDRESS` | optional owner, defaults to the deployer |
| `HEMI_RPC_URL` | optional RPC override |

## Deploy to Hemi Testnet

1. Fund the deployer address with a little Hemi Testnet ETH from the Hemi faucet.
2. `npx hardhat run scripts/preflight.js --network hemiTestnet` - read-only: balance, cost estimate, and a check
   that the key appears nowhere outside `.env`.
3. `npm run deploy:hemi` - deploys and writes the address into `deployments/hemiTestnet.json` and
   `../src/web3/deployments.json` (no deployer address or transaction hash is written).
4. `npm run smoke:hemi` - one real entry transaction, then checks the receipt, event and on-chain record.
5. `npx hardhat run scripts/verify-deploy.js --network hemiTestnet` - read-only check of the deployed contract from
   its address alone: bytecode matches this repository, fee, ownership state, direct-payment rejection.

## Local testing (no real funds)

```bash
LOCAL_CHAIN_ID=743111 npx hardhat node      # a local chain that mirrors Hemi's chain id
npm run deploy:local                        # in a second terminal
```

Then run the game with `npm run dev` and open it with `?devwallet=1` (or `?devwallet=multi` for several mock
wallets). The dev wallet exists only in development builds; it never ships in `npm run build`.
