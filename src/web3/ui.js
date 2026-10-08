// NIGHT SHIFT - wallet UI in the game's own style (dark, minimal, typewriter) - not a DeFi dashboard.
//   * a small wallet panel on the menus: WALLET NOT CONNECTED / CONNECTED 0x12AB...89CD HEMI TESTNET /
//     WRONG NETWORK + the one button that fixes it
//   * a wallet chooser (installed wallets, Coinbase Wallet, WalletConnect)
//   * the entry dialog for NEW GAME / CREATE PARTY: the exact on-chain fee, a note about network gas,
//     every transaction state, and a Hemi explorer link once confirmed
// All dynamic text goes through textContent (no wallet name / address can inject markup).
import { wallet, startWallet, walletOptions, connectWallet, disconnectWallet, switchToHemi } from './wallet.js';
import { payEntry, readFee, fmtFee, reusableEntry, entryState, contractReady } from './entry.js';
import { shortAddr, txUrl } from './chain.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export class WalletUI {
  constructor(game) {
    this.g = game;
    this.panels = [];
    this.buildModals();
    wallet.onChange((w, why) => this.refresh(why));
    startWallet().then(() => this.refresh('ready'));
  }

  // ------------------------------------------------------------------ panels on the menus
  attachPanel(container, { compact = false } = {}) {
    const p = el('div', 'wallet-panel' + (compact ? ' compact' : ''));
    p.innerHTML = '<div class="wp-state"></div><div class="wp-addr"></div><div class="wp-net"></div><div class="wp-btns"></div><div class="wp-err"></div>';
    container.appendChild(p);
    this.panels.push(p);
    this.renderPanel(p);
    return p;
  }
  renderPanel(p) {
    const q = s => p.querySelector(s);
    const btns = q('.wp-btns'); btns.textContent = '';
    if (!wallet.connected) {
      q('.wp-state').textContent = wallet.status === 'reconnecting' || wallet.status === 'connecting' ? 'CONNECTING WALLET...' : 'WALLET NOT CONNECTED';
      q('.wp-addr').textContent = ''; q('.wp-net').textContent = '';
      p.classList.remove('ok', 'warn');
    } else if (!wallet.onHemi) {
      q('.wp-state').textContent = 'WRONG NETWORK';
      q('.wp-addr').textContent = shortAddr(wallet.address);
      q('.wp-net').textContent = 'Please switch to Hemi Testnet.';
      const b = el('button', 'ghost small', 'SWITCH TO HEMI TESTNET'); b.onclick = (e) => { e.stopPropagation(); this.switchNet(); };
      btns.appendChild(b);
      p.classList.add('warn'); p.classList.remove('ok');
    } else {
      q('.wp-state').textContent = 'CONNECTED';
      q('.wp-addr').textContent = shortAddr(wallet.address);
      q('.wp-net').textContent = 'HEMI TESTNET';
      p.classList.add('ok'); p.classList.remove('warn');
    }
    q('.wp-err').textContent = this.panelError || '';
  }
  refresh(why) {
    if (why === 'account' && this.g?.onWalletAccountChanged) this.g.onWalletAccountChanged();
    if (why === 'chain' && wallet.connected && !wallet.onHemi && this.g?.onWalletWrongNetwork) this.g.onWalletWrongNetwork();
    if (why === 'disconnect' && this.g?.onWalletDisconnected) this.g.onWalletDisconnected();
    if (wallet.connected || why === 'connect') this.panelError = wallet.error || '';
    for (const p of this.panels) this.renderPanel(p);
    for (const b of document.querySelectorAll('[data-action=wallet]')) b.textContent = wallet.connected ? 'DISCONNECT WALLET' : 'CONNECT WALLET';
    if (this.chooserOpen) this.renderChooser();
    if (this.entryOpen) this.renderEntryWalletLine();
  }
  async switchNet() {
    if (wallet.busy) return;
    const ok = await switchToHemi();
    this.panelError = ok ? '' : wallet.error;
    this.refresh('switch');
  }

  // ------------------------------------------------------------------ gate: wallet + Hemi before anything starts
  // returns true when ready; otherwise shows the one thing the player has to do and returns false
  requireReady() {
    if (wallet.ready) return true;
    if (!wallet.connected) this.openGate('CONNECT YOUR WALLET TO CONTINUE.', 'CONNECT WALLET', () => { this.closeGate(); this.openChooser(); });
    else this.openGate('WRONG NETWORK\nPlease switch to Hemi Testnet.', 'SWITCH TO HEMI TESTNET', async () => { await this.switchNet(); if (wallet.ready) this.closeGate(); else this.gateMsg.textContent = wallet.error || 'WRONG NETWORK'; });
    return false;
  }

  // ------------------------------------------------------------------ modals
  buildModals() {
    const root = el('div', 'w3-modal hidden'); root.id = 'w3-modal';
    root.addEventListener('click', e => e.stopPropagation());
    root.addEventListener('pointerdown', e => e.stopPropagation());
    const box = el('div', 'w3-box');
    root.appendChild(box);
    document.getElementById('app').appendChild(root);
    this.modal = root; this.box = box;
  }
  show(build) { this.box.textContent = ''; build(this.box); this.modal.classList.remove('hidden'); }
  hide() { this.modal.classList.add('hidden'); this.chooserOpen = false; this.entryOpen = false; this.gateOpen = false; }

  openGate(text, btnText, onBtn) {
    this.gateOpen = true;
    this.show(box => {
      box.appendChild(el('div', 'w3-title', 'NIGHT SHIFT'));
      this.gateMsg = el('div', 'w3-msg', text); box.appendChild(this.gateMsg);
      if (btnText) { const b = el('button', '', btnText); b.onclick = () => { this.g?.ui?.click?.(); onBtn(); }; box.appendChild(b); }
      const c = el('button', 'ghost small', 'BACK'); c.onclick = () => this.hide(); box.appendChild(c);
    });
  }
  closeGate() { if (this.gateOpen) this.hide(); }

  openChooser() {
    if (wallet.connected) return;
    this.chooserOpen = true;
    this.renderChooser();
  }
  renderChooser() {
    const { named, other } = walletOptions();
    const busy = wallet.busy;
    this.show(box => {
      box.appendChild(el('div', 'w3-title', 'CONNECT WALLET'));
      box.appendChild(el('div', 'w3-sub', 'Connect an EVM wallet to play. NIGHT SHIFT runs on Hemi Testnet.'));
      const row = (o) => {
        const wrap = el('div', 'w3-row ' + o.status);
        const b = el(o.status === 'install' ? 'a' : 'button', 'w3-opt');
        // the wallet's OWN announced icon when it is installed; otherwise a neutral glyph (no borrowed logos)
        if (o.icon && /^(data:image\/(png|svg\+xml|webp|jpeg|gif)[;,]|https:\/\/)/.test(o.icon)) { const i = el('img'); i.src = o.icon; i.alt = ''; b.appendChild(i); }
        else b.appendChild(el('span', 'w3-glyph', o.name[0]));
        const txt = el('span', 'w3-name'); txt.appendChild(el('span', '', o.name.toUpperCase()));
        const tag = { installed: 'DETECTED', mobile: 'MOBILE', available: '', install: 'INSTALL' }[o.status];
        if (o.note || tag) txt.appendChild(el('small', '', [tag, o.note].filter(Boolean).join(' · ')));
        b.appendChild(txt);
        if (o.status === 'install') {
          b.href = o.install; b.target = '_blank'; b.rel = 'noopener noreferrer';           // official download page only
        } else {
          b.disabled = busy;
          b.onclick = () => this.pickWallet(o);
        }
        wrap.appendChild(b);
        return wrap;
      };
      const list = el('div', 'w3-list');
      for (const o of named) list.appendChild(row(o));
      if (other.length) {
        list.appendChild(el('div', 'w3-group', 'OTHER WALLETS'));
        for (const o of other) list.appendChild(row(o));
      }
      box.appendChild(list);
      this.chooserMsg = el('div', 'w3-msg', this.chooserPending || (busy ? 'A WALLET REQUEST IS STILL OPEN. FINISH OR CLOSE IT IN YOUR WALLET.' : wallet.error || '')); box.appendChild(this.chooserMsg);
      box.appendChild(el('div', 'w3-fine', 'NIGHT SHIFT never asks for a seed phrase or private key.'));
      const c = el('button', 'ghost small', 'CANCEL'); c.onclick = () => { this.chooserPending = ''; this.hide(); }; box.appendChild(c);   // never trapped by a wallet that does not answer
    });
  }
  // connect with exactly the wallet that was picked (its own connector); never a second popup while one is open
  async pickWallet(o) {
    if (wallet.busy || !o.connector) return;
    this.g?.ui?.click?.();
    this.chooserPending = o.status === 'mobile' ? `SCAN THE QR CODE WITH ${o.name.toUpperCase()}...` : `WAITING FOR ${o.name.toUpperCase()}... APPROVE THE CONNECTION.`;
    this.renderChooser();
    const ok = await connectWallet(o);
    this.chooserPending = '';
    if (ok && wallet.connected) {
      if (!wallet.onHemi) { this.chooserPending = 'CONNECTED - SWITCHING TO HEMI TESTNET...'; this.renderChooser(); await switchToHemi(); this.chooserPending = ''; }
      if (wallet.ready) { this.hide(); this.refresh('connect'); return; }
      this.hide(); this.requireReady();                                  // WRONG NETWORK + switch button
    } else if (this.chooserOpen) this.renderChooser();                  // the reason (rejected / locked / unavailable...)
    else if (wallet.error) this.refresh('connect');
  }

  async toggleConnection() {
    if (wallet.connected) { await disconnectWallet(); this.refresh('disconnect'); }
    else this.openChooser();
  }

  // ------------------------------------------------------------------ the entry dialog
  // kind: 'sp' (NEW GAME) | 'party' (CREATE PARTY). Resolves with the confirmed entry or null.
  confirmEntry(kind) {
    if (!this.requireReady()) return Promise.resolve(null);
    if (entryState.inFlight) return Promise.resolve(null);
    return new Promise(resolve => {
      this.entryOpen = true; this.entryKind = kind;
      const reuse = reusableEntry(kind);
      const party = kind === 'party';
      let feeText = 'READING FEE FROM HEMI...', fee = null, done = false;
      const finish = (v) => { if (done) return; done = true; resolve(v); };
      this.show(box => {
        box.appendChild(el('div', 'w3-title', party ? 'CREATE PARTY' : 'NEW GAME'));
        this.entryWallet = el('div', 'w3-wallet'); box.appendChild(this.entryWallet); this.renderEntryWalletLine();
        const feeEl = el('div', 'w3-fee', reuse ? 'ENTRY ALREADY PAID' : 'Entry fee: ' + feeText); box.appendChild(feeEl);
        box.appendChild(el('div', 'w3-sub', reuse
          ? (party ? 'Your confirmed entry for a party has not been used yet. No new payment.' : 'Your confirmed entry has not been used yet. No new payment.')
          : (party ? 'You pay the entry fee once to create this party. Players who join it pay nothing.' : 'A real transaction on Hemi Testnet. Continue never costs anything.')));
        if (!reuse) box.appendChild(el('div', 'w3-fine', 'Your wallet also charges a small network gas fee (test ETH) to send it.'));
        const state = el('div', 'w3-state', reuse ? '' : 'CONFIRM ENTRY'); box.appendChild(state);
        const link = el('a', 'w3-link hidden', 'VIEW ON HEMI'); link.target = '_blank'; link.rel = 'noopener noreferrer'; box.appendChild(link);
        const go = el('button', '', reuse ? (party ? 'CREATE PARTY' : 'START') : (party ? 'PAY & CREATE PARTY' : 'PAY & START')); box.appendChild(go);
        const cancel = el('button', 'ghost small', 'CANCEL'); box.appendChild(cancel);
        cancel.onclick = () => { if (entryState.inFlight) return; this.hide(); finish(null); };
        const setState = (s, info = {}) => {
          const T = { checking: 'CHECKING...', approval: 'WALLET AWAITING APPROVAL...', pending: 'CONFIRMING ENTRY... (TRANSACTION PENDING)', confirmed: info.reused ? 'ENTRY CONFIRMED' : 'TRANSACTION CONFIRMED', rejected: 'TRANSACTION CANCELLED', failed: info.message || 'TRANSACTION FAILED' };
          state.textContent = T[s] || s; state.className = 'w3-state ' + s;
          if (info.hash) { link.href = txUrl(info.hash); link.classList.remove('hidden'); }
          const busy = s === 'checking' || s === 'approval' || s === 'pending';
          go.disabled = busy || s === 'confirmed'; cancel.disabled = busy;
          if (s === 'rejected' || s === 'failed') go.textContent = 'TRY AGAIN';
        };
        if (!reuse) {
          if (!contractReady()) { setState('failed', { message: 'THE ENTRY CONTRACT IS NOT DEPLOYED ON HEMI TESTNET YET.' }); go.disabled = true; }
          else readFee().then(w => { fee = w; feeEl.textContent = 'Entry fee: ' + fmtFee(w); }).catch(() => { feeEl.textContent = 'Entry fee: (could not read from Hemi)'; setState('failed', { message: 'COULD NOT REACH HEMI TESTNET. CHECK YOUR CONNECTION AND TRY AGAIN.' }); go.disabled = false; });
        }
        go.onclick = async () => {
          if (entryState.inFlight || go.disabled) return;
          if (!wallet.ready) { this.hide(); this.requireReady(); finish(null); return; }
          const entry = await payEntry(kind, setState);
          if (!entry) return;                                      // the state line says why; they can retry
          const wasReused = !!reuse && entry.ref === reuse.ref;
          setState('confirmed', { hash: entry.txHash, reused: wasReused });
          state.textContent = (wasReused ? 'ENTRY CONFIRMED' : 'TRANSACTION CONFIRMED') + (party ? ' - CREATING PARTY...' : ' - STARTING...');
          setTimeout(() => { this.hide(); finish(entry); }, entry.txHash ? 1600 : 600);
        };
      });
    });
  }
  renderEntryWalletLine() {
    if (!this.entryWallet) return;
    this.entryWallet.textContent = wallet.ready ? `WALLET  ${shortAddr(wallet.address)}  ·  HEMI TESTNET` : wallet.connected ? 'WRONG NETWORK - SWITCH TO HEMI TESTNET' : 'WALLET NOT CONNECTED';
  }
}