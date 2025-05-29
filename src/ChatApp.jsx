import React, { useState, useEffect } from "react";
import "./ChatApp.css";
import voiceService from "./services/voiceService";

function Sidebar({ users }) {
  return (
    <div className="sidebar">
      <div className="sidebar-logo">
        <span role="img" aria-label="chat">
          💬
        </span>
      </div>
      <div className="sidebar-title">AirChat</div>
      <div className="sidebar-users">
        {users.map((user, idx) =>
          user.avatar ? (
            <img
              key={idx}
              src={user.avatar}
              alt={user.name}
              className="sidebar-avatar"
            />
          ) : (
            <div key={idx} className="sidebar-avatar sidebar-avatar-initial">
              {user.name?.[0]?.toUpperCase() || "?"}
            </div>
          )
        )}
      </div>
    </div>
  );
}

function LogoutModal({ isOpen, onConfirm, onCancel }) {
  if (!isOpen) return null;
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-text">Вы действительно хотите выйти из чата?</div>
        <div className="modal-actions">
          <button className="modal-btn modal-btn-yes" onClick={onConfirm}>
            Выйти
          </button>
          <button className="modal-btn modal-btn-no" onClick={onCancel}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatHeader({ onCall, onLogout, isCallActive }) {
  return (
    <div className="chat-header">
      <div>
        <div className="chat-room-title">Комната Сервера</div>
        <div className="chat-participants">Участников: 1</div>
      </div>
      <div className="chat-header-spacer"></div>
      <button
        className={`chat-call-btn ${isCallActive ? "active" : ""}`}
        title={isCallActive ? "Завершить звонок" : "Начать звонок"}
        onClick={onCall}
      >
        <svg width="24" height="24" viewBox="0 0 24 24">
          <path
            fill="#000"
            d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 .95-.27c1.04.28 2.16.43 3.31.43a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.06 21 3 13.94 3 5a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.15.15 2.27.43 3.31a1 1 0 0 1-.27.95l-2.2 2.2z"
          />
        </svg>
      </button>
      <button className="chat-logout-btn" title="Выйти" onClick={onLogout}>
        <svg height="28" width="28" viewBox="0 0 512 512">
          <path d="M320 400c0 13.3-10.7 24-24 24H112c-13.3 0-24-10.7-24-24V112c0-13.3 10.7-24 24-24h184c13.3 0 24 10.7 24 24v72c0 13.3-10.7 24-24 24s-10.7-10.7-24-24V128H128v256h168v-56c0-13.3 10.7-24 24-24s24 10.7 24 24v72z" />
          <path d="M502.6 273.4l-96 96c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l54.1-54.1H208c-13.3 0-24-10.7-24-24s10.7-24 24-24h218.7l-54.1-54.1c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l96 96c9.4 9.4 9.4 24.6 0 34z" />
        </svg>
      </button>
    </div>
  );
}

function MessageList({ messages }) {
  console.log("MessageList получил сообщения:", messages);
  return (
    <div className="chat-messages">
      {messages.map((message, index) => {
        console.log("Отрисовка сообщения:", message);
        return (
          <div
            key={index}
            className={`message ${message.isOwn ? "message-own" : ""}`}
          >
            <div className="message-content">{message.text}</div>
            <div className="message-time">{message.time}</div>
          </div>
        );
      })}
    </div>
  );
}

function MessageInput({ onSendMessage }) {
  const [message, setMessage] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (message.trim()) {
      onSendMessage(message);
      setMessage("");
    }
  };

  return (
    <form className="chat-input-wrapper" onSubmit={handleSubmit}>
      <input
        type="text"
        className="chat-input"
        placeholder="Сообщение"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <button type="submit" className="chat-send-btn">
        <svg width="20" height="20" viewBox="0 0 24 24">
          <path fill="#000" d="M2 21l21-9L2 3v7l15 2-15 2z" />
        </svg>
      </button>
    </form>
  );
}

export default function ChatApp({ users, currentUser, room }) {
  const [callActive, setCallActive] = useState(false);
  const [showLogout, setShowLogout] = useState(false);
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    // Подключаемся к серверу при монтировании компонента
    voiceService.connect(currentUser);

    // Устанавливаем обработчики сообщений
    voiceService.setMessageCallback((data) => {
      if (data.type === "message") {
        setMessages((prev) => [
          ...prev,
          {
            text: data.text,
            time: new Date().toLocaleTimeString(),
            isOwn: data.username === currentUser,
          },
        ]);
      }
    });

    // Очистка при размонтировании
    return () => {
      voiceService.disconnect();
    };
  }, [currentUser]);

  function handleCall() {
    setCallActive(!callActive);
    if (!callActive) {
      // Начинаем звонок
      voiceService.setVoiceCallback((audioData) => {
        // Здесь будет отправка аудио данных на сервер
        console.log("Отправка аудио данных...");
      });
    } else {
      // Завершаем звонок
      voiceService.setVoiceCallback(null);
    }
  }

  function handleLogoutClick() {
    setShowLogout(true);
  }

  function handleLogoutConfirm() {
    setShowLogout(false);
    voiceService.disconnect();
    window.location.reload();
  }

  function handleLogoutCancel() {
    setShowLogout(false);
  }

  function handleSendMessage(text) {
    console.log("Отправка сообщения:", text);
    console.log("Текущие сообщения:", messages);

    // Добавляем сообщение в локальное состояние
    const newMessage = {
      text: text,
      time: new Date().toLocaleTimeString(),
      isOwn: true,
    };
    console.log("Новое сообщение:", newMessage);

    setMessages((prev) => {
      const updated = [...prev, newMessage];
      console.log("Обновленный список сообщений:", updated);
      return updated;
    });

    // Отправляем сообщение на сервер
    voiceService.sendMessage(text);
  }

  return (
    <div className="chat-app">
      <Sidebar users={users} />
      <div className="chat-main">
        <ChatHeader
          onCall={handleCall}
          onLogout={handleLogoutClick}
          isCallActive={callActive}
        />
        <MessageList messages={messages} />
        <MessageInput onSendMessage={handleSendMessage} />
        <LogoutModal
          isOpen={showLogout}
          onConfirm={handleLogoutConfirm}
          onCancel={handleLogoutCancel}
        />
      </div>
    </div>
  );
}
