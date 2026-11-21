/**
 * Typed error hierarchy for CAIRN. Every throw in the workspace uses one of these
 * (CLAUDE.md §5) so callers can branch on `instanceof` / `code` instead of messages.
 */
export class CairnError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Malformed or truncated tar / gzip input. */
export class ArchiveFormatError extends CairnError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("ARCHIVE_FORMAT", message, options);
  }
}

/** An entry path that attempts traversal (`..`, absolute, NUL, drive letter). */
export class PathTraversalError extends CairnError {
  readonly path: string;

  constructor(path: string) {
    super("PATH_TRAVERSAL", `rejected unsafe entry path: ${JSON.stringify(path)}`);
    this.path = path;
  }
}

/** Two entries normalise to the same path. Malformed or hostile; never last-wins. */
export class DuplicatePathError extends CairnError {
  readonly path: string;

  constructor(path: string) {
    super("DUPLICATE_PATH", `duplicate normalised entry path: ${JSON.stringify(path)}`);
    this.path = path;
  }
}

/** An artifact with zero digestible entries. */
export class EmptyArtifactError extends CairnError {
  constructor() {
    super("EMPTY_ARTIFACT", "artifact contains no file or symlink entries");
  }
}

/** Invalid package identity input (ecosystem / name / version). */
export class InvalidPackageIdentityError extends CairnError {
  constructor(message: string) {
    super("INVALID_PACKAGE_IDENTITY", message);
  }
}

/** A feature path that is wired but not yet implemented in this build. */
export class NotImplementedError extends CairnError {
  constructor(what: string) {
    super("NOT_IMPLEMENTED", `${what} is not implemented yet`);
  }
}

/** The chain could not be reached or returned an unusable answer. Gates fail closed. */
export class ChainUnavailableError extends CairnError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("CHAIN_UNAVAILABLE", message, options);
  }
}

/** The package registry failed, or returned something that does not validate. */
export class RegistryError extends CairnError {
  readonly status: number | undefined;
  readonly notFound: boolean;

  constructor(message: string, opts: { status?: number; cause?: unknown } = {}) {
    super("REGISTRY", message, { cause: opts.cause });
    this.status = opts.status;
    this.notFound = opts.status === 404;
  }
}

/** Missing or invalid configuration (env, flags, deployment file). */
export class ConfigError extends CairnError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("CONFIG", message, options);
  }
}

/** A package manifest (package.json inside the artifact) is missing or invalid. */
export class ManifestError extends CairnError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("MANIFEST", message, options);
  }
}

/** A transaction was sent but reverted, or could not be sent. */
export class TransactionError extends CairnError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("TRANSACTION", message, options);
  }
}
