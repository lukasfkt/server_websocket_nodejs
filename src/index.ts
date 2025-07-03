import express, { Request, Response } from "express";
import cors from "cors";
import { Server } from "socket.io";
import http from "http";
import { PrismaClient } from "@prisma/client";

const PORT = 8899;
const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.APP_WEB_URL, methods: ["GET", "POST"] },
});

const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

type UserStatus = "queue" | "ready" | "onGoing" | "done" | "canceled";

app.post(
  "/user",
  async (request: Request, response: Response): Promise<Response> => {
    try {
      const { name, sector, isPreferencial, celphone, email } = request.body;

      // Get today's date at midnight (São Paulo timezone)
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Count users created today
      const usersCountToday = await prisma.user.count({
        where: {
          senhaDate: {
            gte: today,
          },
        },
      });

      // Password number starts from 1 each day
      let senhaNumero = usersCountToday + 1;
      const fator = Math.floor(senhaNumero / 1000);

      if (senhaNumero >= 1000) {
        senhaNumero = senhaNumero - 1000 * fator + 1;
      }

      const senha = senhaNumero.toString().padStart(3, "0");

      const newUser = await prisma.user.create({
        data: {
          name,
          sector,
          senha,
          isPreferencial: isPreferencial || false,
          celphone: celphone ? String(celphone) : null,
          email: email || null,
          senhaDate: new Date(), // Store the current date/time
        },
      });

      io.emit("newUser");

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
      const users = await prisma.user.findMany({
        orderBy: {
          createdAt: "asc",
        },
      });

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

      io.emit("newUser");

      const users = await prisma.user.findMany({
        orderBy: {
          createdAt: "asc",
        },
      });

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