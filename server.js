socket.on('join_game', async ({roomId, nickname, userId}) => {
        const session = sessions[roomId];
        
        // 1. Проверяем, существует ли комната
        if (!session) return socket.emit('error_msg', 'Room not found');
        
        session.lastActive = Date.now();

        // 2. Если место 2-го игрока (Red) СВОБОДНО -> сажаем туда
        if (!session.redPlayer) {
            session.redPlayer = socket.id; 
            session.redUserId = userId; 
            session.redName = nickname || 'Player 2';
            
            await saveSession(roomId); // ОБЯЗАТЕЛЬНО сохраняем в БД перед входом
            
            socket.join(roomId); 
            // Отправляем роль red
            socket.emit('init_game', { 
                roomId, 
                role: 'red', 
                state: getPublicState(session), 
                chars: CHARACTERS_BY_ELEMENT 
            });
            
            // Обновляем состояние для первого игрока
            io.to(roomId).emit('update_state', getPublicState(session));
        } 
        // 3. Если занято -> кидаем в зрители (автоматически)
        else {
            if (!session.spectators.includes(socket.id)) {
                session.spectators.push(socket.id); 
                await saveSession(roomId); // Сохраняем зрителя
            }
            
            socket.join(roomId);
            socket.emit('init_game', { 
                roomId, 
                role: 'spectator', 
                state: getPublicState(session), 
                chars: CHARACTERS_BY_ELEMENT 
            });
        }
    });
