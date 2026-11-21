#!/usr/bin/env node
import { Command } from "commander";
import { NotImplementedError } from "@cairn/core";

const program = new Command()
  .name("cairn")
  .description("Quorum-verified provenance for npm dependencies")
  .version("0.1.0");

program
  .command("publish")
  .description("Digest, sign and submit an attestation for a release")
  .argument("[tarball]", "path to a local .tgz")
  .action(() => {
    throw new NotImplementedError("cairn publish");
  });

program
  .command("verify")
  .description("Verify every dependency in an npm lockfile against on-chain quorum")
  .action(() => {
    throw new NotImplementedError("cairn verify");
  });

await program.parseAsync(process.argv);
