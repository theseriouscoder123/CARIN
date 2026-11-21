// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IQuorumPolicy} from "./IQuorumPolicy.sol";

/// @title AttestationRegistry
/// @notice Append-only log of package release attestations and their independent
///         corroborations. There is no update path, no delete path, no admin, no proxy
///         and no upgrade mechanism. Immutability is the product.
contract AttestationRegistry is EIP712 {
    struct Attestation {
        bytes32 artifactDigest; // Merkle root, SPEC-DIGEST §4
        bytes32 tarballHash; // sha256 of raw tarball bytes
        bytes32 payloadDigest; // sha256 of canonical JSON payload
        address publisher; // EIP-712 signer
        uint64 submittedAt; // block.timestamp; 0 means "no record"
        uint32 corroborations; // distinct attester co-signatures
    }

    struct Divergence {
        address attester;
        bytes32 observedDigest;
        uint64 reportedAt;
    }

    /// @notice keccak256 of the EIP-712 Attestation type string. Mirrored in @cairn/core.
    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(string ecosystem,string name,string version,bytes32 artifactDigest,bytes32 tarballHash,bytes32 payloadDigest,uint256 nonce)"
    );

    /// @notice The policy used to interpret corroboration counts. Fixed forever.
    IQuorumPolicy public immutable quorumPolicy;

    mapping(bytes32 => Attestation) private _attestations;
    mapping(bytes32 => mapping(address => bool)) private _hasCorroborated;
    mapping(bytes32 => mapping(address => bool)) private _hasDiverged;
    mapping(bytes32 => Divergence[]) private _divergences;
    mapping(address => uint256) private _nonces;
    /// nameId = keccak256("<ecosystem>:<name>") → the publisher key pinned to that name.
    mapping(bytes32 => address) private _namePublisher;

    event AttestationSubmitted(
        bytes32 indexed packageId,
        address indexed publisher,
        bytes32 artifactDigest,
        bytes32 tarballHash,
        bytes32 payloadDigest,
        string ecosystem,
        string name,
        string version
    );

    /// @notice Emitted once per package name, when its first attestation pins a publisher.
    event PackageNameClaimed(bytes32 indexed nameId, address indexed publisher, string ecosystem, string name);

    event AttesterCorroborated(
        bytes32 indexed packageId, address indexed attester, uint32 corroborations, bool quorumReached
    );

    event DivergenceReported(
        bytes32 indexed packageId, address indexed attester, bytes32 expectedDigest, bytes32 observedDigest
    );

    error AttestationExists(bytes32 packageId);
    error AttestationMissing(bytes32 packageId);
    error InvalidSignature();
    error PackageIdMismatch(bytes32 provided, bytes32 expected);
    error NotAnAttester(address caller);
    error AlreadyCorroborated(bytes32 packageId, address attester);
    error DivergenceAlreadyReported(bytes32 packageId, address attester);
    error PublisherCannotCorroborate();
    error ZeroDigest();
    error ZeroAddress();
    error NonceMismatch(uint256 expected, uint256 provided);
    error PublisherNotPinned(bytes32 nameId, address pinned, address provided);

    /// @param policy The quorum policy contract; immutable for the life of the registry.
    constructor(IQuorumPolicy policy) EIP712("CAIRN", "1") {
        if (address(policy) == address(0)) revert ZeroAddress();
        quorumPolicy = policy;
    }

    /// @notice Record a maintainer's signed attestation for a release.
    /// @dev Append-only: reverts if a record already exists for `packageId`. The signer is
    ///      recovered from an EIP-712 signature and must equal `publisher`, so any account
    ///      (e.g. a CI job) may relay a signature produced by an offline key.
    ///      The first attestation of a package *name* pins its publisher; every later
    ///      version of that name must be signed by the same key. A hijacked registry
    ///      account therefore cannot produce attested releases without the CAIRN key.
    /// @param packageId keccak256("<ecosystem>:<name>@<version>"); verified on-chain.
    /// @param ecosystem Lowercase ecosystem name, e.g. "npm".
    /// @param name Registry package name, including scope.
    /// @param version Exact resolved version string.
    /// @param artifactDigest Merkle root over the normalised file tree.
    /// @param tarballHash SHA-256 of the raw tarball bytes.
    /// @param payloadDigest SHA-256 of the canonical off-chain payload.
    /// @param publisher The address that signed the attestation.
    /// @param nonce Must equal `nonceOf(publisher)`.
    /// @param signature 65-byte EIP-712 signature by `publisher`.
    function submit(
        bytes32 packageId,
        string calldata ecosystem,
        string calldata name,
        string calldata version,
        bytes32 artifactDigest,
        bytes32 tarballHash,
        bytes32 payloadDigest,
        address publisher,
        uint256 nonce,
        bytes calldata signature
    ) external {
        // --- checks
        if (artifactDigest == bytes32(0) || tarballHash == bytes32(0) || payloadDigest == bytes32(0)) {
            revert ZeroDigest();
        }
        bytes32 expectedId = keccak256(abi.encodePacked(ecosystem, ":", name, "@", version));
        if (packageId != expectedId) revert PackageIdMismatch(packageId, expectedId);
        if (_attestations[packageId].submittedAt != 0) revert AttestationExists(packageId);
        if (publisher == address(0)) revert ZeroAddress();
        bytes32 nameId = keccak256(abi.encodePacked(ecosystem, ":", name));
        address pinned = _namePublisher[nameId];
        if (pinned != address(0) && pinned != publisher) revert PublisherNotPinned(nameId, pinned, publisher);
        uint256 expectedNonce = _nonces[publisher];
        if (nonce != expectedNonce) revert NonceMismatch(expectedNonce, nonce);

        bytes32 structHash = keccak256(
            abi.encode(
                ATTESTATION_TYPEHASH,
                keccak256(bytes(ecosystem)),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                artifactDigest,
                tarballHash,
                payloadDigest,
                nonce
            )
        );
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(_hashTypedDataV4(structHash), signature);
        if (err != ECDSA.RecoverError.NoError || signer != publisher) revert InvalidSignature();

        // --- effects
        _nonces[publisher] = expectedNonce + 1;
        if (pinned == address(0)) {
            _namePublisher[nameId] = publisher;
            emit PackageNameClaimed(nameId, publisher, ecosystem, name);
        }
        _attestations[packageId] = Attestation({
            artifactDigest: artifactDigest,
            tarballHash: tarballHash,
            payloadDigest: payloadDigest,
            publisher: publisher,
            submittedAt: uint64(block.timestamp),
            corroborations: 0
        });
        emit AttestationSubmitted(
            packageId, publisher, artifactDigest, tarballHash, payloadDigest, ecosystem, name, version
        );
    }

    /// @notice Report the digest an attester independently computed for an attested
    ///         release. A match counts as a corroboration; a mismatch is recorded as a
    ///         divergence. The contract, not the attester, decides which.
    /// @dev Divergence is recorded, never reverted: reverting would discard the evidence.
    ///      An attester that corroborated earlier may still report a divergence later
    ///      (post-attestation republication), but each attester reports divergence once.
    /// @param packageId The attested package.
    /// @param observedDigest The artifactDigest the caller computed from the live artifact.
    function corroborate(bytes32 packageId, bytes32 observedDigest) external {
        // --- checks
        if (!quorumPolicy.isAttester(msg.sender)) revert NotAnAttester(msg.sender);
        Attestation storage record = _attestations[packageId];
        if (record.submittedAt == 0) revert AttestationMissing(packageId);
        if (msg.sender == record.publisher) revert PublisherCannotCorroborate();
        if (observedDigest == bytes32(0)) revert ZeroDigest();

        if (observedDigest == record.artifactDigest) {
            if (_hasCorroborated[packageId][msg.sender]) revert AlreadyCorroborated(packageId, msg.sender);
            // --- effects
            _hasCorroborated[packageId][msg.sender] = true;
            record.corroborations += 1;
            emit AttesterCorroborated(packageId, msg.sender, record.corroborations, _hasQuorum(packageId));
        } else {
            if (_hasDiverged[packageId][msg.sender]) revert DivergenceAlreadyReported(packageId, msg.sender);
            // --- effects
            _hasDiverged[packageId][msg.sender] = true;
            _divergences[packageId].push(
                Divergence({attester: msg.sender, observedDigest: observedDigest, reportedAt: uint64(block.timestamp)})
            );
            emit DivergenceReported(packageId, msg.sender, record.artifactDigest, observedDigest);
        }
    }

    /// @notice The stored attestation. `submittedAt == 0` means no record exists.
    /// @param packageId The package to look up.
    function getAttestation(bytes32 packageId) external view returns (Attestation memory) {
        return _attestations[packageId];
    }

    /// @notice Whether an attestation exists for `packageId`.
    /// @param packageId The package to look up.
    function exists(bytes32 packageId) external view returns (bool) {
        return _attestations[packageId].submittedAt != 0;
    }

    /// @notice Every divergence reported for `packageId`, in report order.
    /// @param packageId The package to look up.
    function getDivergences(bytes32 packageId) external view returns (Divergence[] memory) {
        return _divergences[packageId];
    }

    /// @notice Whether `attester` has corroborated `packageId`.
    /// @param packageId The package to look up.
    /// @param attester The attester address.
    function hasCorroborated(bytes32 packageId, address attester) external view returns (bool) {
        return _hasCorroborated[packageId][attester];
    }

    /// @notice True iff a record exists, no divergence is recorded, and the corroboration
    ///         count satisfies the quorum policy. A contested artifact never has quorum.
    /// @param packageId The package to evaluate.
    function hasQuorum(bytes32 packageId) external view returns (bool) {
        return _hasQuorum(packageId);
    }

    /// @notice The nonce the next attestation signed by `publisher` must carry.
    /// @param publisher The signing address.
    function nonceOf(address publisher) external view returns (uint256) {
        return _nonces[publisher];
    }

    /// @notice The publisher key pinned to a package name, or zero if never attested.
    /// @param nameId keccak256("<ecosystem>:<name>").
    function publisherOf(bytes32 nameId) external view returns (address) {
        return _namePublisher[nameId];
    }

    /// @notice The EIP-712 domain separator for this deployment.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _hasQuorum(bytes32 packageId) private view returns (bool) {
        Attestation storage record = _attestations[packageId];
        if (record.submittedAt == 0) return false;
        if (_divergences[packageId].length != 0) return false;
        return quorumPolicy.isSatisfied(record.corroborations);
    }
}
