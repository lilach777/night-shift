// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title NIGHT SHIFT - entry fee (Hemi Testnet)
/// @notice The game's only on-chain action: paying a fixed, tiny testnet entry fee to start
///         a single-player New Game, or to create a multiplayer party (the creator pays once,
///         joiners never interact with this contract).
/// @dev    Deliberately minimal: no tokens, no NFTs, no rewards, no pause switch.
///         An entry is keyed by (payer, sessionRef). Binding the key to msg.sender means nobody
///         can front-run or squat someone else's session, and the same payer can never pay
///         twice for the same session.
contract NightShiftEntry is Ownable2Step, ReentrancyGuard {
    /// @notice What the entry is for. Joining a party is NOT an entry (no fee).
    enum Mode {
        None,
        SinglePlayer, // single-player New Game
        PartyHost     // multiplayer: the party creator, paying once for the whole party
    }

    struct Entry {
        Mode mode;
        uint64 timestamp;
    }

    /// @notice Exact amount (wei) one entry costs. Fixed at deployment.
    uint256 public immutable entryFee;

    /// @dev keccak256(abi.encode(payer, sessionRef)) => entry
    mapping(bytes32 => Entry) private _entries;

    event Entered(address indexed payer, bytes32 indexed sessionRef, Mode mode, uint256 fee);
    event Withdrawn(address indexed to, uint256 amount);

    error WrongFee(uint256 sent, uint256 required);
    error AlreadyEntered(address payer, bytes32 sessionRef);
    error InvalidSession();
    error InvalidMode();
    error InvalidFee();
    error InvalidRecipient();
    error NothingToWithdraw();
    error TransferFailed();
    error DirectPaymentRejected();

    constructor(uint256 fee, address initialOwner) Ownable(initialOwner) {
        if (fee == 0) revert InvalidFee();
        entryFee = fee;
    }

    /// @notice Pay the entry fee for one session (a new single-player run, or a new party).
    /// @param sessionRef a random, client-generated 32-byte reference for this session
    /// @param mode       SinglePlayer or PartyHost
    function enter(bytes32 sessionRef, Mode mode) external payable {
        if (sessionRef == bytes32(0)) revert InvalidSession();
        if (mode != Mode.SinglePlayer && mode != Mode.PartyHost) revert InvalidMode();
        if (msg.value != entryFee) revert WrongFee(msg.value, entryFee);
        bytes32 key = _key(msg.sender, sessionRef);
        if (_entries[key].mode != Mode.None) revert AlreadyEntered(msg.sender, sessionRef);
        _entries[key] = Entry({mode: mode, timestamp: uint64(block.timestamp)});
        emit Entered(msg.sender, sessionRef, mode, msg.value);
    }

    /// @notice Has `payer` paid the entry for `sessionRef`? (read-only, used to verify a party)
    function entryOf(address payer, bytes32 sessionRef) external view returns (Mode mode, uint64 timestamp) {
        Entry memory e = _entries[_key(payer, sessionRef)];
        return (e.mode, e.timestamp);
    }

    /// @notice Owner moves the collected testnet fees out.
    function withdraw(address payable to) external onlyOwner nonReentrant {
        if (to == address(0)) revert InvalidRecipient();
        uint256 amount = address(this).balance;
        if (amount == 0) revert NothingToWithdraw();
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(to, amount);
    }

    /// @dev ETH only arrives through enter(): plain transfers and unknown calls are refused.
    receive() external payable {
        revert DirectPaymentRejected();
    }

    fallback() external payable {
        revert DirectPaymentRejected();
    }

    function _key(address payer, bytes32 sessionRef) private pure returns (bytes32) {
        return keccak256(abi.encode(payer, sessionRef));
    }
}
