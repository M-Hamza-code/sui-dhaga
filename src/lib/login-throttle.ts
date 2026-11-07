// Failed-login throttling for the single admin account.
//
// Before this, `login` (auth-actions.ts) would compare a password as many
// times as it was asked to, with no delay and no lockout. With exactly one
// account and no second factor, that password is the only thing standing
// between the internet and the shop's entire customer book — so an
// unlimited-guess endpoint is the weakest point in the app.
//
// DELIBERATELY IN-MEMORY, and that choice has real limits worth stating
// plainly rather than discovering later:
//
//   1. Counters reset when the server process restarts. A restart is
//      therefore a free attempt-counter reset. Acceptable here because a
//      restart is not something a remote attacker can trigger on demand.
//   2. Counters are per-process. Behind more than one instance/replica,
//      an attacker effectively gets MAX_ATTEMPTS per instance. This app
//      is a single-shop, single-instance deployment; if that ever changes,
//      this module is the thing to move into Postgres (or Redis) — the
//      call sites would not need to change, only the three functions
//      below.
//
// Those limits are why this is not presented as a complete defence. It
// closes the "script hammers /login forever" hole, which is the realistic
// threat, without adding a dependency or a migration.

/** Failed attempts allowed inside WINDOW_MS before the account locks. */
const MAX_ATTEMPTS = 5;
/** Rolling window that failed attempts are counted within. */
const WINDOW_MS = 15 * 60 * 1000;
/** How long a lockout lasts once MAX_ATTEMPTS is reached. */
const LOCKOUT_MS = 15 * 60 * 1000;

interface AttemptRecord {
  /** Timestamps (ms) of failed attempts still inside the rolling window. */
  failures: number[];
  /** When the current lockout ends, or null if not locked. */
  lockedUntil: number | null;
}

// Module-level state. In Next.js dev the module can be re-evaluated on
// hot reload (which clears this) — same practical effect as a restart,
// already covered by limit (1) above.
const attempts = new Map<string, AttemptRecord>();

/**
 * Keep the map from growing without bound if many distinct keys show up.
 * Called on each record failure — cheap, since entries are only kept while
 * they are either inside the window or actively locked.
 */
function evictStale(now: number): void {
  for (const [key, record] of attempts) {
    const locked = record.lockedUntil !== null && record.lockedUntil > now;
    const hasRecentFailure = record.failures.some((at) => now - at < WINDOW_MS);
    if (!locked && !hasRecentFailure) {
      attempts.delete(key);
    }
  }
}

export interface ThrottleStatus {
  /** True when the caller must be refused without checking the password at all. */
  locked: boolean;
  /** Whole minutes until the lockout lifts (minimum 1 while locked). */
  retryAfterMinutes: number;
}

/**
 * Whether this key is currently locked out. Call BEFORE verifying a
 * password — a locked key must not get a password comparison at all,
 * otherwise the lockout still leaks "was that the right password?" through
 * response timing.
 */
export function checkLoginAllowed(key: string): ThrottleStatus {
  const now = Date.now();
  const record = attempts.get(key);

  if (!record || record.lockedUntil === null || record.lockedUntil <= now) {
    return { locked: false, retryAfterMinutes: 0 };
  }

  return {
    locked: true,
    retryAfterMinutes: Math.max(1, Math.ceil((record.lockedUntil - now) / 60_000)),
  };
}

/**
 * Record one failed attempt, locking the key once MAX_ATTEMPTS failures
 * have happened inside WINDOW_MS. Returns the status AFTER this failure,
 * so the caller can tell the user they are now locked out.
 */
export function recordFailedLogin(key: string): ThrottleStatus {
  const now = Date.now();
  const record = attempts.get(key) ?? { failures: [], lockedUntil: null };

  // Drop failures that have aged out of the window, so a slow trickle of
  // wrong guesses over hours never accumulates into a lockout.
  record.failures = record.failures.filter((at) => now - at < WINDOW_MS);
  record.failures.push(now);

  if (record.failures.length >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_MS;
    // Start the next window clean, so the lockout isn't immediately
    // re-triggered by the same already-counted failures once it expires.
    record.failures = [];
  }

  attempts.set(key, record);
  evictStale(now);

  return checkLoginAllowed(key);
}

/** Clear all state for a key. Called on a successful login. */
export function clearLoginAttempts(key: string): void {
  attempts.delete(key);
}
