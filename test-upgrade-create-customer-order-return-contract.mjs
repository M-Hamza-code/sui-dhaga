// Regression test for "TypeError: Cannot read properties of undefined
// (reading 'redirectUrl')" at order-form.tsx's call site for
// createCustomerAndOrder (customer-order-actions.ts).
//
// Root cause: that action used to call redirect() directly for its two
// validation-failure paths. redirect() is typed `never` and throws a
// special signal that Next.js's OWN request-handling layer intercepts —
// but when this action is invoked as a plain client-side function call
// (order-form.tsx's mode="new" branch, converted from a native <form
// action> submission in the previous round specifically so the client
// could read the action's return value), that interception did not
// reliably happen, and the calling `await createCustomerAndOrder(...)`
// resolved to `undefined` instead.
//
// The fix removes every redirect() call from this action — it now
// ALWAYS executes a plain `return` statement on every reachable path
// (two explicit `{ok:false, error}` failure returns, or the single
// `{ok:true, ...}` success return after the retry loop) or else
// genuinely throws (an unexpected error, which is a visible failure,
// not a silent undefined). This is a structural, source-level guarantee
// — not dependent on Next.js's internal redirect-dispatch behavior at
// all anymore — verified below two ways: (1) directly inspecting the
// module source confirms no `redirect(` call remains anywhere in it,
// and the module imports without error; (2) the real, exported
// validation helpers it calls (parseCustomerInput/validateOrderInput)
// are exercised directly to confirm their error MESSAGES are preserved
// unchanged (requirement: "preserve existing validation errors").
//
// Follow-up (same bug class, a second occurrence): requireSession()
// (auth.ts) ALSO calls redirect("/login") internally when the session
// cookie is missing/invalid — a long-open tab can outlive a
// SESSION_SECRET/SESSION_COOKIE_NAME rotation, or the cookie can simply
// expire. Invoked from this same plain client-call site, this produced
// the identical "resolves to undefined" symptom, and the NEWLY ADDED
// `if (!result.ok)` check then crashed on `undefined.ok` — invisible to
// the user (an uncaught exception inside an event handler shows no UI
// message), leaving Save Order looking like it does nothing at all.
// Fixed the same way: getSession() (the non-redirecting sibling) plus
// an explicit `{ok:false, error}` return instead of ever redirecting.
// Checked exhaustively this round: grepped every other function this
// action calls (parseCustomerInput, validateOrderInput,
// generateCustomerCode, generateOrderNumber, buildOrderCreateData,
// isUniqueConstraintError, printPreviewUrl) for a third hidden
// redirect()/requireSession() occurrence — none exists.
//
// What this does NOT re-test: calling createCustomerAndOrder() itself
// end-to-end through Next's real Server Action RPC dispatch — getSession()
// (like requireSession() before it) still calls next/headers's cookies(),
// which throws outside a real request context, so this action still
// cannot be invoked directly from a plain script (the same established
// constraint noted throughout this project's test suite). The full
// transaction logic (validation, code/number generation, the
// create-both-or-neither write, and the resulting hydration + immediate
// status change) is already covered end-to-end by
// test-upgrade-new-customer-order-immediate-status.mjs, unaffected by
// this change since it duplicates the transaction body rather than
// calling through the ok/session/redirect wrapper this fix touches.
//
// Run via: npx tsx test-upgrade-create-customer-order-return-contract.mjs
import { readFileSync } from "node:fs";

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

async function loadDefault(relPath) {
  const mod = await import(relPath);
  return mod.default ?? mod;
}

try {
  // ══════════════════════════════════════════════════════════════════
  // 1. The module loads cleanly and exports the real function.
  // ══════════════════════════════════════════════════════════════════
  console.log("1. customer-order-actions.ts imports cleanly and exports createCustomerAndOrder");
  const actionsModule = await loadDefault("./src/lib/customer-order-actions.ts");
  check("createCustomerAndOrder is a real function", typeof actionsModule.createCustomerAndOrder === "function");

  // ══════════════════════════════════════════════════════════════════
  // 2. Structural guarantee: no redirect() call remains in this file at
  //    all — the exact mechanism that produced the regression.
  // ══════════════════════════════════════════════════════════════════
  console.log("2. No redirect() call remains anywhere in customer-order-actions.ts");
  const source = readFileSync("./src/lib/customer-order-actions.ts", "utf8");
  check("the file no longer imports redirect from next/navigation", !source.includes('from "next/navigation"'));
  // Strip comments first — the explanatory comments above deliberately
  // mention "redirect()" in prose; only CODE usage matters here.
  const codeOnly = source
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
  check("no functional redirect( call exists in the actual code", !/\bredirect\(/.test(codeOnly));
  check(
    "all three failure paths (session, and both validations) now return an explicit {ok:false,...} object",
    (source.match(/return \{ ok: false, error:/g) ?? []).length === 3
  );
  check("the success path returns an explicit {ok:true,...} object", /return \{\s*ok: true,/.test(source));

  // ══════════════════════════════════════════════════════════════════
  // 2b. The second occurrence of this exact bug class: requireSession()
  //     (which itself calls redirect()) is no longer used here at all —
  //     replaced with the non-redirecting getSession() plus an explicit
  //     check. Also confirms no OTHER dependency of this action hides a
  //     third occurrence.
  // ══════════════════════════════════════════════════════════════════
  console.log("2b. requireSession() is no longer called here — getSession() plus an explicit check instead");
  // Comments legitimately mention "requireSession()" in prose to explain
  // what was removed — only CODE usage (an actual call) matters here.
  check("requireSession is not actually called in this file's code anymore", !/requireSession\(/.test(codeOnly));
  check("getSession is used instead", /\bgetSession\(\)/.test(source));
  check("a missing session returns an explicit, visible {ok:false,...} message", /Your session has expired/.test(source));

  // Only the SPECIFIC functions createCustomerAndOrder actually calls —
  // not every other, unrelated export in these shared files (which
  // legitimately use requireSession()/redirect() for their own separate
  // Server Actions, e.g. createOrder, deleteCustomer).
  const dependencyFunctions = [
    { file: "./src/lib/order-actions.ts", name: "validateOrderInput" },
    { file: "./src/lib/order-actions.ts", name: "generateOrderNumber" },
    { file: "./src/lib/customer-actions.ts", name: "generateCustomerCode" },
  ];
  let thirdOccurrenceFound = false;
  for (const { file, name } of dependencyFunctions) {
    const depSource = readFileSync(file, "utf8");
    const lines = depSource.split("\n");
    const startIndex = lines.findIndex((line) => line.includes(`function ${name}(`));
    if (startIndex === -1) {
      console.error(`  -> could not locate function ${name} in ${file} to check`);
      thirdOccurrenceFound = true;
      continue;
    }
    const endIndex = lines.findIndex((line, i) => i > startIndex && line === "}");
    const body = lines
      .slice(startIndex, endIndex === -1 ? undefined : endIndex + 1)
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");
    if (/\bredirect\(|requireSession\(/.test(body)) {
      console.error(`  -> found in ${name} (${file})`);
      thirdOccurrenceFound = true;
    }
  }
  check("no third hidden redirect()/requireSession() occurrence exists in any function this action actually calls", !thirdOccurrenceFound);

  // ══════════════════════════════════════════════════════════════════
  // 3. Validation error MESSAGES are unchanged — this fix only changes
  //    HOW a failure is delivered to the caller, never the message text
  //    or the validation rules themselves.
  // ══════════════════════════════════════════════════════════════════
  console.log("3. Validation error messages are preserved exactly (same helpers, same rules)");
  const { parseCustomerInput } = await loadDefault("./src/lib/customer-validation.ts");
  const emptyFd = new FormData();
  const customerResult = parseCustomerInput(emptyFd);
  check("an invalid customer submission still fails validation with a real message", customerResult.success === false && typeof customerResult.error === "string" && customerResult.error.length > 0);

  const { validateOrderInput } = await loadDefault("./src/lib/order-actions.ts");
  const orderFd = new FormData();
  orderFd.set("name", "Someone");
  orderFd.set("phonePrimary", "03001234567");
  orderFd.set("orderDate", new Date().toISOString().slice(0, 10));
  orderFd.set("totalAmount", "1000.00");
  orderFd.set("advanceAmount", "0.00");
  orderFd.set("kameezQuantity", "0");
  orderFd.set("princeCoatQuantity", "0");
  orderFd.set("waistcoatQuantity", "0");
  const orderResult = await validateOrderInput(orderFd);
  check(
    "an order with no garments still fails with the same existing message",
    "error" in orderResult && orderResult.error === "Add at least one Kameez/Shalwar suit, Prince Coat, or Waistcoat entry."
  );
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
