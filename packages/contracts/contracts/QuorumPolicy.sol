// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IQuorumPolicy} from "./IQuorumPolicy.sol";

/// @title QuorumPolicy
/// @notice Admin-managed M-of-N attester set for the MVP.
/// @dev This is the acknowledged centralisation point (ARCHITECTURE.md §1). It governs
///      only how records are *interpreted*: nothing here can alter or erase an
///      attestation in AttestationRegistry. ROADMAP §2.1 replaces it with staking.
contract QuorumPolicy is IQuorumPolicy {
    error NotAdmin(address caller);
    error ZeroAddress();
    error AlreadyAttester(address who);
    error NotRegisteredAttester(address who);
    error InvalidThreshold(uint32 threshold, uint32 attesterCount);

    event AttesterAdded(address indexed attester);
    event AttesterRemoved(address indexed attester);
    event ThresholdChanged(uint32 previousThreshold, uint32 newThreshold);

    mapping(address => bool) private _attesters;
    uint32 private _attesterCount;
    uint32 private _threshold;

    /// @notice The only account allowed to change the attester set or threshold.
    address public immutable admin;

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin(msg.sender);
        _;
    }

    /// @notice Create the policy with its initial attester set and threshold.
    /// @param admin_ Account allowed to administer the attester set.
    /// @param initialAttesters Attesters registered at construction.
    /// @param threshold_ M; must satisfy 1 <= M <= initialAttesters.length.
    constructor(address admin_, address[] memory initialAttesters, uint32 threshold_) {
        if (admin_ == address(0)) revert ZeroAddress();
        admin = admin_;
        for (uint256 i = 0; i < initialAttesters.length; i++) {
            _add(initialAttesters[i]);
        }
        _setThreshold(threshold_);
    }

    /// @notice Register a new attester.
    /// @param who Address of the attester's signing key.
    function addAttester(address who) external onlyAdmin {
        _add(who);
    }

    /// @notice Deregister an attester. Past corroborations by `who` are unaffected.
    /// @dev Reverts if removal would leave fewer attesters than the threshold, which
    ///      would make quorum permanently unreachable.
    /// @param who Address to remove.
    function removeAttester(address who) external onlyAdmin {
        if (!_attesters[who]) revert NotRegisteredAttester(who);
        if (_attesterCount - 1 < _threshold) revert InvalidThreshold(_threshold, _attesterCount - 1);
        _attesters[who] = false;
        _attesterCount -= 1;
        emit AttesterRemoved(who);
    }

    /// @notice Change M.
    /// @param newThreshold New threshold; must satisfy 1 <= M <= attesterCount.
    function setThreshold(uint32 newThreshold) external onlyAdmin {
        _setThreshold(newThreshold);
    }

    /// @inheritdoc IQuorumPolicy
    function isAttester(address who) external view returns (bool) {
        return _attesters[who];
    }

    /// @inheritdoc IQuorumPolicy
    function threshold() external view returns (uint32) {
        return _threshold;
    }

    /// @inheritdoc IQuorumPolicy
    function attesterCount() external view returns (uint32) {
        return _attesterCount;
    }

    /// @inheritdoc IQuorumPolicy
    function isSatisfied(uint32 corroborations) external view returns (bool) {
        return _threshold != 0 && corroborations >= _threshold;
    }

    function _add(address who) private {
        if (who == address(0)) revert ZeroAddress();
        if (_attesters[who]) revert AlreadyAttester(who);
        _attesters[who] = true;
        _attesterCount += 1;
        emit AttesterAdded(who);
    }

    function _setThreshold(uint32 newThreshold) private {
        if (newThreshold == 0 || newThreshold > _attesterCount) {
            revert InvalidThreshold(newThreshold, _attesterCount);
        }
        emit ThresholdChanged(_threshold, newThreshold);
        _threshold = newThreshold;
    }
}
