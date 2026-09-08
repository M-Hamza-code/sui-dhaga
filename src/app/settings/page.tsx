import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/ui/page-container";
import { PhoneInput } from "@/components/ui/phone-input";
import { BackupExportControls } from "@/components/backup/backup-export-controls";
import { updateShopSettings } from "@/lib/shop-settings-actions";
import { parseDefaultPrices } from "@/lib/shop-settings";
import { SUIT_TYPE_OPTIONS } from "@/lib/order-options";
import { en } from "@/lib/locale";

// S6 Settings (Step 18) — replaces the Step 10 placeholder at the same
// /settings route. A single plain form (no client-side interactivity
// needed here, unlike the Order form's reactive tiles/autosave) posting
// directly to updateShopSettings. ShopSettings is the Step 9 singleton —
// read here with the same `findUnique({ where: { singleton: true } } })`
// the print/WhatsApp pages already use; a brand-new install with no row
// yet just renders every field blank rather than crashing.
//
// Step 34 adds the two Settings sections the authoritative mockup's S6
// shows and this screen was missing (Step 27 audit): Backup and
// Language. Both are deliberately rendered OUTSIDE the shop-settings
// <form> above — neither is part of what "Save Settings" submits, and
// BackupExportControls' own buttons are already all explicitly
// type="button" (verified before reuse here), so nesting it inside any
// surrounding form would have been safe either way, but keeping it
// outside is the clearer, more honest structure.
//
// Backup reuses BackupExportControls verbatim — the exact same component
// already mounted in the header (Step 19), not a second implementation.
//
// Step 48 — presentation-only. Editable sections (Shop Information,
// Order Defaults) keep the solid white card treatment plus a thin
// indigo top accent; informational sections (Backup, Language) use the
// app's dashed-border/muted-background "read-only" language instead.
//
// Step 51 — this same single page/single route/single <form> now also
// answers to an optional `?view=` query param from the header's new
// Settings menu (SettingsMenu), splitting the same content into three
// named views without introducing a second settings implementation or
// renaming the /settings route:
//   - (no param)      → every section, byte-for-byte the original
//                        Step 48 layout — so any existing bookmark or
//                        direct link to plain /settings is unaffected.
//   - ?view=profile   → Shop Information + the admin email underneath.
//   - ?view=defaults  → Order Defaults only (now labeled "Default
//                        Price" — see en.settings.orderDefaults).
//   - ?view=general   → Backup + Language only, no form/Save button.
//
// updateShopSettings itself is completely unchanged and still expects
// every one of its fields on every submit (name/phone/address/tagline/
// defaultAdvancePercent/price.*) — it has no partial-update mode, and
// was deliberately not touched to add one (out of scope, unnecessary
// risk). So whichever half of the two editable sections isn't visible
// in the current view is still present in the DOM as `type="hidden"`
// inputs carrying its current saved value — Save always resubmits the
// complete, correct set of fields regardless of which view triggered it,
// exactly like before this step.
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { error?: string; success?: string; view?: string };
}) {
  const view = searchParams?.view;
  const showShopInfo = !view || view === "profile";
  const showOrderDefaults = !view || view === "defaults";
  const showBackupLanguage = !view || view === "general";
  const showForm = showShopInfo || showOrderDefaults;

  const [shopSettings, session] = await Promise.all([
    prisma.shopSettings.findUnique({ where: { singleton: true } }),
    // Step 51 — only for the Profile view's admin-email readout, the
    // same cheap, side-effect-free cookie read every page already does
    // for its own auth guard (this page is already behind middleware.ts).
    getSession(),
  ]);
  const defaultPrices = parseDefaultPrices(shopSettings?.defaultPrices);

  const heading = view === "profile" ? en.settingsMenu.profile
    : view === "defaults" ? en.settingsMenu.defaultPrice
    : view === "general" ? en.settingsMenu.setting
    : en.settings.heading;

  return (
    <main className="min-h-screen bg-paper">
      <PageHeader title={en.settings.heading} />

      <PageContainer size="sm">
        <h1 className="text-xl font-semibold text-graphite">{heading}</h1>

        {(searchParams.success || searchParams.error) && (
          <div className="mt-6 space-y-3">
            {searchParams.success && (
              <p className="rounded-sm border border-indigo bg-indigo/10 px-4 py-2 text-sm text-indigo">{en.settings.saved}</p>
            )}
            {searchParams.error && (
              <p role="alert" className="rounded-sm border border-amber bg-amber/10 px-4 py-2 text-sm text-graphite">
                {searchParams.error}
              </p>
            )}
          </div>
        )}

        {showForm && (
          <form action={updateShopSettings} className="mt-6 space-y-8">
            {showShopInfo ? (
              <fieldset className="rounded-sm border border-rule border-t-4 border-t-indigo bg-card p-5 shadow-sm">
                <legend className="px-1 text-xs font-semibold uppercase tracking-widest text-ink">
                  {en.settings.shopInformation}
                </legend>
                <div className="mt-3 space-y-4">
                  <Field label={en.settings.shopName} htmlFor="name">
                    <input
                      id="name"
                      name="name"
                      type="text"
                      required
                      maxLength={120}
                      defaultValue={shopSettings?.name ?? ""}
                      className={INPUT_CLASS}
                    />
                  </Field>
                  <Field label={en.settings.phone} htmlFor="phone">
                    <PhoneInput
                      id="phone"
                      name="phone"
                      type="text"
                      maxLength={20}
                      defaultValue={shopSettings?.phone ?? ""}
                      className={INPUT_CLASS}
                    />
                  </Field>
                  <Field label={en.settings.address} htmlFor="address">
                    <textarea id="address" name="address" rows={2} maxLength={500} defaultValue={shopSettings?.address ?? ""} className={INPUT_CLASS} />
                  </Field>
                  <Field label={en.settings.tagline} htmlFor="tagline">
                    <input
                      id="tagline"
                      name="tagline"
                      type="text"
                      maxLength={200}
                      defaultValue={shopSettings?.tagline ?? ""}
                      className={INPUT_CLASS}
                    />
                  </Field>
                </div>

                {/* Step 51 — Profile view requirement: the admin email
                    shown underneath Shop Information. Read-only display
                    only; no new auth/profile system, just the session
                    that already exists. */}
                {session && (
                  <div className="mt-4 border-t border-rule pt-4">
                    <span className="block text-sm font-medium text-graphite">{en.settings.adminEmail}</span>
                    <p className="mt-1 text-sm text-graphite/70">{session.email}</p>
                  </div>
                )}
              </fieldset>
            ) : (
              // Not shown in this view — still submitted unchanged so
              // Save never wipes the shop's saved info. See file header.
              <>
                <input type="hidden" name="name" value={shopSettings?.name ?? ""} />
                <input type="hidden" name="phone" value={shopSettings?.phone ?? ""} />
                <input type="hidden" name="address" value={shopSettings?.address ?? ""} />
                <input type="hidden" name="tagline" value={shopSettings?.tagline ?? ""} />
              </>
            )}

            {showOrderDefaults ? (
              <fieldset className="rounded-sm border border-rule border-t-4 border-t-indigo bg-card p-5 shadow-sm">
                <legend className="px-1 text-xs font-semibold uppercase tracking-widest text-ink">
                  {en.settings.orderDefaults}
                </legend>

                <div className="mt-3">
                  <Field label={en.settings.defaultAdvancePercent} htmlFor="defaultAdvancePercent">
                    <div className="flex items-center gap-2">
                      <input
                        id="defaultAdvancePercent"
                        name="defaultAdvancePercent"
                        type="text"
                        inputMode="decimal"
                        className={`${INPUT_CLASS} w-28 text-right tabular-nums`}
                        defaultValue={shopSettings?.defaultAdvancePercent?.toString() ?? ""}
                      />
                      <span className="text-sm text-graphite/60">%</span>
                    </div>
                    <p className="mt-1 text-xs text-graphite/50">{en.settings.defaultAdvancePercentHint}</p>
                  </Field>
                </div>

                <div className="mt-5 border-t border-rule pt-4">
                  <span className="block text-sm font-medium text-graphite">{en.settings.defaultPrices}</span>
                  <p className="mt-0.5 text-xs text-graphite/50">{en.settings.defaultPricesHint}</p>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {SUIT_TYPE_OPTIONS.map((option) => (
                      <div key={option.value} className="flex items-center justify-between gap-3">
                        <label htmlFor={`price.${option.value}`} className="text-sm text-graphite">
                          {option.label}
                        </label>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-graphite/50">Rs.</span>
                          <input
                            id={`price.${option.value}`}
                            name={`price.${option.value}`}
                            type="text"
                            inputMode="decimal"
                            className={`${INPUT_CLASS} w-24 text-right tabular-nums`}
                            defaultValue={defaultPrices[option.value] ?? ""}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </fieldset>
            ) : (
              // Not shown in this view — still submitted unchanged so
              // Save never wipes the shop's saved defaults. See file header.
              <>
                <input
                  type="hidden"
                  name="defaultAdvancePercent"
                  value={shopSettings?.defaultAdvancePercent?.toString() ?? ""}
                />
                {SUIT_TYPE_OPTIONS.map((option) => (
                  <input
                    key={option.value}
                    type="hidden"
                    name={`price.${option.value}`}
                    value={defaultPrices[option.value] ?? ""}
                  />
                ))}
              </>
            )}

            <button
              type="submit"
              className="w-full rounded-sm bg-indigo px-4 py-2.5 text-white transition hover:bg-indigo-hover focus:outline-none focus:ring-2 focus:ring-indigo focus:ring-offset-2"
            >
              {en.settings.save}
            </button>
          </form>
        )}

        {/* Backup + Language (Step 34) — informational/status sections,
            not forms. Step 48 gives them the app's existing "read-only"
            visual language (dashed border, paper background — the same
            treatment already used for "no orders yet" style empty
            states) instead of looking like identical editable fieldsets,
            and sits them side-by-side since neither is a multi-field
            form. Reuses BackupExportControls verbatim — see the file
            header comment for why this isn't inside the form above and
            isn't a second backup/export implementation. Step 51 — only
            rendered when the current view includes it (default, or
            ?view=general). */}
        {showBackupLanguage && (
          <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${showForm ? "mt-8" : "mt-6"}`}>
            <fieldset className="rounded-sm border border-dashed border-rule bg-paper p-5">
              <legend className="px-1 text-xs font-semibold uppercase tracking-widest text-graphite/70">
                {en.settings.backup}
              </legend>
              <div className="mt-3">
                <BackupExportControls showLastBackupTime />
                <p className="mt-3 text-xs leading-relaxed text-graphite/50">{en.settings.backupHint}</p>
              </div>
            </fieldset>

            {/* Language — static, disabled, English-only; matches the
                authoritative mockup's S6 exactly. No language-switching
                functionality is implemented. */}
            <fieldset className="rounded-sm border border-dashed border-rule bg-paper p-5">
              <legend className="px-1 text-xs font-semibold uppercase tracking-widest text-graphite/70">
                {en.settings.language}
              </legend>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <p className="flex-1 text-sm text-graphite">{en.settings.languageHint}</p>
                <select disabled aria-label={en.settings.language} className={`${INPUT_CLASS} w-auto bg-card text-graphite/50`}>
                  <option>{en.settings.languageEnglish}</option>
                </select>
              </div>
            </fieldset>
          </div>
        )}
      </PageContainer>
    </main>
  );
}

const INPUT_CLASS =
  "block w-full rounded-sm border border-rule bg-paper px-3 py-2 text-graphite focus:border-indigo focus:outline-none focus:ring-1 focus:ring-indigo";

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-graphite">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
