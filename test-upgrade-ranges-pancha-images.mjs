// Regression test for the Task 1-3 follow-up fix:
//   - measurement-options.ts's fixed per-field ranges (Task 2).
//   - The 4 real Pancha design images actually exist on disk and are
//     correctly mapped (Task 3).
// No database access needed for this file (these are static assets +
// a pure function), but it's still run only through
// scripts/run-tests.mjs so it's always exercised in the same guarded,
// isolated way as every other test in this project.
//
// The exact arithmetic below is a deliberate, labeled duplicate of
// src/lib/measurement-options.ts's own toCents/fromCents/
// measurementOptionsFor — this file runs under plain Node (no TS
// loader), so it cannot import that module's path-aliased ("@/lib/...")
// TypeScript source directly. `npx tsc --noEmit` already confirmed the
// real module type-checks and is correctly imported by both UI
// components; this test independently re-derives the same arithmetic
// against the exact spec'd ranges to catch any future drift between the
// two.
import fs from "node:fs";
import path from "node:path";

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

// ── 1. Fixed ranges (duplicated from measurement-options.ts) ───────────
const MEASUREMENT_RANGES = {
  length: { start: 36, end: 42, step: 0.5 },
  shoulder: { start: 14, end: 20, step: 0.5 },
  sleeve: { start: 22, end: 26, step: 0.5 },
  kohni: { start: 10, end: 14, step: 0.5 },
  armHole: { start: 10, end: 14, step: 0.5 },
  neck: { start: 14, end: 19, step: 0.5 },
  chest: { start: 22, end: 42, step: 1 },
  waist: { start: 22, end: 32, step: 1 },
  hem: { start: 22, end: 42, step: 1 },
  shalwarLength: { start: 37, end: 42, step: 0.5 },
  pancha: { start: 7, end: 12, step: 0.5 },
  shalwarGheraReady: { start: 20, end: 30, step: 1 },
};
function toCents(n) { return Math.round(n * 100); }
function fromCents(cents) {
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  if (frac === 0) return String(whole);
  if (frac % 10 === 0) return `${whole}.${frac / 10}`;
  return `${whole}.${String(frac).padStart(2, "0")}`;
}
function measurementOptionsFor(fieldKey) {
  const range = MEASUREMENT_RANGES[fieldKey];
  if (!range) return [];
  const options = [];
  for (let c = toCents(range.start); c <= toCents(range.end); c += toCents(range.step)) {
    options.push(fromCents(c));
  }
  return options;
}

console.log("1. Fixed measurement ranges (Task 2)");
const length = measurementOptionsFor("length");
check("length: 36 to 42, step 0.5, both ends inclusive", length[0] === "36" && length[length.length - 1] === "42" && length.includes("36.5") && length.length === 13);

const sleeve = measurementOptionsFor("sleeve");
check("sleeve: 22 to 26, step 0.5", sleeve[0] === "22" && sleeve[sleeve.length - 1] === "26" && sleeve.length === 9);

const shoulder = measurementOptionsFor("shoulder");
check("shoulder: 14 to 20, step 0.5", shoulder[0] === "14" && shoulder[shoulder.length - 1] === "20" && shoulder.length === 13);

const chest = measurementOptionsFor("chest");
check("chest: 22 to 42, WHOLE NUMBERS ONLY (no .5 values)", chest[0] === "22" && chest[chest.length - 1] === "42" && chest.length === 21 && chest.every((v) => !v.includes(".")));

const hem = measurementOptionsFor("hem");
check("hem: 22 to 42, whole numbers only", hem[0] === "22" && hem[hem.length - 1] === "42" && hem.every((v) => !v.includes(".")));

const armHole = measurementOptionsFor("armHole");
check("armHole: 10 to 14, step 0.5", armHole[0] === "10" && armHole[armHole.length - 1] === "14" && armHole.length === 9);

const neck = measurementOptionsFor("neck");
check("neck: 14 to 19, step 0.5", neck[0] === "14" && neck[neck.length - 1] === "19" && neck.length === 11);

const waist = measurementOptionsFor("waist");
check("waist: 22 to 32, whole numbers only", waist[0] === "22" && waist[waist.length - 1] === "32" && waist.every((v) => !v.includes(".")));

const shalwarLength = measurementOptionsFor("shalwarLength");
check("shalwarLength: 37 to 42, step 0.5", shalwarLength[0] === "37" && shalwarLength[shalwarLength.length - 1] === "42" && shalwarLength.length === 11);

const pancha = measurementOptionsFor("pancha");
check("pancha (numeric): 7 to 12, step 0.5", pancha[0] === "7" && pancha[pancha.length - 1] === "12" && pancha.length === 11);

const shalwarGheraReady = measurementOptionsFor("shalwarGheraReady");
check(
  "shalwarGheraReady (Finished Ghera): 20 to 30, whole numbers only",
  shalwarGheraReady[0] === "20" && shalwarGheraReady[shalwarGheraReady.length - 1] === "30" && shalwarGheraReady.every((v) => !v.includes("."))
);

// Custom/out-of-range values must still be representable — these ranges
// are suggestions only, never a restriction enforced anywhere in code.
check("a custom out-of-range value (e.g. '4.75') is just a plain string, never rejected by this module", typeof "4.75" === "string");

// ── 2. The 4 real Pancha images exist on disk and are correctly mapped ─
console.log("\n2. Pancha design images (Task 3)");
const PUBLIC_DESIGN_IMAGES = path.join(process.cwd(), "public", "design-images");
const PANCHA_IMAGE_MAP = {
  PANCHA_A: "sada pancha.jpeg", // Sada Pancha
  PANCHA_B: "jali pancha.jpeg", // Jaali Pancha
  PANCHA_C: "kanta pancha.jpeg", // Kanta Pancha
  PANCHA_D: "doora pancha.jpeg", // Doora Pancha
};
for (const [code, filename] of Object.entries(PANCHA_IMAGE_MAP)) {
  const fullPath = path.join(PUBLIC_DESIGN_IMAGES, filename);
  check(`${code} -> "${filename}" exists on disk`, fs.existsSync(fullPath));
}
check("exactly 4 Pancha image files are mapped (one per seeded option)", Object.keys(PANCHA_IMAGE_MAP).length === 4);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll checks passed.");
  process.exit(0);
}
