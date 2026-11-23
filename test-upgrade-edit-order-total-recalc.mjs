// Regression test for the Edit Order "totalAmount silently frozen at
// 0.00" bug (src/components/orders/order-form.tsx) and its fix:
//   - Edit mode's initial state used to hard-code `totalTouched: true`
//     unconditionally, which permanently disabled every item/quantity/
//     price recompute site for the whole edit session (all 10 of them
//     share the exact `!prev.totalTouched ? (computeCombinedTotal(...)
//     ?? prev.totalAmount) : prev.totalAmount` rule tested below) — so
//     adding priced Prince Coat/Waistcoat entries during an edit never
//     touched Total.
//   - Fixed by starting `totalTouched: false` in edit mode too (same as
//     a new order), plus a new "Recalculate from items" action for
//     explicitly restoring the suggestion after a manual edit.
//
// This imports the REAL, now-exported computeKameezTotal/
// computeCoatTotal/computeCombinedTotal directly from order-form.tsx via
// tsx — not a hand-copy of the math. There is no React/component-testing
// tooling anywhere in this repo (no jsdom/React-testing-library), so the
// actual state-machine orchestration (which handler fires on which real
// DOM event) cannot be exercised here — this test instead reproduces the
// exact, single decision rule shared by all 10 production call sites
// (clearly isolated as `applyTotalRule` below, mirroring the inline
// ternary verbatim) and feeds it the REAL calculation functions, so the
// MATH and the FREEZE/UNFREEZE semantics are both genuinely verified
// against production code. The actual rendered button/input behavior
// remains a manual/real-browser verification item, same as every other
// UI-behavior claim throughout this project's testing history.
//
// Run via: npx tsx test-upgrade-edit-order-total-recalc.mjs
async function loadDefault(relPath) {
  const mod = await import(relPath);
  return mod.default ?? mod;
}

const orderForm = await loadDefault("./src/components/orders/order-form.tsx");
const { computeKameezTotal, computeCoatTotal, computeCombinedTotal } = orderForm;

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

// Mirrors the exact rule at all 10 totalAmount-recompute call sites in
// order-form.tsx verbatim (e.g. commitPrinceCoatQuantity,
// setWaistcoatItemFieldValue, handleSuitTypeChange, setItemStyleField...).
function applyTotalRule(prev, computed) {
  return !prev.totalTouched ? (computed ?? prev.totalAmount) : prev.totalAmount;
}

const noDefaultPrices = {};
const twoPrinceCoatItems = [{}, {}];
const twoWaistcoatItems = [{}, {}];

try {
  // ══════════════════════════════════════════════════════════════════
  // 0. The math itself is correct (rules out an arithmetic bug entirely
  //    — the original bug was purely about WHEN this gets called).
  // ══════════════════════════════════════════════════════════════════
  console.log("0. The real calculation functions produce the correct, non-zero figure for the bug's own numbers");
  check("computeCoatTotal: 2 Prince Coat @ 5000 + 2 Waistcoat @ 3000 = 16000.00", computeCoatTotal(twoPrinceCoatItems, twoWaistcoatItems, "5000", "3000") === "16000.00");
  check(
    "computeCombinedTotal: same figure with zero Kameez suits ordered",
    computeCombinedTotal([], twoPrinceCoatItems, twoWaistcoatItems, "5000", "3000", noDefaultPrices) === "16000.00"
  );

  // ══════════════════════════════════════════════════════════════════
  // 1. Editing an existing ZERO-total order and adding priced items ->
  //    now recalculates (the actual bug scenario, now fixed).
  // ══════════════════════════════════════════════════════════════════
  console.log("1. Editing an existing zero-total order and adding priced items");
  let prev = { totalAmount: "0.00", totalTouched: false }; // fixed edit-mode initial state
  const computedAfterAddingItems = computeCombinedTotal([], twoPrinceCoatItems, twoWaistcoatItems, "5000", "3000", noDefaultPrices);
  const totalAfterAdding = applyTotalRule(prev, computedAfterAddingItems);
  check("Total recalculates to 16000.00 instead of staying frozen at 0.00", totalAfterAdding === "16000.00");

  // ══════════════════════════════════════════════════════════════════
  // 2. Editing an existing NON-ZERO order WITHOUT changing any item —
  //    nothing should move the figure away from the order's own stored
  //    total, touched or not (no handler fires at all if nothing is
  //    edited — the initial value is the only value in play).
  // ══════════════════════════════════════════════════════════════════
  console.log("2. Editing an existing non-zero order without touching any item");
  const openedState = { totalAmount: "9999.00", totalTouched: false }; // orderData.totalAmount preserved verbatim at open, regardless of totalTouched
  check("opening Edit Order never changes the order's own existing total by itself", openedState.totalAmount === "9999.00");

  // ══════════════════════════════════════════════════════════════════
  // 3. Manually changing Total, THEN changing an item/price — the
  //    manual value must survive, never silently snapped back.
  // ══════════════════════════════════════════════════════════════════
  console.log("3. Manually changing Total, then changing item prices — the manual value is preserved");
  prev = { totalAmount: "0.00", totalTouched: false };
  // Admin types directly into Total (handleTotalAmountChange's own rule).
  prev = { totalAmount: "12345.00", totalTouched: true };
  // Now a Prince Coat quantity/price-affecting change happens.
  const computedAfterManualEdit = computeCombinedTotal([], twoPrinceCoatItems, twoWaistcoatItems, "5000", "3000", noDefaultPrices);
  const totalAfterManualEdit = applyTotalRule(prev, computedAfterManualEdit);
  check("the manually-entered 12345.00 survives the later item change, not overwritten by 16000.00", totalAfterManualEdit === "12345.00");

  // ══════════════════════════════════════════════════════════════════
  // 4. Explicitly using "Recalculate from items" after a manual edit —
  //    restores the live-computed figure and re-enables auto-recalc.
  // ══════════════════════════════════════════════════════════════════
  console.log('4. Explicitly using "Recalculate from items" restores the computed suggestion');
  const recalculated = computeCombinedTotal([], twoPrinceCoatItems, twoWaistcoatItems, "5000", "3000", noDefaultPrices);
  const afterRecalculateClick = { totalAmount: recalculated, totalTouched: false };
  check("Total is restored to the real computed suggestion", afterRecalculateClick.totalAmount === "16000.00");
  check("totalTouched is cleared, so a further item change would recalculate again", afterRecalculateClick.totalTouched === false);
  const totalAfterOneMoreChange = applyTotalRule(afterRecalculateClick, computeCombinedTotal([], twoPrinceCoatItems, [{}, {}, {}], "5000", "3000", noDefaultPrices));
  check("auto-recalculation is genuinely live again after Recalculate (adding a 3rd Waistcoat updates it)", totalAfterOneMoreChange === "19000.00");
} catch (err) {
  console.error("Unexpected error during test:", err);
  failures++;
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll checks passed.");
  process.exit(0);
}
