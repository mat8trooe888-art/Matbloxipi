const WebSocket = require('ws');

const server = new WebSocket.Server({ port: process.env.PORT || 8080 });

let rooms = new Map();

server.on('connection', (ws) => {
    const playerId = Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    let currentRoomId = null;
    
    console.log(`✅ Игрок ${playerId} подключился`);

    ws.on('message', (rawMessage) => {
        try {
            const data = JSON.parse(rawMessage);
            
            switch (data.type) {
                case 'get_rooms':
                    const roomsList = Array.from(rooms.entries()).map(([id, room]) => ({
                        id: id,
                        name: room.name,
                        author: room.author,
                        players: room.players.size
                    }));
                    ws.send(JSON.stringify({ type: 'rooms_list', rooms: roomsList }));
                    break;
                
                case 'create_room':
                    const roomId = Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
                    currentRoomId = roomId;
                    
                    rooms.set(roomId, {
                        name: data.roomName,
                        author: data.author,
                        gameData: data.gameData,
                        players: new Map([[playerId, ws]])
                    });
                    
                    ws.send(JSON.stringify({
                        type: 'room_created',
                        roomId: roomId,
                        roomName: data.roomName
                    }));
                    
                    ws.send(JSON.stringify({
                        type: 'joined_room',
                        playerId: playerId,
                        roomId: roomId,
                        gameData: data.gameData,
                        players: [{ id: playerId, position: { x: 0, y: 1.5, z: 0 } }]
                    }));
                    
                    console.log(`🎮 Комната "${data.roomName}" создана (${roomId})`);
                    break;
                
                case 'join_room':
                    const room = rooms.get(data.roomId);
                    if (!room) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Комната не найдена' }));
                        return;
                    }
                    
                    currentRoomId = data.roomId;
                    room.players.set(playerId, ws);
                    
                    const existingPlayers = Array.from(room.players.entries()).map(([pid, pws]) => ({
                        id: pid,
                        position: { x: 0, y: 1.5, z: 0 }
                    }));
                    
                    ws.send(JSON.stringify({
                        type: 'joined_room',
                        playerId: playerId,
                        roomId: data.roomId,
                        gameData: room.gameData,
                        players: existingPlayers
                    }));
                    
                    room.players.forEach((playerWs, pid) => {
                        if (pid !== playerId) {
                            playerWs.send(JSON.stringify({
                                type: 'player_joined',
                                playerId: playerId,
                                position: { x: 0, y: 1.5, z: 0 }
                            }));
                        }
                    });
                    
                    console.log(`👋 Игрок ${playerId} вошёл в комнату ${data.roomId} (${room.players.size} игроков)`);
                    break;
                
                case 'update_position':
                    if (currentRoomId) {
                        const currentRoom = rooms.get(currentRoomId);
                        if (currentRoom) {
                            currentRoom.players.forEach((playerWs, pid) => {
                                if (pid !== playerId && playerWs.readyState === WebSocket.OPEN) {
                                    playerWs.send(JSON.stringify({
                                        type: 'player_moved',
                                        playerId: playerId,
                                        position: data.position
                                    }));
                                }
                            });
                        }
                    }
                    break;
                
                case 'leave_room':
                    if (currentRoomId) {
                        const currentRoom = rooms.get(currentRoomId);
                        if (currentRoom) {
                            currentRoom.players.delete(playerId);
                            currentRoom.players.forEach((playerWs) => {
                                playerWs.send(JSON.stringify({ type: 'player_left', playerId: playerId }));
                            });
                            if (currentRoom.players.size === 0) {
                                rooms.delete(currentRoomId);
                                console.log(`🗑️ Комната ${currentRoomId} удалена`);
                            }
                        }
                        currentRoomId = null;
                    }
                    break;
            }
        } catch (err) { console.error('Ошибка:', err); }
    });
    
    ws.on('close', () => {
        console.log(`❌ Игрок ${playerId} отключился`);
        if (currentRoomId) {
            const room = rooms.get(currentRoomId);
            if (room) {
                room.players.delete(playerId);
                room.players.forEach((playerWs) => {
                    playerWs.send(JSON.stringify({ type: 'player_left', playerId: playerId }));
                });
                if (room.players.size === 0) rooms.delete(currentRoomId);
            }
        }
    });
});

console.log(`🚀 Сигнальный сервер на порту ${process.env.PORT || 8080}`);
