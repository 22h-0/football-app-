// Cloudflare's default build detection may run the local-mode build script.
// A workers.dev deployment must still use server-owned tournaments, never an
// independent browser-local copy of what is meant to be a shared tournament.
export function usesSharedWebsite(location, sharedBuild = false) {
  return location.protocol !== 'file:' && (
    sharedBuild || location.hostname.endsWith('.workers.dev')
  );
}
