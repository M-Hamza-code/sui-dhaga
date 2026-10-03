-- Step 63: Collar and Bain become a single combined choice (exactly one
-- of the two, never both, never neither), enforced at the application
-- layer (order-actions.ts). Making both columns nullable is required to
-- honestly represent "neither selected" instead of faking a hidden
-- default. Purely additive/non-destructive: every existing row already
-- has real values in both columns and is unaffected.
ALTER TABLE "orders" ALTER COLUMN "collarType" DROP NOT NULL;
ALTER TABLE "orders" ALTER COLUMN "bainType" DROP NOT NULL;
