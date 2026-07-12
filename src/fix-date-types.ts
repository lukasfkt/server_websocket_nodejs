import { PrismaClient } from "@prisma/client";

/**
 * One-off maintenance script.
 *
 * Some old rows have their date columns stored as TEXT instead of the INTEGER
 * (epoch millis) that Prisma uses on SQLite. Because SQLite sorts a TEXT value
 * as GREATER than any number, a TEXT `senhaDate` makes `senhaDate >= today`
 * always true — so that row is counted as "today" forever, corrupting the
 * daily senha numbering and leaking into today's lists/history.
 *
 * This converts every TEXT date back to the correct INTEGER epoch, keeping the
 * original date. It is safe to run multiple times: a second run finds nothing.
 *
 * Run in production, e.g.:
 *   npx ts-node src/fix-date-types.ts
 *   (or `railway run npx ts-node src/fix-date-types.ts`)
 */

const prisma = new PrismaClient();

// Date columns that must be stored as INTEGER epoch.
const DATE_COLUMNS = ["createdAt", "updatedAt", "senhaDate"] as const;

type BrokenRow = {
  id: string;
  name: string;
  column: string;
  value: string;
};

async function main() {
  console.log("Scanning for date columns stored as TEXT...");

  const broken: BrokenRow[] = [];
  for (const column of DATE_COLUMNS) {
    // typeof() reports the storage class of the actual value in each row.
    const rows = await prisma.$queryRawUnsafe<
      { id: string; name: string; value: string }[]
    >(
      `SELECT id, name, "${column}" AS value
       FROM "User"
       WHERE typeof("${column}") = 'text'`
    );
    for (const row of rows) {
      broken.push({ id: row.id, name: row.name, column, value: row.value });
    }
  }

  if (broken.length === 0) {
    console.log("Nothing to fix — all date columns are already INTEGER. ✅");
    return;
  }

  console.log(`Found ${broken.length} TEXT date value(s):`);
  let fixed = 0;
  let skipped = 0;

  for (const row of broken) {
    const epoch = Date.parse(row.value);
    if (Number.isNaN(epoch)) {
      console.warn(
        `  SKIP ${row.name} [${row.column}] — unparseable value: ${row.value}`
      );
      skipped++;
      continue;
    }

    // Binding a JS number makes SQLite store an INTEGER, fixing the storage
    // class while preserving the exact instant.
    await prisma.$executeRawUnsafe(
      `UPDATE "User" SET "${row.column}" = ? WHERE id = ?`,
      epoch,
      row.id
    );
    console.log(
      `  FIXED ${row.name} [${row.column}] ${row.value} -> ${epoch}`
    );
    fixed++;
  }

  console.log(`Done. Fixed ${fixed}, skipped ${skipped}.`);
  if (skipped > 0) {
    process.exitCode = 1; // surface that some rows still need manual attention
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
