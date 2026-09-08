const MAX_WIDTH = {
  sm: "max-w-lg",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-5xl",
} as const;

// Shared content-width wrapper. Existing screens (Steps 1–9) each inline
// their own `mx-auto max-w-* p-6` — this is only wired up in NEW pages for
// now (see src/app/orders, src/app/settings); retrofitting old pages is
// out of scope for this step.
export function PageContainer({
  size = "md",
  children,
}: {
  size?: keyof typeof MAX_WIDTH;
  children: React.ReactNode;
}) {
  return <div className={`mx-auto ${MAX_WIDTH[size]} p-6`}>{children}</div>;
}
