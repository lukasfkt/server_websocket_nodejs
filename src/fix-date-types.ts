import { PrismaClient } from "@prisma/client";
import { normalizeDateColumns } from "./normalizeDates";

/**
 * One-off / on-demand maintenance runner for the same fix that the server now
 * applies automatically on boot (see normalizeDates). Handy for running the
 * conversion manually without restarting the server.
 *
 *   npm run fix-dates
 */

const prisma = new PrismaClient();

async function main() {
  console.log("Scanning for date columns stored as TEXT...");
  const { fixed, skipped } = await normalizeDateColumns(prisma);
  if (fixed === 0 && skipped === 0) {
    console.log("Nothing to fix — all date columns are already INTEGER. ✅");
  } else {
    console.log(`Done. Fixed ${fixed}, skipped ${skipped}.`);
    if (skipped > 0) process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("fix-date-types failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
