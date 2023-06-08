import express from 'express';
import { Server } from 'socket.io';
import http from 'http';

const PORT = 8899;
const app = express();
app.use(express.static(__dirname + '/../client'))
const httpServer = http.createServer(app);
const io = new Server(httpServer);

const clients: Array<any> = [];
const senhas: Array<string> = [];

io.on('connection', (client) => {
  console.log("Cliente conectado")
  clients.push(client);

  client.on("senhas", function (socket) {
    for (const client of clients) {
      client.emit('msg', senhas)
    }
  });

  client.on("add", function (socket) {
    senhas.push(socket.senha);
  });

  client.on("remove", function (socket) {
    senhas.splice(senhas.indexOf(socket.senha), 1);
  });

  client.on('disconnect', () => {
    console.log("Cliente desconectado")
    clients.splice(clients.indexOf(client), 1);
  })
})

httpServer.listen(PORT, () => {
  console.log(`Server started at ${PORT}`);
})