import { PrismaClient } from "@prisma/client";

/**
 * Some old rows have their date columns stored as TEXT instead of the INTEGER
 * (epoch millis) that Prisma uses on SQLite. Because SQLite sorts a TEXT value
 * as GREATER than any number, a TEXT `senhaDate` makes `senhaDate >= today`
 * always true — so that row is counted as "today" forever, corrupting the
 * daily senha numbering and leaking into today's lists/history.
 *
 * This converts every TEXT date back to the correct INTEGER epoch, keeping the
 * original instant. It never deletes anything and is safe to run repeatedly:
 * once every value is INTEGER, subsequent runs find nothing.
 */

// Date columns that must be stored as INTEGER epoch.
const DATE_COLUMNS = ["createdAt", "updatedAt", "senhaDate"] as const;

export type NormalizeResult = { fixed: number; skipped: number };

export async function normalizeDateColumns(
  prisma: PrismaClient
): Promise<NormalizeResult> {
  let fixed = 0;
  let skipped = 0;

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
      const epoch = Date.parse(row.value);
      if (Number.isNaN(epoch)) {
        console.warn(
          `[normalizeDates] SKIP ${row.name} [${column}] — unparseable: ${row.value}`
        );
        skipped++;
        continue;
      }

      // Binding a JS number makes SQLite store an INTEGER, fixing the storage
      // class while preserving the exact instant.
      await prisma.$executeRawUnsafe(
        `UPDATE "User" SET "${column}" = ? WHERE id = ?`,
        epoch,
        row.id
      );
      console.log(
        `[normalizeDates] FIXED ${row.name} [${column}] ${row.value} -> ${epoch}`
      );
      fixed++;
    }
  }

  return { fixed, skipped };
}
