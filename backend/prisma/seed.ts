import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const TENANT_ID = "default";

// The values/labels the Marketplace, Status, and Task Type dropdowns used to
// have hardcoded before they became admin-editable ConfigOption rows. Seeded
// once so existing installs (and the shared dev/prod database) start with
// the same options staff already know, instead of an empty dropdown.
const INITIAL_OPTIONS: { category: string; value: string; label: string }[] = [
  { category: "status", value: "started", label: "Started" },
  { category: "status", value: "submitted", label: "Submitted" },
  { category: "status", value: "waiting_for_marketplace", label: "Waiting for Marketplace" },
  { category: "status", value: "waiting_for_client", label: "Waiting for Client" },
  { category: "status", value: "again_submitted", label: "Again Submitted" },
  { category: "status", value: "done", label: "Done" },
  { category: "task_type", value: "listing", label: "Listing" },
  { category: "task_type", value: "inventory_manage", label: "Inventory Manage" },
  { category: "task_type", value: "fba", label: "FBA" },
  { category: "task_type", value: "claims", label: "Claims" },
  { category: "task_type", value: "inactive_blocked_product", label: "Inactive or Blocked Product" },
  { category: "task_type", value: "no_pickup", label: "No Pick Up" },
  { category: "task_type", value: "ads", label: "Ads" },
  { category: "task_type", value: "other", label: "Any Other Issue" },
  { category: "marketplace", value: "amazon", label: "Amazon" },
  { category: "marketplace", value: "flipkart", label: "Flipkart" },
  { category: "marketplace", value: "meesho", label: "Meesho" },
  { category: "marketplace", value: "other", label: "Other" },
];

async function seedConfigOptions() {
  const sortOrderByCategory: Record<string, number> = {};
  for (const { category, value, label } of INITIAL_OPTIONS) {
    const sortOrder = sortOrderByCategory[category] ?? 0;
    sortOrderByCategory[category] = sortOrder + 1;
    await prisma.configOption.upsert({
      where: { tenantId_category_value: { tenantId: TENANT_ID, category, value } },
      update: {},
      create: { tenantId: TENANT_ID, category, value, label, sortOrder },
    });
  }
  console.log(`Seeded ${INITIAL_OPTIONS.length} config options`);
}

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME ?? "Admin";

  if (!email || !password) {
    throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD before running the seed script");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const employee = await prisma.employee.upsert({
    where: { email },
    update: { passwordHash, name, role: "admin" },
    create: { email, passwordHash, name, role: "admin" },
  });

  console.log(`Seeded admin login for ${employee.name} <${employee.email}>`);

  await seedConfigOptions();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
