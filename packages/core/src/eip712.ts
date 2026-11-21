import {
  keccak256,
  recoverTypedDataAddress,
  stringToBytes,
  type Address,
  type Hex,
  type LocalAccount
} from "viem";

export const EIP712_NAME = "CAIRN";
export const EIP712_VERSION = "1";

/**
 * Canonical EIP-712 type string. `packageId` is deliberately absent: it is derived from
 * the three string fields, and the contract checks that binding (SPEC-CONTRACTS §4).
 */
export const ATTESTATION_TYPE_STRING =
  "Attestation(string ecosystem,string name,string version,bytes32 artifactDigest,bytes32 tarballHash,bytes32 payloadDigest,uint256 nonce)";

/** Must equal `AttestationRegistry.ATTESTATION_TYPEHASH` — enforced by a parity test. */
export const ATTESTATION_TYPEHASH: Hex = keccak256(stringToBytes(ATTESTATION_TYPE_STRING));

export const ATTESTATION_TYPES = {
  Attestation: [
    { name: "ecosystem", type: "string" },
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "artifactDigest", type: "bytes32" },
    { name: "tarballHash", type: "bytes32" },
    { name: "payloadDigest", type: "bytes32" },
    { name: "nonce", type: "uint256" }
  ]
} as const;

export interface AttestationMessage {
  ecosystem: string;
  name: string;
  version: string;
  artifactDigest: Hex;
  tarballHash: Hex;
  payloadDigest: Hex;
  nonce: bigint;
}

export function cairnDomain(chainId: number, verifyingContract: Address) {
  return { name: EIP712_NAME, version: EIP712_VERSION, chainId, verifyingContract } as const;
}

/** Sign an attestation with a local account. The key never leaves the account object. */
export async function signAttestation(
  account: LocalAccount,
  chainId: number,
  verifyingContract: Address,
  message: AttestationMessage
): Promise<Hex> {
  return account.signTypedData({
    domain: cairnDomain(chainId, verifyingContract),
    types: ATTESTATION_TYPES,
    primaryType: "Attestation",
    message
  });
}

/** Recover the signer of an attestation signature (off-chain mirror of the contract). */
export async function recoverAttestationSigner(
  chainId: number,
  verifyingContract: Address,
  message: AttestationMessage,
  signature: Hex
): Promise<Address> {
  return recoverTypedDataAddress({
    domain: cairnDomain(chainId, verifyingContract),
    types: ATTESTATION_TYPES,
    primaryType: "Attestation",
    message,
    signature
  });
}
