// Single English locale table (Step 10). All UI copy for new/rebuilt
// screens should be read from here rather than hardcoded inline, so an
// Urdu interface later (per the design brief) is a config change, not a
// rewrite. English is the only locale shipped for now — this module does
// not implement any language switching.
import en from "./en.json";

export { en };
export type Locale = typeof en;
