// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IQuorumPolicy
/// @notice How the registry interprets corroborations. Kept separate from the immutable
///         record so trust policy can evolve without touching attestation history.
interface IQuorumPolicy {
    /// @notice Whether `who` is currently an active attester.
    function isAttester(address who) external view returns (bool);

    /// @notice The current threshold M of an M-of-N quorum.
    function threshold() external view returns (uint32);

    /// @notice The current number N of active attesters.
    function attesterCount() external view returns (uint32);

    /// @notice Whether `corroborations` meets the current threshold.
    function isSatisfied(uint32 corroborations) external view returns (bool);
}
