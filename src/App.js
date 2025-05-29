import React, { useState, useEffect } from "react";
import RegistrationForm from "./RegistrationForm";
import ChatApp from "./ChatApp";
import voiceService from "./services/voiceService";

function App() {
  // Состояние пользователя, списка пользователей и комнаты
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [room, setRoom] = useState(null);
  const [isConnected, setIsConnected] = useState(false); // Добавляем состояние подключения

  // Обработчик создания комнаты
  async function handleCreateRoom(name, ip) {
    const user = {
      name,
      avatar: null, // TODO: добавить логику загрузки аватара
    };
    setCurrentUser(user);
    setRoom({ type: "create", ip });

    // Попытка подключения к серверу
    try {
      const connected = await voiceService.connect(name, ip); // Передаем IP
      if (connected) {
        setIsConnected(true); // Устанавливаем состояние подключения
      } else {
        // Обработка ошибки подключения
        console.error("Не удалось подключиться к серверу");
        setCurrentUser(null); // Сброс пользователя при ошибке подключения
        setRoom(null);
      }
    } catch (error) {
      console.error("Ошибка при подключении к серверу:", error);
      setCurrentUser(null); // Сброс пользователя при ошибке подключения
      setRoom(null);
    }
  }

  // Обработчик входа в существующую комнату
  async function handleJoinRoom(name, ip) {
    const user = {
      name,
      avatar: null,
    };
    setCurrentUser(user);
    setRoom({ type: "join", ip });

    // Попытка подключения к серверу
    try {
      const connected = await voiceService.connect(name, ip); // Передаем IP
      if (connected) {
        setIsConnected(true); // Устанавливаем состояние подключения
      } else {
        // Обработка ошибки подключения
        console.error("Не удалось подключиться к серверу");
        setCurrentUser(null); // Сброс пользователя при ошибке подключения
        setRoom(null);
      }
    } catch (error) {
      console.error("Ошибка при подключении к серверу:", error);
      setCurrentUser(null); // Сброс пользователя при ошибке подключения
      setRoom(null);
    }
  }

  // TODO: добавить обработчик получения списка пользователей от сервера
  useEffect(() => {
    if (isConnected && currentUser) {
      // Здесь можно добавить логику получения списка пользователей после подключения
      // voiceService.onUserListUpdate(setUsers);
    }
  }, [isConnected, currentUser]);

  // Обработчик выхода
  function handleLogout() {
    voiceService.disconnect(); // Отключаемся от сервера
    setCurrentUser(null);
    setRoom(null);
    setUsers([]);
    setIsConnected(false); // Сбрасываем состояние подключения
  }

  // Если пользователь не авторизован или не подключен, показываем форму регистрации
  if (!currentUser || !isConnected) {
    return (
      <RegistrationForm
        onCreateRoom={handleCreateRoom}
        onJoinRoom={handleJoinRoom}
      />
    );
  }

  // Если пользователь авторизован и подключен, показываем чат
  return (
    <ChatApp
      currentUser={currentUser}
      users={users} // TODO: передавать актуальный список пользователей
      room={room}
      onLogout={handleLogout}
    />
  );
}

export default App;
