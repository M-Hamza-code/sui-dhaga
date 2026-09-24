// Selected-style visual box for the Karigar Work Order print sheet
// (Step 22). Step 58 — now shows the shop's actual design photo (the
// same public/design-images/ files the on-screen Order Form tiles use —
// see order-options.ts/order-form.tsx's own comments), replacing the
// text-only placeholder this box originally was. `imageSrc` is optional
// (a suit's Patti Style is nullable, same as Pocket) so a suit with
// nothing selected for that category simply renders no box at all — the
// caller (work-order/page.tsx's styleBoxesForSuit) only ever builds a
// box for a category that actually has a value, never an empty one.
export function WorkOrderStyleBox({ label, imageSrc }: { label: string; imageSrc?: string }) {
  return (
    <div className="flex w-[76px] flex-none flex-col items-center gap-1 text-center">
      <div className="flex h-[76px] w-[76px] flex-none items-center justify-center overflow-hidden border-[1.5px] border-graphite print:border-black">
        {imageSrc && (
          // eslint-disable-next-line @next/next/no-img-element -- fixed local /public asset, print output, not a remote/optimizable image
          <img src={imageSrc} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="font-nastaliq text-[13px] leading-snug text-graphite print:text-black">{label}</div>
    </div>
  );
}
