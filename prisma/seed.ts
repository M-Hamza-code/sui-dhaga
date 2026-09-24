import { PrismaClient, DesignOptionCategory } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * Sui Dhaga — Phase 1 seed script.
 *
 * Seeds exactly two things, per the approved architecture:
 *   1. The single admin account (Phase 1 has no multi-user auth).
 *   2. DesignOption rows for Pocket and Patti/Placket.
 *
 * Step 57 — the real names are now confirmed (matched against the shop's
 * own design photos — see order-options.ts) and replace the old
 * placeholders below. Pocket grew from 3 to 5 options (Pocket D, Side
 * Pocket) and Patti from 2 placeholders to its 3 real options (Chourous,
 * Nok Daar, Fold) — both are still a pure data change, no schema
 * migration, exactly as this file always anticipated. `update` now
 * actually applies label/sortOrder on a re-seed (previously `update: {}`
 * deliberately never touched an existing row, back when the placeholder
 * text was intentionally left alone until someone confirmed the real
 * names) — safe now that these ARE the real, confirmed names.
 */

async function main() {
  // ── 1. Single admin account ───────────────────────────────────────────
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    throw new Error(
      "SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in .env before seeding. " +
        "See .env.example."
    );
  }

  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {}, // do not overwrite an existing admin's password on re-seed
    create: {
      name: "Sui Dhaga Admin",
      email: adminEmail,
      passwordHash,
    },
  });

  console.log(`✔ Admin account ready: ${admin.email}`);

  // ── 2. DesignOption rows (Pocket / Patti) ──────────────────────────────
  // Codes are the stable key (order-options.ts's DESIGN_OPTION_IMAGES maps
  // each one to its design photo) — never rename an existing code, only
  // add new ones, so a historical order's pocketOption/pattiOption FK
  // never dangles.
  const pocketOptions = [
    { code: "POCKET_A", label: "Pocket A", sortOrder: 1 },
    { code: "POCKET_B", label: "Pocket B", sortOrder: 2 },
    { code: "POCKET_C", label: "Pocket C", sortOrder: 3 },
    { code: "POCKET_D", label: "Pocket D", sortOrder: 4 },
    { code: "POCKET_E", label: "Side Pocket", sortOrder: 5 },
  ];

  const pattiOptions = [
    { code: "PATTI_A", label: "Chourous Patti", sortOrder: 1 },
    { code: "PATTI_B", label: "Nok Daar Patti", sortOrder: 2 },
    { code: "PATTI_C", label: "Fold Patti", sortOrder: 3 },
  ];

  for (const option of pocketOptions) {
    await prisma.designOption.upsert({
      where: {
        category_code: {
          category: DesignOptionCategory.POCKET,
          code: option.code,
        },
      },
      update: { label: option.label, sortOrder: option.sortOrder },
      create: {
        category: DesignOptionCategory.POCKET,
        ...option,
      },
    });
  }

  for (const option of pattiOptions) {
    await prisma.designOption.upsert({
      where: {
        category_code: {
          category: DesignOptionCategory.PATTI,
          code: option.code,
        },
      },
      update: { label: option.label, sortOrder: option.sortOrder },
      create: {
        category: DesignOptionCategory.PATTI,
        ...option,
      },
    });
  }

  console.log(`✔ Seeded ${pocketOptions.length} Pocket options and ${pattiOptions.length} Patti Style options.`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
