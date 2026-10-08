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

On **Vercel**, `api/turn.js` additionally provides a multiplayer relay for players whose networks block
direct connections. Set two server-side environment variables in the Vercel project (never `VITE_*`, never in
the repository): `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN` (Cloudflare dashboard > Realtime >
TURN Server). Without them, or on other hosts, multiplayer simply uses direct connections only.
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

## Wallet & Safety

NIGHT SHIFT uses an EVM wallet on **Hemi Testnet only** (chain ID 743111). Testnet ETH has no real-world value.
Supported: browser extensions such as MetaMask, Rabby, Trust Wallet and Coinbase Wallet (plus any other
EIP-6963 wallet), and WalletConnect mobile wallets when the build has a WalletConnect project ID.

| Action | Wallet on Hemi Testnet | Cost |
|---|---|---|
| Single player NEW GAME | required | one small testnet ETH transaction (0.001 ETH + gas) |
| Single player CONTINUE | required | free, no transaction |
| Multiplayer CREATE PARTY | required | the creator pays once (0.001 ETH + gas) for the whole party |
| Multiplayer JOIN PARTY | required | free, no transaction |

- **The game will never ask for your seed phrase, recovery phrase or private key.** Anyone who does is not us.
- Your wallet is only ever asked to: connect, switch to (or add) Hemi Testnet, and confirm the entry transaction
  above. The game does **not** request token approvals, NFT permissions, or message signatures.
- An entry that was paid but not used (for example, the lobby closed before the night started) is reused for up
  to 12 hours rather than charged again.
- Use a testnet-only wallet. Get Hemi Testnet ETH from the official Hemi faucet.

**Network details**

| | |
|---|---|
| Network | Hemi Testnet (Hemi Sepolia), chain ID 743111, currency ETH |
| RPC | `https://testnet.rpc.hemi.network/rpc` |
| Explorer | https://testnet.explorer.hemi.xyz |
| Entry contract | [`0x44BB53fcFD7a99c360A8b6a74DAdAd1879b1FA95`](https://testnet.explorer.hemi.xyz/address/0x44BB53fcFD7a99c360A8b6a74DAdAd1879b1FA95) (`NightShiftEntry`, source in [`contracts/`](contracts/)) |

The game reads the fee from the contract and keeps all chain settings in `src/web3/chain.js` and
`src/web3/deployments.json`. It needs no `.env`; two optional, public build-time variables exist:
`VITE_HEMI_RPC_URL` (another Hemi RPC) and `VITE_WALLETCONNECT_PROJECT_ID` (enables WalletConnect).
Contract development and deployment are documented in [`contracts/README.md`](contracts/README.md).

## Privacy

- **No game server, no tracking.** NIGHT SHIFT has no backend of its own: no accounts, player database,
  leaderboard, analytics or telemetry.
- **Your wallet address.** It is shown only to you (shortened) and is never sent to other players or to the
  signalling server. It is kept in your browser's local storage (to remember your save and paid entries), and,
  like any dApp, your wallet and the Hemi RPC (and WalletConnect's relay, if you use it) see it. Wallet errors in
  the browser console are redacted.
- **Payments are public.** Entry fees are ordinary blockchain transactions, so anyone can see on the block
  explorer that your address paid the entry contract.
- **Multiplayer parties.** To prove the party was paid for, joiners receive the party code, a party secret and a
  block number - never an address or transaction hash - and check the creator's entry on Hemi with a free read.
  Because that proof points to the payment on-chain, a party member who looks it up on the explorer can find the
  creator's paying address. Creators should use a testnet-only wallet.
- **Multiplayer networking.** Multiplayer and voice chat use WebRTC (PeerJS). Players connect directly
  whenever their networks allow it; as in most peer-to-peer games, players in the same party can then learn each
  other's IP address. When a direct connection is impossible (for example on some mobile or strict networks),
  traffic is relayed through Cloudflare's TURN service instead - the relay hides players' IP addresses from each
  other, but Cloudflare sees them and carries that (encrypted) game and voice traffic. The public PeerJS
  signalling broker and the STUN servers used to set up connections (Google, Twilio, Cloudflare) also see your
  IP address. Only play with people you are comfortable sharing that with.
