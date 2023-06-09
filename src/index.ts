import express, { Request, Response, NextFunction } from "express";
import cors from "cors";

import { Server } from "socket.io";
import http from "http";
import { JsonDB, Config } from "node-json-db";
const { v4: uuidv4 } = require("uuid");

const PORT = 8899;
const app = express();
// app.use(express.static(__dirname + '/../client'))
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.APP_WEB_URL, methods: ["GET", "POST"] },
});

app.use(cors());

type User = {
  id: string;
  name: string;
  status: "queue" | "ready" | "onGoing" | "done";
  senha: string;
};

var db = new JsonDB(new Config("jsonDB", true, false, "/"));

app.use(express.json());

app.post(
  "/user",
  async (request: Request, response: Response): Promise<Response> => {
    const { name } = request.body;

    let userData = [];

    try {
      userData = await db.getData("/users");
    } catch (error) {}

    const newUser: User = {
      id: uuidv4(),
      name,
      status: "queue",
      senha: userData.length.toString().padStart(4, "0"),
    };

    await db.push("/users[]", newUser);

    io.emit("newUser");

    return response.status(201).json(newUser);
  }
);

app.get(
  "/user",
  async (request: Request, response: Response): Promise<Response> => {
    let userData = [];

    try {
      userData = await db.getData("/users");
    } catch (error) {}

    return response.status(201).json(userData);
  }
);

app.post(
  "/user/:id",
  async (request: Request, response: Response): Promise<Response> => {
    const { status } = request.body;

    const id = request.params.id;

    try {
      const userData = await db.getIndex("/users", id);

      await db.push(`/users[${userData}]`, { status }, false);

      io.emit("newUser");

      const data = await db.getData("/users");

      return response.status(201).json(data);
    } catch (error) {}

    return response.status(201).json();
  }
);

io.on("connection", (client) => {
  console.log("Cliente conectado");

  client.on("disconnect", () => {
    console.log("Cliente desconectado");
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server started at ${PORT}`);
});
