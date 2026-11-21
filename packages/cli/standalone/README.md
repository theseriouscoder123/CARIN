# cairn-cli

Standalone build of the CAIRN command-line tool: verify that every dependency in an npm
lockfile is byte-for-byte what its maintainer attested, confirmed on-chain by independent
attesters. Preconfigured for the public deployment on Base Sepolia.

Not published to the npm registry — install from the GitHub release tarball:

```bash
npx --yes https://github.com/theseriouscoder123/CARIN/releases/download/cli-v0.1.0/cairn-cli-0.1.0.tgz verify
# or install the `cairn` command globally
npm install -g https://github.com/theseriouscoder123/CARIN/releases/download/cli-v0.1.0/cairn-cli-0.1.0.tgz
cairn verify --lockfile package-lock.json
```

Requires Node.js 22+. Docs: https://cairn-two-ecru.vercel.app/docs · Source: https://github.com/theseriouscoder123/CARIN
