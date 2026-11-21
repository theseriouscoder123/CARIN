import type { CairnClient } from "@cairn/core";
import type { Hex, LocalAccount } from "viem";
import type { ChainPort, SubmittedEvent } from "./attester.js";

/** The real ChainPort: a thin adapter over the shared @cairn/core client. */
export function clientChainPort(client: CairnClient, account: LocalAccount): ChainPort {
  return {
    chainId: client.chainId,
    registry: client.registry,
    address: account.address,
    headBlock: () => client.public.getBlockNumber(),
    async submittedEvents(fromBlock, toBlock): Promise<SubmittedEvent[]> {
      const logs = await client.getSubmittedEvents(fromBlock, toBlock);
      return logs.map((l) => ({
        packageId: l.args.packageId,
        publisher: l.args.publisher,
        artifactDigest: l.args.artifactDigest,
        ecosystem: l.args.ecosystem,
        name: l.args.name,
        version: l.args.version,
        blockNumber: l.blockNumber
      }));
    },
    async corroborate(packageId: Hex, observed: Hex): Promise<Hex> {
      return (await client.corroborate(account, packageId, observed)).hash;
    }
  };
}
