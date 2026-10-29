// NIGHT SHIFT - wallet UI in the game's own style (dark, minimal, typewriter) - not a DeFi dashboard.
//   * a small wallet panel on the menus: WALLET NOT CONNECTED / CONNECTED 0x12AB...89CD HEMI TESTNET /
//     WRONG NETWORK + the one button that fixes it
//   * a wallet chooser (installed wallets, Coinbase Wallet, WalletConnect)
// The game is free to play: the wallet is never asked to send a transaction.
// All dynamic text goes through textContent (no wallet name / address can inject markup).
import { wallet, startWallet, walletOptions, connectWallet, disconnectWallet, switchToHemi } from './wallet.js';
import { shortAddr } from './chain.js';

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
  hide() { this.modal.classList.add('hidden'); this.chooserOpen = false; this.gateOpen = false; }

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
}