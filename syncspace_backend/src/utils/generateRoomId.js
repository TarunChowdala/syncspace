const rooms = {};

export const addUserToRoom = (roomId, user) => {
  if (!rooms[roomId]) {
    rooms[roomId] = [];
  }

  rooms[roomId] = rooms[roomId].filter(
    (existing) => existing.socketId !== user.socketId
  );
  rooms[roomId].push(user);
};

export const getRoomUsers = (roomId) => {
  return rooms[roomId] || [];
};

export const removeUser = (socketId) => {
  for (const roomId in rooms) {
    rooms[roomId] = rooms[roomId].filter(
      (user) => user.socketId !== socketId
    );

    if (rooms[roomId].length === 0) {
      delete rooms[roomId];
    }
  }
};

export const getRooms = () => rooms;