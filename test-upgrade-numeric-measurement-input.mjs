// Regression test for "Allow Numbers Only in Measurement Fields".
//
// This duplicates MeasurementDecimalField's VALID_DECIMAL_IN_PROGRESS
// regex verbatim (src/components/measurement/measurement-decimal-field.tsx)
// and the exact per-keystroke acceptance rule its onChange handler applies
// (`next = event.target.value.trim(); if (regex.test(next)) onChange(next)`
// else ignored, field keeps its previous value) — same reasoning as
// test-upgrade-ranges-pancha-images.mjs's own duplicated arithmetic: this
// file runs under plain Node (no TS/JSX loader), so it can't import a
// "use client" .tsx module directly. `npx tsc --noEmit` already confirmed
// the real component type-checks.
//
// No database or HTTP access needed — this is pure string-matching logic
// — but still run only through scripts/run-tests.mjs for consistency with
// every other test in this project.
//
// NOT covered by this file (documented, not silently skipped): the
// "clear unsaved measurements on refresh" behavior is real React
// client-state (a ref gating localStorage read/write, resolved only after
// an async Dexie check) that requires a live browser + localStorage to
// meaningfully exercise. No DOM-testing library (jsdom/Testing Library)
// is installed in this project and no browser-automation tool is
// available in this session, so that behavior could not be exercised
// end-to-end here — it was verified by code-path tracing only. See the
// written report for the manual steps still needed.

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

const VALID_DECIMAL_IN_PROGRESS = /^\d*\.?\d*$/;

/** Mirrors the onChange handler exactly: trim, test, accept-or-keep-previous. */
function applyKeystroke(previousValue, rawNextValue) {
  const next = rawNextValue.trim();
  return VALID_DECIMAL_IN_PROGRESS.test(next) ? next : previousValue;
}

console.log("1. Allowed values (from the request's own matrix)");
for (const allowed of ["4", "45", "555", "4.5", "42.25", ""]) {
  check(`"${allowed}" is accepted as a complete value`, applyKeystroke("", allowed) === allowed);
}
check("a bare trailing decimal point mid-typing (e.g. \"4.\") is accepted, not rejected", applyKeystroke("4", "4.") === "4.");
check("a leading decimal point mid-typing (e.g. \".5\") is accepted", applyKeystroke("", ".5") === ".5");

console.log("\n2. Disallowed input is rejected (field keeps its previous value)");
for (const rejected of ["a", "b", "abc", "4abc", "45xyz", "4.5.6", "4,5", "4 5", "-4", "4e5"]) {
  check(`"${rejected}" is rejected (previous value "42" is kept)`, applyKeystroke("42", rejected) === "42");
}
check(
  "pasting alphabetic text over an empty field is rejected (field stays empty)",
  applyKeystroke("", "45xyz") === ""
);
check(
  "pasting a value with surrounding whitespace (e.g. a trailing newline from copy-paste) is trimmed and accepted",
  applyKeystroke("", "42.25\n") === "42.25"
);

console.log("\n3. Never auto-appends, rounds, or rewrites a valid value");
check("a typed whole number is returned completely unchanged", applyKeystroke("", "555") === "555");
check("a typed custom decimal outside any predefined range is returned completely unchanged", applyKeystroke("", "42.25") === "42.25");
check("an existing valid value is untouched by a rejected keystroke immediately after it", applyKeystroke("42.25", "42.25x") === "42.25");

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll checks passed.");
  process.exit(0);
}
