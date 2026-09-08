import type { MeasurementSnapshot } from "@prisma/client";
import { KAMEEZ_FIELDS, SHALWAR_DECIMAL_FIELDS, SHALWAR_POCKET_FIELD } from "@/lib/measurement-fields";
import { toFractionDisplay } from "@/lib/fractions";
import { WORK_ORDER_UR } from "@/lib/work-order-style-labels";

// Print-oriented rendering of one MeasurementSnapshot for the Karigar
// Work Order (Step 22 — this component's only consumer). Reuses the
// exact same field list/Urdu glyphs (measurement-fields.ts) and
// fraction-glyph display (fractions.ts, Step 13) already used
// everywhere else in the app — no measurement storage/resolution logic
// lives here, only presentation. The one thing that changes for print is
// typeface: Nastaliq, not the on-screen Naskh (design brief §2: "Print
// headings... Noto Nastaliq Urdu"; the mockup's own print template uses
// Nastaliq for these same row labels too — see work-order-style-labels.ts).
// Numeric values stay Latin digits, wrapped in dir="ltr" so they render
// correctly inside the surrounding RTL document instead of being
// bidi-reordered. `snapshot` is null when neither an override nor a
// default snapshot exists (a legacy order with nothing recorded) — shown
// honestly, never invented.
export function MeasurementSnapshotPrintGrid({ snapshot }: { snapshot: MeasurementSnapshot | null }) {
  if (!snapshot) {
    return (
      <p dir="rtl" className="font-nastaliq text-sm text-graphite/60 print:text-black">
        {WORK_ORDER_UR.measurementsNotAvailable}
      </p>
    );
  }

  return (
    <div dir="rtl" className="grid grid-cols-2 gap-x-6 gap-y-1">
      <Group title={WORK_ORDER_UR.kameezHeading} fields={KAMEEZ_FIELDS} snapshot={snapshot} />
      <Group
        title={WORK_ORDER_UR.shalwarHeading}
        fields={SHALWAR_DECIMAL_FIELDS}
        pocketField={SHALWAR_POCKET_FIELD}
        snapshot={snapshot}
      />
    </div>
  );
}

function Group({
  title,
  fields,
  pocketField,
  snapshot,
}: {
  title: string;
  fields: readonly { key: keyof MeasurementSnapshot; ur: string; label: string }[];
  pocketField?: { key: keyof MeasurementSnapshot; ur: string; label: string };
  snapshot: MeasurementSnapshot;
}) {
  return (
    <div>
      <h4 className="font-nastaliq text-sm font-semibold text-graphite print:text-black">{title}</h4>
      <dl className="mt-0.5 border-t border-graphite pt-0.5 print:border-black">
        {fields.map((field) => (
          <Row key={field.key} ur={field.ur} value={formatDecimal(snapshot[field.key])} />
        ))}
        {pocketField && <Row ur={pocketField.ur} value={formatPocket(snapshot[pocketField.key])} />}
      </dl>
    </div>
  );
}

function Row({ ur, value }: { ur: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="font-nastaliq text-[15px] text-graphite print:text-black">{ur}</span>
      {/* Step 36: bumped from text-xl (20px) to match the authoritative
          mockup's own work-order numeral size (26px) — the design brief
          §7a separately specifies "24pt minimum" for this exact value;
          20px was under both readings. */}
      <span dir="ltr" style={{ unicodeBidi: "isolate" }} className="tabular-nums text-[26px] font-semibold text-graphite print:text-black">
        {value}
      </span>
    </div>
  );
}

function formatDecimal(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return toFractionDisplay(String(value));
}

function formatPocket(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return value ? WORK_ORDER_UR.yes : WORK_ORDER_UR.no;
}
