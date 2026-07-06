import express, { Request, Response } from "express";
import cors, { CorsOptions } from "cors";
import compression from "compression";
import { Server } from "socket.io";
import http from "http";
import { PrismaClient, Prisma } from "@prisma/client";

const PORT = 8899;
const app = express();
const httpServer = http.createServer(app);

// Treat localhost and 127.0.0.1 as the same origin (the browser does not).
function withLocalhostTwins(origins: string[]): string[] {
  const set = new Set(origins);
  for (const origin of origins) {
    if (origin.includes("127.0.0.1")) {
      set.add(origin.replace("127.0.0.1", "localhost"));
    }
    if (origin.includes("localhost")) {
      set.add(origin.replace("localhost", "127.0.0.1"));
    }
  }
  return [...set];
}

const allowedOrigins = withLocalhostTwins(
  (process.env.APP_WEB_URL || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

// Shared origin check for both Express and socket.io. With no APP_WEB_URL
// configured (dev), all origins are allowed.
const corsOrigin: CorsOptions["origin"] = (origin, callback) => {
  if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
    callback(null, true);
  } else {
    callback(new Error(`Origin not allowed by CORS: ${origin}`));
  }
};

const io = new Server(httpServer, {
  cors: { origin: corsOrigin, methods: ["GET", "POST"] },
});

const prisma = new PrismaClient();

app.use(compression());
app.use(cors({ origin: corsOrigin }));
app.use(express.json());

type UserStatus = "queue" | "ready" | "onGoing" | "done" | "canceled";

// Statuses shown by the live screens (Painel/Admin). Anything else
// (done/canceled) is dropped from the payload so the list stays small.
const ACTIVE_STATUSES: UserStatus[] = ["queue", "ready", "onGoing"];

// Only the columns the UI actually renders.
const QUEUE_SELECT = {
  id: true,
  name: true,
  senha: true,
  sector: true,
  status: true,
  isPreferencial: true,
  celphone: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

// Start of the current day in the server's local timezone.
function startOfToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

// Single source of truth for the list the screens consume: today's
// active entries, oldest first, limited to the fields the UI needs.
async function getQueueUsers() {
  return prisma.user.findMany({
    where: {
      senhaDate: { gte: startOfToday() },
      status: { in: ACTIVE_STATUSES },
    },
    orderBy: { createdAt: "asc" },
    select: QUEUE_SELECT,
    take: 500,
  });
}

app.post(
  "/user",
  async (request: Request, response: Response): Promise<Response> => {
    try {
      const { name, sector, isPreferencial, celphone } = request.body;
      const today = startOfToday();

      // Dedupe only within the current day: same name+sector already
      // registered today returns the existing senha. A client coming back
      // on another day gets a fresh senha.
      const lastUser = await prisma.user.findFirst({
        where: {
          name,
          sector,
          senhaDate: {
            gte: today,
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (lastUser) {
        // Return the existing user's senha
        return response.status(200).json({
          ...lastUser,
          message: "User already exists, returning existing senha",
        });
      }

      // Count users created today to derive the daily senha number
      const usersCountToday = await prisma.user.count({
        where: {
          senhaDate: {
            gte: today,
          },
        },
      });

      // Password number starts from 1 each day and wraps at 1000
      const senhaNumero = (usersCountToday % 1000) + 1;
      const senha = senhaNumero.toString().padStart(3, "0");

      const newUser = await prisma.user.create({
        data: {
          name,
          sector,
          senha,
          isPreferencial: isPreferencial || false,
          celphone: celphone ? String(celphone) : null,
          senhaDate: new Date(), // Store the current date/time
        },
      });

      io.emit("usersUpdated", await getQueueUsers());

      return response.status(201).json(newUser);
    } catch (error) {
      console.error("Error creating user:", error);
      return response.status(500).json({ error: "Failed to create user" });
    }
  }
);

app.get(
  "/user",
  async (request: Request, response: Response): Promise<Response> => {
    try {
      const users = await getQueueUsers();

      return response.status(200).json(users);
    } catch (error) {
      console.error("Error fetching users:", error);
      return response.status(500).json({ error: "Failed to fetch users" });
    }
  }
);

app.post(
  "/user/:id",
  async (request: Request, response: Response): Promise<Response> => {
    try {
      const { status } = request.body;
      const id = request.params.id;

      const validStatuses: UserStatus[] = ["queue", "ready", "onGoing", "done", "canceled"];

      if (!validStatuses.includes(status)) {
        return response.status(400).json({ error: "Invalid status" });
      }

      await prisma.user.update({
        where: {
          id: id,
        },
        data: {
          status: status,
        },
      });

      // Fetch the fresh list once, broadcast it and return it to the caller.
      const users = await getQueueUsers();
      io.emit("usersUpdated", users);

      return response.status(200).json(users);
    } catch (error) {
      console.error("Error updating user:", error);
      return response.status(500).json({ error: "Failed to update user" });
    }
  }
);

io.on("connection", (client) => {
  console.log("Cliente conectado");

  client.on("disconnect", () => {
    console.log("Cliente desconectado");
  });
});

async function main() {
  try {
    await prisma.$connect();
    // WAL lets reads run concurrently with writes on SQLite.
    // PRAGMA returns a row, so use queryRaw (executeRaw rejects results on SQLite).
    await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
    console.log("Database connected successfully");

    httpServer.listen(PORT, () => {
      console.log(`Server started at ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to connect to database:", error);
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
