import http from "http"
import app from "./app.js"
import { Server } from "socket.io"
import registerMeetingEvents from "./sockets/meeting.socket.js"

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "https://syncspace-live.vercel.app"],
    credentials: true,
    methods: ["GET", "POST"],
  }
});

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
}).on("error", (error) => {
  console.error("Error occur: ", error)
});

io.on("connection", (socket) => {
  console.log("socket connected", socket.id);
  registerMeetingEvents(io, socket);
});

export { server, io };
