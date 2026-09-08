// Selected-style visual box for the Karigar Work Order print sheet
// (Step 22). The brief's real photographed illustrations don't exist in
// this project yet, so this is a plain bordered box with the label text
// — an honest placeholder, not fabricated artwork. Deliberately built as
// its own small component (matching style-tile.tsx's own comment for the
// on-screen S3 tiles) so Step 23 can later give it a real image without
// touching the layout/data that produces the list of boxes to render.
export function WorkOrderStyleBox({ label }: { label: string }) {
  return (
    <div className="flex h-[76px] w-[76px] flex-none items-center justify-center border-[1.5px] border-graphite p-1 text-center font-nastaliq text-[13px] leading-snug text-graphite print:border-black print:text-black">
      {label}
    </div>
  );
}
