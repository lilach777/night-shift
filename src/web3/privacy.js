// NIGHT SHIFT - wallet privacy helpers.
// Wallet / viem errors carry request details (from, sender, account, calldata, raw transaction).
// Nothing wallet-related is ever logged whole: only the error type, a safe numeric code and a short
// message with every address / hash / long hex value redacted.
const HEX = /0x[0-9a-fA-F]{8,}/g;

export const redact = s => String(s ?? '').replace(HEX, '0x[redacted]');

export function safeError(e) {
  if (!e) return 'unknown error';
  const name = String(e.name || 'Error').slice(0, 60);
  const code = Number.isFinite(e.code) ? ` [${e.code}]` : '';
  // viem's shortMessage is the first line only; plain errors: the first line of the message
  const msg = redact(String(e.shortMessage || e.message || '').split('\n')[0]).slice(0, 160);
  return `${name}${code}: ${msg}`;
}
