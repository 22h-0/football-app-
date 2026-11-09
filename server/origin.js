// Explicit configuration supports custom domains. Render supplies its assigned
// HTTPS URL at runtime; never derive the trusted origin from request headers.
export function resolveAppOrigin(environment = process.env) {
  return environment.APP_ORIGIN || environment.RENDER_EXTERNAL_URL || null;
}
