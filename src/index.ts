import express, { type Request, type Response } from "express";
import cors, { type CorsOptions } from "cors";
import compression from "compression";
import { Server } from "socket.io";
import http from "http";
import { PrismaClient, type Prisma } from "@prisma/client";

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

type UserStatus = "queue" | "ready" | "waiting" | "onGoing" | "done" | "canceled";

// Window used to collapse an accidental double-submit (same person's form sent
// twice, e.g. a double click or a client retry) into a single senha. It must
// stay short: two genuinely different people with the same name+sector must
// each get their own senha.
const DEDUPE_WINDOW_MS = 30 * 1000;

// Statuses shown by the live screens (Painel/Admin). Anything else
// (done/canceled) is dropped from the payload so the list stays small.
const ACTIVE_STATUSES: UserStatus[] = ["queue", "ready", "waiting", "onGoing"];

// Only the columns the UI actually renders.
const QUEUE_SELECT = {
  id: true,
  name: true,
  senha: true,
  sector: true,
  status: true,
  isPreferencial: true,
  celphone: true,
  seat: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

// The "waiting" (Na cadeira) grid has 16 fixed seats, numbered 0-15.
// The chairs are physical massage chairs, so only this sector may use them.
const SEAT_COUNT = 16;
const SEAT_SECTOR = "Massagem";

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

      // Dedupe only an accidental double-submit: same name+sector registered in
      // the last few seconds returns the existing senha. This guards against a
      // duplicate request for the SAME person (double click / retry) — two
      // different people sharing a name still each get their own senha.
      const lastUser = await prisma.user.findFirst({
        where: {
          name,
          sector,
          senhaDate: {
            gte: new Date(Date.now() - DEDUPE_WINDOW_MS),
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

// Statuses that leave the live board and land in the history tab.
const HISTORY_STATUSES: UserStatus[] = ["done", "canceled"];
const HISTORY_PAGE_SIZE = 20;

// Paginated list of finished/canceled entries for the Admin history tab.
// Newest first, optional case-insensitive search over name and senha.
app.get(
  "/user/history",
  async (request: Request, response: Response): Promise<Response> => {
    try {
      const page = Math.max(1, Number(request.query.page) || 1);
      const search = String(request.query.search ?? "").trim();

      // Scoped to today, like the rest of the app (senhas reset each day),
      // so yesterday's finished/canceled entries don't leak into the list.
      const where: Prisma.UserWhereInput = {
        status: { in: HISTORY_STATUSES },
        senhaDate: { gte: startOfToday() },
      };
      if (search) {
        where.OR = [
          { name: { contains: search } },
          { senha: { contains: search } },
        ];
      }

      const [items, total] = await Promise.all([
        prisma.user.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          select: QUEUE_SELECT,
          skip: (page - 1) * HISTORY_PAGE_SIZE,
          take: HISTORY_PAGE_SIZE,
        }),
        prisma.user.count({ where }),
      ]);

      return response.status(200).json({
        items,
        total,
        page,
        pageSize: HISTORY_PAGE_SIZE,
      });
    } catch (error) {
      console.error("Error fetching history:", error);
      return response.status(500).json({ error: "Failed to fetch history" });
    }
  }
);

app.post(
  "/user/:id",
  async (request: Request, response: Response): Promise<Response> => {
    try {
      const { status, seat } = request.body;
      const id = request.params.id;

      const validStatuses: UserStatus[] = ["queue", "ready", "waiting", "onGoing", "done", "canceled"];

      if (!validStatuses.includes(status)) {
        return response.status(400).json({ error: "Invalid status" });
      }

      // A seat only makes sense while "waiting"; any other status clears it so
      // the chair frees up. When waiting, the seat must be a valid 0-15 slot.
      let seatValue: number | null = null;
      if (status === "waiting") {
        const parsedSeat = Number(seat);
        if (!Number.isInteger(parsedSeat) || parsedSeat < 0 || parsedSeat >= SEAT_COUNT) {
          return response.status(400).json({ error: "Invalid seat" });
        }
        // The chairs belong to the massage area only.
        const existing = await prisma.user.findUnique({
          where: { id },
          select: { sector: true },
        });
        if (!existing) {
          return response.status(404).json({ error: "User not found" });
        }
        if (existing.sector !== SEAT_SECTOR) {
          return response
            .status(400)
            .json({ error: "Seats are available for Massagem only" });
        }
        seatValue = parsedSeat;
      }

      await prisma.user.update({
        where: {
          id: id,
        },
        data: {
          status: status,
          seat: seatValue,
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
