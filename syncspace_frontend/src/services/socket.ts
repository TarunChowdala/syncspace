import { io, Socket } from 'socket.io-client';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

let socket: Socket | null = null;
let joinedRoom: string | null = null;

export function getSocket() {
  if (!socket) {
    socket = io(BACKEND_URL, {
      withCredentials: true,
      transports: ['websocket'],
    });
  }
  return socket;
}

export function joinRoom(roomId: string, userName: string) {
  const socket = getSocket();

  if (joinedRoom === roomId && socket.connected) {
    return socket;
  }

  socket.emit('join-room', { roomId, userName });
  joinedRoom = roomId;
  return socket;
}

export function leaveRoom() {
  if (socket) {
    socket.disconnect();
    socket = null;
    joinedRoom = null;
  }
}

export function getJoinedRoom() {
  return joinedRoom;
}
