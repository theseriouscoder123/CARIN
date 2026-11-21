# SPEC — Smart Contracts

Solidity 0.8.26. Hardhat project in `packages/contracts`. Two contracts, no proxy, no
upgradeability.

---

## 1. Design rules

1. **Append-only.** No function mutates or removes an attestation record. There is no
   admin override, no pause that rewrites history, no upgrade path. Immutability is the
   product; a discoverable upgrade path invalidates the entire pitch.
2. **Custom errors**, never `require` strings.
3. **NatSpec** on every external/public function.
4. Signature recovery via OpenZeppelin `ECDSA` + `EIP712`. Do not hand-roll.
5. `QuorumPolicy` is a separate contract so the trust policy can evolve without touching
   the immutable record. The registry holds an `immutable` reference to it set at
   construction.

---

## 2. `AttestationRegistry.sol`

### 2.1 Types

```solidity
struct Attestation {
    bytes32 artifactDigest;   // Merkle root, SPEC-DIGEST §4
    bytes32 tarballHash;      // sha256 of raw tarball bytes
    bytes32 payloadDigest;    // sha256 of canonical JSON payload
    address publisher;        // recovered from the EIP-712 signature
    uint64  submittedAt;      // block.timestamp
    uint32  corroborations;   // count of distinct attester co-signatures
}

struct Divergence {
    address attester;
    bytes32 observedDigest;
    uint64  reportedAt;
}
```

### 2.2 Storage

```solidity
mapping(bytes32 => Attestation) private _attestations;              // packageId → record
mapping(bytes32 => mapping(address => bool)) private _hasCorroborated;
mapping(bytes32 => Divergence[]) private _divergences;
mapping(address => uint256) private _nonces;                        // replay protection

IQuorumPolicy public immutable quorumPolicy;
```

`packageId` is computed off-chain per `SPEC-DIGEST.md` §5 and passed in. Recomputing a
keccak over strings on-chain wastes gas for no security benefit — the id is an index, and
the signature covers the actual string fields.

### 2.3 Events

```solidity
event AttestationSubmitted(
    bytes32 indexed packageId,
    address indexed publisher,
    bytes32 artifactDigest,
    bytes32 tarballHash,
    bytes32 payloadDigest,
    string  ecosystem,
    string  name,
    string  version
);

event AttesterCorroborated(
    bytes32 indexed packageId,
    address indexed attester,
    uint32  corroborations,
    bool    quorumReached
);

event DivergenceReported(
    bytes32 indexed packageId,
    address indexed attester,
    bytes32 expectedDigest,
    bytes32 observedDigest
);
```

The human-readable `ecosystem`/`name`/`version` appear **only in the event**, never in
storage. The indexer needs them; the contract does not. This keeps storage cost flat while
making the log self-describing — an auditor can rebuild the whole dataset from events
alone, which matters for the "verifiable years later without the vendor" claim.

### 2.4 Errors

```solidity
error AttestationExists(bytes32 packageId);
error AttestationMissing(bytes32 packageId);
error InvalidSignature();
error NotAnAttester(address caller);
error AlreadyCorroborated(bytes32 packageId, address attester);
error PublisherCannotCorroborate();
error ZeroDigest();
error NonceMismatch(uint256 expected, uint256 provided);
error PackageIdMismatch(bytes32 provided, bytes32 expected);   // added in-window
error DivergenceAlreadyReported(bytes32 packageId, address attester); // added in-window
error ZeroAddress();                                           // added in-window
```

### 2.5 Functions

```solidity
/// @notice Record a maintainer's signed attestation for a release.
/// @dev Reverts if a record already exists for `packageId`. Append-only: there is no
///      update path. The signature is EIP-712 over the Attestation type (§4).
function submit(
    bytes32 packageId,
    string calldata ecosystem,
    string calldata name,
    string calldata version,
    bytes32 artifactDigest,
    bytes32 tarballHash,
    bytes32 payloadDigest,
    address publisher,          // added in-window, see note below
    uint256 nonce,
    bytes calldata signature
) external;
```

Checks, in order: digests non-zero → `packageId` binding → no existing record → nonce
matches `nonceOf(publisher)` → recovered signer equals `publisher` → increment nonce →
write record → emit.

The submitting account need not be the publisher. This matters: it lets a CI job relay a
signature produced by an offline key.

> **In-window change — publisher pinning.** The first attestation of a package *name*
> (`nameId = keccak256("<ecosystem>:<name>")`) pins its publisher key and emits
> `PackageNameClaimed`. Later versions of that name must be signed by the pinned key, else
> `PublisherNotPinned`. This closes slot-squatting for every already-attested name and means
> a hijacked npm account cannot mint attested releases. Read it with `publisherOf(nameId)`.
> Key rotation is roadmap work.

> **In-window change — explicit `publisher`.** Without it, a tampered signature simply
> recovers to *some* address and the record is filed under that address; there is no way
> to reject it, and the nonce check is meaningless because it is evaluated against an
> arbitrary recovered key. Naming the publisher makes "tampered signature → revert
> `InvalidSignature`" deterministic and makes the relay's intent explicit.

```solidity
/// @notice Co-sign an existing attestation after independently re-fetching the artifact.
/// @dev Caller must be an active attester in QuorumPolicy. Reverts if the caller is the
///      publisher — self-corroboration is meaningless.
function corroborate(bytes32 packageId, bytes32 observedDigest) external;
```

If `observedDigest == stored.artifactDigest`: increment `corroborations`, mark
`_hasCorroborated`, emit `AttesterCorroborated` with the fresh quorum verdict.

If it differs: append to `_divergences`, emit `DivergenceReported`. **Do not** increment
corroborations, and **do not** revert — the divergence must be recorded on-chain, which is
the entire point. Reverting would discard the evidence.

An attester that corroborated earlier **may** later report a divergence — that is exactly
the post-attestation republication the Divergence Monitor exists to catch. Each attester
reports divergence at most once per package (`DivergenceAlreadyReported`), so a looping
monitor cannot spam the array.

```solidity
function getAttestation(bytes32 packageId) external view returns (Attestation memory);
function getDivergences(bytes32 packageId) external view returns (Divergence[] memory);
function hasQuorum(bytes32 packageId) external view returns (bool);
function nonceOf(address publisher) external view returns (uint256);
function exists(bytes32 packageId) external view returns (bool);                 // added
function hasCorroborated(bytes32 packageId, address attester) external view returns (bool); // added
function domainSeparator() external view returns (bytes32);                      // added
```

`getAttestation` on an unknown id returns a zeroed struct (`submittedAt == 0`) rather than
reverting, so `verify` can classify UNATTESTED without try/catch.

`hasQuorum` returns `false` when any divergence is recorded, regardless of corroboration
count. A contested artifact never reaches quorum. This is a one-line rule with large
consequences — write a test for it.

---

## 3. `QuorumPolicy.sol`

```solidity
interface IQuorumPolicy {
    function isAttester(address who) external view returns (bool);
    function threshold() external view returns (uint32);
    function attesterCount() external view returns (uint32);
    function isSatisfied(uint32 corroborations) external view returns (bool);
}
```

Implementation holds:

```solidity
mapping(address => bool) private _attesters;
uint32 private _attesterCount;
uint32 private _threshold;          // M
address public immutable admin;
```

- Constructor: `QuorumPolicy(admin, address[] initialAttesters, uint32 threshold)` —
  set and validated atomically, so there is never a deployed policy with M > N.
- `addAttester(address)` / `removeAttester(address)` / `setThreshold(uint32)`, all
  `onlyAdmin`. `removeAttester` reverts if it would leave N < M.
- `setThreshold` reverts if `_threshold == 0` or `_threshold > _attesterCount`.
- Emits `AttesterAdded`, `AttesterRemoved`, `ThresholdChanged`.

**Be honest about this in the pitch.** An admin-managed attester set is a centralisation
point, and it is the MVP's weakest link. The prepared answer: the registry record itself is
immutable and admin-proof; only the *policy* for interpreting it is administered, and
`ROADMAP.md` §2.1 replaces that with staked, permissionless attesters. Removing an attester
cannot alter or erase any attestation already recorded.

---

## 4. EIP-712

```
domain = {
  name: "CAIRN",
  version: "1",
  chainId: <chain>,
  verifyingContract: <AttestationRegistry address>
}
```

```
Attestation(
  string ecosystem,
  string name,
  string version,
  bytes32 artifactDigest,
  bytes32 tarballHash,
  bytes32 payloadDigest,
  uint256 nonce
)
```

Note `packageId` is **not** in the signed struct — it is derived from the three string
fields, so signing those binds the id without redundancy. The contract must verify that the
supplied `packageId` matches `keccak256(abi.encodePacked(ecosystem, ":", name, "@", version))`,
otherwise a valid signature could be filed under a wrong index.

> Implementation note: that check costs one keccak over short strings. Do it. Skipping it
> is a real vulnerability, and a sharp judge may look for exactly this kind of binding gap.

Type hashes are constants defined in both `packages/contracts` and `packages/core`, with a
test asserting they match. Drift here produces signature failures that are miserable to
debug at 3am.

---

## 5. Deployment

`packages/contracts/scripts/deploy.ts`:

1. Deploy `QuorumPolicy(admin, threshold = 2)`.
2. Deploy `AttestationRegistry(quorumPolicy)`.
3. Register the three local attester addresses.
4. Write `deployments/<chainId>.json` with addresses, block number and ABI hash.

Every consumer reads addresses from that file or from env. Nothing hardcoded.

`packages/contracts/scripts/seed.ts` repopulates demo state after a Hardhat restart:
publish three clean packages, corroborate each to quorum, and leave one package attested
but not yet corroborated so the dashboard has a visible "pending" row. Hardhat Network
loses all state on restart — without this script, a crash at hour 20 costs the demo.

---

## 6. Tests

| Test | Asserts |
|---|---|
| `submit` happy path | record written, event fields correct, nonce incremented |
| duplicate submit | reverts `AttestationExists` |
| tampered signature | reverts `InvalidSignature` |
| wrong `packageId` for the signed strings | reverts |
| replayed nonce | reverts `NonceMismatch` |
| non-attester calls `corroborate` | reverts `NotAnAttester` |
| publisher calls `corroborate` | reverts `PublisherCannotCorroborate` |
| double corroboration | reverts `AlreadyCorroborated` |
| quorum at exactly M | `hasQuorum` flips true, event carries `quorumReached` |
| divergence recorded | does **not** revert, appended, event emitted |
| divergence poisons quorum | `hasQuorum` false even with M corroborations |
| attester removed after corroborating | historical record unchanged |
| no upgrade/selfdestruct/delegatecall surface | static assertion over the ABI |

That last row is worth writing as an actual test: iterate the ABI and assert no function
can mutate a stored attestation. It is thirty seconds of work and a strong answer to
"how do we know it's really immutable?"
