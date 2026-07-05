import { addUserToRoom, getRoomUsers, removeUser } from "../utils/generateRoomId.js";


export default function registerMeetingEvents(io, socket) {

  socket.on("join-room", ({ roomId, userName }) => {

    const user = {
      socketId: socket.id,
      userName
    };
    addUserToRoom(roomId, user);
    socket.join(roomId);

    // Persist on socket.data so disconnect handler can use it
    socket.data.user = user;
    socket.data.roomId = roomId;

    console.log(`${userName} joined ${roomId}`);

    // Send existing participants to newly joined user
    const participants = getRoomUsers(roomId);
    socket.emit("existing-participants", participants);

    // Notify others in room
    socket.to(roomId).emit("user-joined", user);
  });

  socket.on("disconnect", () => {
    const user = socket.data.user;
    const roomId = socket.data.roomId;
    removeUser(socket.id);

    if (roomId) {
      socket.to(roomId).emit("user-left", user || {
        socketId: socket.id,
        userName: "Guest",
      });
      console.log(`${user?.userName || 'Guest'} disconnected from ${roomId}`);
    }
  });

  socket.on("offer", ({ to, offer }) => {
    console.log("offer received, relaying to", to);
    io.to(to).emit("offer", { from: socket.id, offer });
  });

  socket.on("answer", ({ to, answer }) => {
    console.log("answer received, relaying to", to);
    io.to(to).emit("answer", { from: socket.id, answer });
  });

  socket.on("ice-candidate", ({ to, candidate }) => {
    console.log("ice-candidate received, relaying to", to);
    io.to(to).emit("ice-candidate", { from: socket.id, candidate });
  });

  socket.on("video-state", ({ to, enabled }) => {
    console.log("video-state received, relaying to", to, "enabled=", enabled);
    io.to(to).emit("video-state", { from: socket.id, enabled });
  });

}