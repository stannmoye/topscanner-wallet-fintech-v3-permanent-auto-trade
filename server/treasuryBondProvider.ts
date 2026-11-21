/**
 * Server entry point for the treasury-bond catalogue. The implementation lives
 * in `shared/treasury-bond-catalogue.ts` so the exact same, verified parser can
 * also act as a browser-side resilience fallback (the public data sources are
 * CORS-enabled). Keeping this re-export preserves the existing server imports.
 */
export * from "../shared/treasury-bond-catalogue";
