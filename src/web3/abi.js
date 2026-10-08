// The part of NightShiftEntry (contracts/contracts/NightShiftEntry.sol) the game uses.
export const ENTRY_ABI = [
  { type: 'function', name: 'entryFee', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'enter', stateMutability: 'payable', inputs: [{ name: 'sessionRef', type: 'bytes32' }, { name: 'mode', type: 'uint8' }], outputs: [] },
  { type: 'function', name: 'entryOf', stateMutability: 'view', inputs: [{ name: 'payer', type: 'address' }, { name: 'sessionRef', type: 'bytes32' }], outputs: [{ name: 'mode', type: 'uint8' }, { name: 'timestamp', type: 'uint64' }] },
  { type: 'event', name: 'Entered', inputs: [{ name: 'payer', type: 'address', indexed: true }, { name: 'sessionRef', type: 'bytes32', indexed: true }, { name: 'mode', type: 'uint8', indexed: false }, { name: 'fee', type: 'uint256', indexed: false }] },
  { type: 'error', name: 'WrongFee', inputs: [{ type: 'uint256' }, { type: 'uint256' }] },
  { type: 'error', name: 'AlreadyEntered', inputs: [{ type: 'address' }, { type: 'bytes32' }] },
  { type: 'error', name: 'InvalidSession', inputs: [] },
  { type: 'error', name: 'InvalidMode', inputs: [] },
];
export const MODE = { SINGLE_PLAYER: 1, PARTY_HOST: 2 };
