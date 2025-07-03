import { PrismaClient } from "@prisma/client";
import { JsonDB, Config } from "node-json-db";

const prisma = new PrismaClient();

async function migrateData() {
  try {
    console.log("Starting data migration...");
    
    const jsonDb = new JsonDB(new Config("jsonDB", true, false, "/"));
    
    let userData = [];
    try {
      userData = await jsonDb.getData("/users");
      console.log(`Found ${userData.length} users to migrate`);
    } catch (error) {
      console.log("No existing data found in JSON file");
      return;
    }

    for (const user of userData) {
      try {
        await prisma.user.create({
          data: {
            id: user.id,
            name: user.name,
            status: user.status,
            senha: user.senha,
            sector: user.sector,
            isPreferencial: user.isPreferencial || false,
            celphone: user.celphone ? String(user.celphone) : null,
            email: user.email || null,
            createdAt: new Date(user.updatedAt || new Date()),
            updatedAt: new Date(user.updatedAt || new Date()),
            senhaDate: new Date(user.updatedAt || new Date()),
          },
        });
        console.log(`Migrated user: ${user.name} (${user.senha})`);
      } catch (error) {
        console.error(`Failed to migrate user ${user.name}:`, error);
      }
    }

    console.log("Migration completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    await prisma.$disconnect();
  }
}

migrateData();