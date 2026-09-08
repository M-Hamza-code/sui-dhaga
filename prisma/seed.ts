import { PrismaClient, DesignOptionCategory } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * Sui Dhaga — Phase 1 seed script.
 *
 * Seeds exactly two things, per the approved architecture:
 *   1. The single admin account (Phase 1 has no multi-user auth).
 *   2. Placeholder DesignOption rows for Pocket and Patti/Placket.
 *
 * ⚠️  PLACEHOLDER LABELS — REPLACE BEFORE GO-LIVE ⚠️
 * The exact traditional names for the three Pocket designs and the
 * Patti/Placket options on the physical register are still unconfirmed
 * (see architecture doc, Section 24, items 1–2). The codes/labels below
 * are clearly marked placeholders so the Add Order form is usable during
 * development, but they MUST be replaced with the real confirmed labels
 * before this goes live. Updating them is a data change only — no schema
 * migration is required.
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

  // ── 2. Placeholder DesignOption rows (Pocket / Patti) ─────────────────
  // ⚠️ PLACEHOLDER — replace code/label once real names are confirmed.
  const pocketPlaceholders = [
    { code: "POCKET_A", label: "Pocket Design A (PLACEHOLDER — confirm real name)", sortOrder: 1 },
    { code: "POCKET_B", label: "Pocket Design B (PLACEHOLDER — confirm real name)", sortOrder: 2 },
    { code: "POCKET_C", label: "Pocket Design C (PLACEHOLDER — confirm real name)", sortOrder: 3 },
  ];

  // ⚠️ PLACEHOLDER — replace code/label once real names are confirmed.
  const pattiPlaceholders = [
    { code: "PATTI_A", label: "Patti Design A (PLACEHOLDER — confirm real name)", sortOrder: 1 },
    { code: "PATTI_B", label: "Patti Design B (PLACEHOLDER — confirm real name)", sortOrder: 2 },
  ];

  for (const option of pocketPlaceholders) {
    await prisma.designOption.upsert({
      where: {
        category_code: {
          category: DesignOptionCategory.POCKET,
          code: option.code,
        },
      },
      update: {},
      create: {
        category: DesignOptionCategory.POCKET,
        ...option,
      },
    });
  }

  for (const option of pattiPlaceholders) {
    await prisma.designOption.upsert({
      where: {
        category_code: {
          category: DesignOptionCategory.PATTI,
          code: option.code,
        },
      },
      update: {},
      create: {
        category: DesignOptionCategory.PATTI,
        ...option,
      },
    });
  }

  console.log(
    `✔ Seeded ${pocketPlaceholders.length} placeholder Pocket options and ` +
      `${pattiPlaceholders.length} placeholder Patti options — REPLACE LABELS BEFORE GO-LIVE.`
  );
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
