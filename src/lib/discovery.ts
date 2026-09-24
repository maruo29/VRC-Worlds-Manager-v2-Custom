/**
 * Plumbing shared by the pages that pull worlds from the VRChat API rather
 * than the library: recommendations and related worlds.
 */

/** Gap between consecutive VRChat API calls, to stay clear of the rate limiter. */
export const API_CALL_GAP_MS = 150;

/**
 * Hard cap on results a discovery page keeps. The grid is virtualized, so
 * this is not about rendering cost: a suggestion list past this length is
 * noise rather than a suggestion.
 */
export const DISCOVERY_MAX_RESULTS = 120;

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Waits out the pacing gap before every call but the first. Calls are made
 * sequentially on purpose: firing them in parallel is the fastest way to trip
 * the rate limiter.
 */
export async function paceApiCall(callIndex: number): Promise<void> {
  if (callIndex > 0) await sleep(API_CALL_GAP_MS);
}
