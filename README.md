# NIGHT SHIFT

A first-person browser horror game. Arman's first night shift as a security guard at the
abandoned four-storey **St. Mercy Hospital**. At 2:13 AM the reception phone rings.

Built with **three.js (WebGL 2)** and **Vite**. Every model, texture, rig and animation was
authored in **Blender 5.2** through Python build scripts; every sound was synthesised for the
game; voices are offline TTS, processed and baked into audio files (no online services needed).

## Run it

```bash
npm install
npm run dev          # http://localhost:5173  (dev build: press ` for the debug panel)
npm run build        # production build -> dist/
npm run preview      # serve dist/ at http://localhost:4173
node tools/smoke-test.mjs http://localhost:4173/   # checks every asset is served
```

Deploy: upload the contents of `dist/` to any static host (itch.io HTML5 zip, GitHub Pages,
Netlify, S3/CloudFront, nginx). The build uses relative paths, so it also works from a sub-folder.
Serve `.ogg` as `audio/ogg` and `.glb` as `model/gltf-binary` (most hosts do this by default).

Supported: desktop Chrome, Edge and Firefox with WebGL 2 and hardware acceleration.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Mouse | Look (pointer lock; drag-to-look fallback if the browser refuses lock) |
| Shift | Sprint (stamina) |
| Ctrl (or C) | Crouch |
| E | Interact / close documents |
| F | Flashlight on/off |
| R | Replace battery |
| Esc | Pause |
| Space | Skip the intro |
| V | Push-to-talk (multiplayer; key and voice mode can be changed in Settings) |

## Multiplayer

Up to 4 players, peer-to-peer (WebRTC via PeerJS, host-authoritative). The creator gets a 5-character party code
to share; friends enter it under JOIN PARTY. Late joiners drop into a night in progress, players who disconnect
can REJOIN with their slot, items and lives, and if the host leaves another player takes over automatically.

## Project layout

```
blender/
  scripts/        Blender build scripts (run inside Blender; see below)
  Environment/    hospital.blend        (all floors + exterior)
  Characters/     koala.blend           (mesh, rig, 15 actions) + MPFB human characters
  Props/          items.blend           (doors, flashlight, fuse, phones, car, Arman's double...)
  Materials/      materials.blend       (material library)
  Animations/     koala_animations.blend
  Textures/       procedural textures (colour / normal / roughness, decal atlas)
  audio_src/      raw TTS renders (input to the voice processing)
  layout.json     building layout consumed by Blender
public/assets/
  models/         hospital.glb, items.glb, koala.glb
  audio/          music/ ambience/ environment/ player/ monster/ voice/ ui/   (Ogg Vorbis)
src/              game code (core, world, player, monster, systems, audio, ui)
  mp/             multiplayer (networking, lobby, session sync, voice)
  web3/           wallet connection, Hemi Testnet config, entry payment, privacy helpers
contracts/        NightShiftEntry (Solidity, Hardhat + OpenZeppelin): contract, tests, deploy/verify scripts
tools/            gen-layout.mjs, tts.ps1, smoke-test.mjs
```

## Rebuilding the assets

1. `node tools/gen-layout.mjs` — regenerates the building layout (rooms, props, walls, doors,
   lights, fuse/battery spots, navigation graph) into `src/data/layout.json` and `blender/layout.json`.
2. In Blender (Python console or the MCP bridge), with `blender/scripts` on `sys.path`:
   ```python
   import ns_tex, ns_hospital, ns_items, ns_koala, ns_audio
   ns_tex.build_all()          # textures
   ns_hospital.build()         # -> public/assets/models/hospital.glb
   ns_items.build()            # -> items.glb
   ns_koala.build()            # -> koala.glb (sculpt, rig, weights, 15 animations)
   ns_audio.build_all()        # -> public/assets/audio/**/*.ogg (needs blender/audio_src/voice)
   ```
3. `powershell -ExecutionPolicy Bypass -File tools/tts.ps1` — re-renders the raw voice lines
   with the Windows SAPI voices (only needed if you change the dialogue).

## Debug (development builds only)

`npm run dev`, then press <kbd>`</kbd>: FPS / draw calls, stage + AI state, fuse seed and locations,
teleports, fuse markers, spawn any Koala encounter, trigger any horror event, blackout, restore
power, phone call, morgue sequence, final sequence, god mode. `?seed=123` fixes the fuse layout.
None of this code ships in `npm run build`.

## Wallet & entry fee (Hemi Testnet)

Every player connects an EVM wallet (installed extensions via EIP-6963, Coinbase Wallet, and WalletConnect when
`VITE_WALLETCONNECT_PROJECT_ID` is set) and must be on **Hemi Testnet (chain 743111)**.

| Action | Wallet + Hemi | Entry fee |
|---|---|---|
| Single player NEW GAME | required | paid (real transaction) |
| Single player CONTINUE | required | none |
| Multiplayer CREATE PARTY | required | paid once, by the creator |
| Multiplayer JOIN PARTY | required | none |

Configuration lives in one place: `src/web3/chain.js` (chain, RPC, explorer) and `src/web3/deployments.json`
(the deployed contract, written by the deploy script). The fee is set at deployment (`ENTRY_FEE_ETH`) and read
from the contract by the game.

Deploying the contract (`contracts/`, Hardhat + OpenZeppelin):

1. `cd contracts && npm install`
2. Copy `.env.example` to `.env` and put a **throwaway testnet** key in `DEPLOYER_PRIVATE_KEY` (never commit it).
3. Fund that address with Hemi Testnet ETH from the Hemi faucet.
4. `npm test` then `npm run deploy:hemi` (writes the address into `src/web3/deployments.json`), then `npm run smoke:hemi`.
5. Any time later: `npx hardhat run scripts/verify-deploy.js --network hemiTestnet` checks the deployed contract
   (bytecode, fee, ownership state) from its address alone.

The game itself needs no `.env`. Optional build-time variables: `VITE_HEMI_RPC_URL` (another Hemi RPC) and
`VITE_WALLETCONNECT_PROJECT_ID` (enables WalletConnect / mobile wallets). Both are public values, not secrets.

Local testing without spending anything: `LOCAL_CHAIN_ID=743111 npx hardhat node`, `npm run deploy:local`,
then open the game with `?devwallet=1` (development builds only).

## Privacy

- **Wallets stay on your device.** The game never sends your wallet address to other players, the signalling
  server, or any server of its own; there is no player database, leaderboard, analytics or telemetry. Each player
  sees only their own (shortened) address. Console errors from the wallet are redacted.
- **How joiners know the party was paid for.** The creator's entry is recorded on-chain under a one-way
  commitment, `keccak256("nightshift.party.v1", partyCode, secret)`. Joiners receive only the party code, the
  secret and a block number, recompute the commitment and look it up on Hemi with a free read. No address or
  transaction hash is sent. Note that blockchain transactions are public by nature: someone who knows the
  commitment could look up the paying transaction on a block explorer, so the creator should use a testnet-only
  wallet.
- **Peer-to-peer networking.** Multiplayer uses direct WebRTC connections (PeerJS). As with any peer-to-peer game,
  players in the same party can learn each other's network (IP) address, and the public PeerJS signalling broker
  sees connection metadata (peer ids, party codes - no wallet data). Only play with people you are comfortable
  sharing that with. A relay (TURN) server would hide it; none is configured.
- **Secrets.** `contracts/.env` (the deployer key) is git-ignored and is never read by the game or included in a
  build. Only `VITE_HEMI_RPC_URL` and `VITE_WALLETCONNECT_PROJECT_ID` are exposed to the frontend - neither is a
  secret.
