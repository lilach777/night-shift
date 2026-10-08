// NIGHT SHIFT - the entry fee: a REAL transaction to the NightShiftEntry contract on Hemi Testnet.
//   Single player NEW GAME   -> enter(ref, SINGLE_PLAYER), paid by the current wallet
//   Single player CONTINUE   -> nothing (no transaction)
//   Multiplayer CREATE PARTY -> enter(ref, PARTY_HOST), paid once by the creator
//   Multiplayer JOIN         -> nothing (joiners never call this module's payEntry)
//
// Confirmation is not "the wallet said OK": the receipt must be successful, sent to the known contract,
// and carry the contract's own Entered(payer, ref) event. Only then does the session begin.
//
// No double charges:
//   * one payment at a time (a second click while one is running is ignored)
//   * a confirmed entry that has not been used yet (refresh, crash, lobby closed before the night
//     started...) is REUSED instead of paying again; an entry covers one session for 12 hours
//   * before the wallet prompt opens, the session reference is written down; if the page is reloaded
//     while the prompt was open, the next attempt first asks the CONTRACT whether that reference was
//     paid (entryOf) and recovers it - it never opens a second payment for an unknown outcome
//   * replaced (sped-up) transactions are followed; a cancelled one is reported as failed
import { readContract, writeContract, waitForTransactionReceipt, getPublicClient } from '@wagmi/core';
import { decodeEventLog, formatEther, keccak256, encodePacked } from 'viem';
import { makeCode } from '../mp/net.js';
import { safeError } from './privacy.js';
import { config, wallet, isRejection } from './wallet.js';
import { ENTRY_ABI, MODE } from './abi.js';
import { deployment, HEMI_CHAIN_ID } from './chain.js';

const KEY = 'nightshift.entries.v1';
const TTL = 12 * 3600 * 1000;
const ASK_TTL = 30 * 60 * 1000;

const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const store = (all) => { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage off: no reuse, still no double prompt */ } };
const listFor = (addr) => (load()[addr.toLowerCase()] || []);
function saveEntry(addr, e) {
  const all = load(), k = addr.toLowerCase();
  const list = (all[k] || []).filter(x => x.ref !== e.ref && Date.now() - x.at < 3 * TTL);
  list.push(e); all[k] = list; store(all);
}

export const entryState = { inFlight: false };
export const contractReady = () => !!deployment;

// the fee as the contract says it is (one read, only when a payment is about to be offered)
export async function readFee() {
  if (!deployment) throw Object.assign(new Error('no contract'), { code: 'NO_CONTRACT' });
  return await readContract(config, { address: deployment.address, abi: ENTRY_ABI, functionName: 'entryFee', chainId: HEMI_CHAIN_ID });
}
export const fmtFee = wei => `${formatEther(wei)} TEST ETH`;

// a confirmed entry for this wallet + kind that has not been used up
export function reusableEntry(kind, addr = wallet.address) {
  if (!addr) return null;
  return listFor(addr).filter(e => e.kind === kind && e.status === 'confirmed' && !e.used && Date.now() - e.at < TTL && (kind !== 'party' || (e.partySecret && e.partyCode))).sort((a, b) => b.at - a.at)[0] || null;
}
export function markUsed(entry, extra = {}) {
  if (!entry) return;
  const list = listFor(entry.payer); const e = list.find(x => x.ref === entry.ref);
  if (e) saveEntry(entry.payer, { ...e, used: true, usedAt: Date.now(), ...extra });
}
export function updateEntry(entry, extra) {
  const e = listFor(entry.payer).find(x => x.ref === entry.ref);
  if (e) saveEntry(entry.payer, { ...e, ...extra });
}

// MULTIPLAYER PRIVACY: a party's entry reference is a COMMITMENT to (party code, random secret).
// Joiners get the code (they typed it) and the secret, recompute the commitment and look for the
// contract's own PartyHost Entered event carrying it - they never receive the creator's address or
// transaction. A host that copies someone else's commitment from the chain cannot pass, because it
// does not know that commitment's secret; binding the code stops a seen secret being reused elsewhere.
export const partyCommitment = (code, secret) => keccak256(encodePacked(['string', 'string', 'bytes32'], ['nightshift.party.v1', code, secret]));

function randomRef() { const b = crypto.getRandomValues(new Uint8Array(32)); return '0x' + Array.from(b, x => x.toString(16).padStart(2, '0')).join(''); }

/**
 * Pay (or recover / reuse) the entry for `kind` ('sp' | 'party').
 * onState(state, info): 'checking' | 'approval' | 'pending' {hash} | 'confirmed' {hash, reused} | 'failed' {message} | 'rejected'
 * Resolves with the confirmed entry, or null when it did not happen (onState says why).
 */
export async function payEntry(kind, onState = () => {}) {
  if (entryState.inFlight) return null;                       // duplicate click
  if (!wallet.ready) { onState('failed', { message: wallet.connected ? 'WRONG NETWORK. SWITCH TO HEMI TESTNET.' : 'CONNECT YOUR WALLET TO CONTINUE.' }); return null; }
  if (!deployment) { onState('failed', { message: 'THE ENTRY CONTRACT IS NOT DEPLOYED ON HEMI TESTNET YET.' }); return null; }
  const payer = wallet.address, mode = kind === 'party' ? MODE.PARTY_HOST : MODE.SINGLE_PLAYER;
  entryState.inFlight = true;
  try {
    // 1) an unused confirmed entry: no new payment
    const reuse = reusableEntry(kind, payer);
    if (reuse) { onState('confirmed', { hash: reuse.txHash, reused: true }); return reuse; }
    onState('checking');
    // 2) an earlier attempt whose outcome we never saw (reload during the prompt / while pending)
    for (const e of listFor(payer).filter(x => x.kind === kind && (x.status === 'asked' || x.status === 'pending') && Date.now() - x.at < ASK_TTL)) {
      if (e.txHash) {
        onState('pending', { hash: e.txHash });
        const done = await settle(payer, e, mode, onState); if (done) return done;
        continue;
      }
      const [m] = await readContract(config, { address: deployment.address, abi: ENTRY_ABI, functionName: 'entryOf', args: [payer, e.ref], chainId: HEMI_CHAIN_ID });
      if (Number(m) === mode) { const ok = { ...e, status: 'confirmed', used: false }; saveEntry(payer, ok); onState('confirmed', { hash: null, reused: true }); return ok; }
      saveEntry(payer, { ...e, status: 'abandoned' });
    }
    // 3) a new payment
    const fee = await readFee();
    const e = { ref: randomRef(), kind, mode, payer, feeWei: fee.toString(), status: 'asked', at: Date.now(), txHash: null, used: false };
    if (kind === 'party') { e.partyCode = makeCode(); e.partySecret = randomRef(); e.ref = partyCommitment(e.partyCode, e.partySecret); }   // the code is fixed BEFORE paying
    saveEntry(payer, e);                                     // written BEFORE the prompt (see header)
    onState('approval', { fee });
    let hash;
    try {
      hash = await writeContract(config, { address: deployment.address, abi: ENTRY_ABI, functionName: 'enter', args: [e.ref, mode], value: fee, chainId: HEMI_CHAIN_ID, account: payer });
    } catch (err) {
      saveEntry(payer, { ...e, status: isRejection(err) ? 'rejected' : 'failed' });
      if (isRejection(err)) { onState('rejected'); return null; }
      onState('failed', { message: describeTxError(err) }); return null;
    }
    e.txHash = hash; e.status = 'pending'; saveEntry(payer, e);
    onState('pending', { hash });
    return await settle(payer, e, mode, onState);
  } catch (err) {
    onState('failed', { message: describeTxError(err) });
    return null;
  } finally { entryState.inFlight = false; }
}

// wait for the receipt (following replacements) and verify it against the contract's own event
async function settle(payer, e, mode, onState) {
  let hash = e.txHash;
  let receipt;
  try {
    receipt = await waitForTransactionReceipt(config, {
      hash, chainId: HEMI_CHAIN_ID, confirmations: 1, timeout: 180000,
      onReplaced: (r) => { if (r.reason !== 'cancelled') { hash = r.transaction.hash; saveEntry(payer, { ...e, txHash: hash }); } },
    });
  } catch (err) {
    if (/timed out|timeout/i.test(String(err?.message))) { onState('failed', { message: 'STILL WAITING FOR HEMI. TRY AGAIN IN A MOMENT (YOU WILL NOT BE CHARGED TWICE).' }); return null; }
    throw err;
  }
  const ok = receipt.status === 'success' && receipt.to?.toLowerCase() === deployment.address.toLowerCase()
    && receipt.logs.some(l => {
      if (l.address.toLowerCase() !== deployment.address.toLowerCase()) return false;
      try {
        const ev = decodeEventLog({ abi: ENTRY_ABI, data: l.data, topics: l.topics });
        return ev.eventName === 'Entered' && ev.args.payer.toLowerCase() === payer.toLowerCase() && ev.args.sessionRef.toLowerCase() === e.ref.toLowerCase() && Number(ev.args.mode) === mode;
      } catch { return false; }
    });
  if (!ok) {
    saveEntry(payer, { ...e, txHash: receipt.transactionHash, status: 'failed' });
    onState('failed', { message: receipt.status === 'success' ? 'THE TRANSACTION DID NOT REGISTER AN ENTRY.' : 'TRANSACTION FAILED (REVERTED). YOU WERE NOT ENTERED.', hash: receipt.transactionHash });
    return null;
  }
  const done = { ...e, txHash: receipt.transactionHash, status: 'confirmed', block: Number(receipt.blockNumber), at: Date.now(), used: false };
  saveEntry(payer, done);
  onState('confirmed', { hash: done.txHash, reused: false });
  return done;
}

// read-only, free: is this party backed by a confirmed PartyHost entry? (joiners use it)
// party = { code, secret, block } - no address, no transaction hash. Returns true / false; throws when
// Hemi cannot be reached (the caller then lets the player in rather than blocking the game on an RPC).
const PARTY_MAX_AGE = 24 * 3600;
export async function verifyParty(party, joinedCode) {
  if (!deployment || !party || typeof party !== 'object') return false;
  const { code, secret } = party;
  if (typeof code !== 'string' || code !== joinedCode || !/^0x[0-9a-fA-F]{64}$/.test(secret || '')) return false;
  const commitment = partyCommitment(code, secret);
  const client = getPublicClient(config, { chainId: HEMI_CHAIN_ID });
  const hint = Number.isSafeInteger(party.block) && party.block >= (deployment.block || 0) ? BigInt(party.block) : null;
  const event = ENTRY_ABI.find(x => x.type === 'event' && x.name === 'Entered');
  const logs = await client.getLogs({
    address: deployment.address, event, args: { sessionRef: commitment },
    fromBlock: hint ?? BigInt(deployment.block || 0), toBlock: hint ?? 'latest',
  });
  const hit = logs.find(l => l.address.toLowerCase() === deployment.address.toLowerCase() && Number(l.args.mode) === MODE.PARTY_HOST && l.args.sessionRef?.toLowerCase() === commitment.toLowerCase());
  if (!hit) return false;
  const blk = await client.getBlock({ blockNumber: hit.blockNumber });
  return Date.now() / 1000 - Number(blk.timestamp) < PARTY_MAX_AGE;            // a fresh payment, not an old one
}

export function describeTxError(e) {
  const msg = [e?.shortMessage, e?.details, e?.message, e?.cause?.details, e?.cause?.message].filter(Boolean).join(' | ');
  if (e?.code === 'NO_CONTRACT') return 'THE ENTRY CONTRACT IS NOT DEPLOYED ON HEMI TESTNET YET.';
  if (isRejection(e)) return 'TRANSACTION CANCELLED';
  if (/insufficient funds|exceeds the balance|InsufficientFunds|enough funds/i.test(msg)) return 'NOT ENOUGH TEST ETH FOR THE ENTRY FEE + NETWORK GAS.';
  if (/chain.*mismatch|does not match the target chain|ChainMismatch/i.test(msg)) return 'WRONG NETWORK. SWITCH TO HEMI TESTNET.';
  if (/WrongFee/.test(msg)) return 'THE ENTRY FEE CHANGED. TRY AGAIN.';
  if (/AlreadyEntered/.test(msg)) return 'THIS ENTRY WAS ALREADY PAID.';
  if (/reverted|revert/i.test(msg)) return 'TRANSACTION FAILED (REVERTED). YOU WERE NOT ENTERED.';
  if (/fetch|network|HTTP request failed|timed out|Failed to fetch/i.test(msg)) return 'COULD NOT REACH HEMI TESTNET. CHECK YOUR CONNECTION AND TRY AGAIN.';
  if (/already pending|-32002/i.test(msg)) return 'YOUR WALLET ALREADY HAS A REQUEST OPEN. CHECK THE WALLET.';
  console.warn('[entry]', safeError(e));
  return 'TRANSACTION FAILED. TRY AGAIN.';
}
