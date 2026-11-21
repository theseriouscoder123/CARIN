/** href for a package name page, optionally with a version selected. */
export function packageHref(name: string, version?: string | null): string {
  return `/package/${name}${version ? `?v=${encodeURIComponent(version)}` : ""}`;
}

/** Best link for a release: the name page when the name is known, else the version page. */
export function releaseHref(r: { name?: string | null; version?: string | null; packageId?: string | null }): string {
  if (r.name) return packageHref(r.name, r.version);
  return `/packages/${r.packageId ?? ""}`;
}
