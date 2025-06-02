const { ipcRenderer } = require("electron");

// DOM элементы
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const messageList = document.getElementById("messageList");
const sidebarUsers = document.getElementById("sidebarUsers");

// Состояние приложения
let users = [];
let currentUsername = "";
let currentUserAvatar = null;
let selectedAvatarFile = null;

// Состояние голосового чата
let isInVoiceChat = false;

// Тема
let currentTheme = localStorage.getItem("airchat-theme") || "light";

// Функции для работы с темой
function initializeTheme() {
  const body = document.body;
  const themeButton = document.getElementById("themeButton");

  if (currentTheme === "dark") {
    body.className = "theme-dark";
    if (themeButton) {
      themeButton.textContent = "🌙 Тёмная";
    }
  } else {
    body.className = "theme-light";
    if (themeButton) {
      themeButton.textContent = "🌞 Светлая";
    }
  }
}

function toggleTheme() {
  const body = document.body;
  const themeButton = document.getElementById("themeButton");

  if (currentTheme === "light") {
    currentTheme = "dark";
    body.className = "theme-dark";
    if (themeButton) {
      themeButton.textContent = "🌙 Тёмная";
    }
  } else {
    currentTheme = "light";
    body.className = "theme-light";
    if (themeButton) {
      themeButton.textContent = "🌞 Светлая";
    }
  }

  localStorage.setItem("airchat-theme", currentTheme);
}

// Функции для работы с аватарками
function updateAvatarButton() {
  const avatarButton = document.getElementById("avatarButton");
  if (!avatarButton) return;

  if (currentUserAvatar) {
    avatarButton.innerHTML = `
      <img src="${currentUserAvatar}" alt="Аватарка" class="avatar-btn-img" />
      <span class="avatar-btn-overlay">
        <svg width="18" height="18" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3.2" fill="currentColor" />
          <path d="M4 7h2.1l.83-1.5C7.34 5.21 7.61 5 7.91 5h8.18c.3 0 .57.21.67.5L17.9 7H20c1.1 0 2 .9 2 2v9c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V9c0-1.1.9-2 2-2zm8 10a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" fill="currentColor" />
        </svg>
      </span>
    `;
  } else {
    avatarButton.innerHTML = `
      <span class="avatar-btn-initial">👤</span>
      <span class="avatar-btn-overlay">
        <svg width="18" height="18" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3.2" fill="currentColor" />
          <path d="M4 7h2.1l.83-1.5C7.34 5.21 7.61 5 7.91 5h8.18c.3 0 .57.21.67.5L17.9 7H20c1.1 0 2 .9 2 2v9c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V9c0-1.1.9-2 2-2zm8 10a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" fill="currentColor" />
        </svg>
      </span>
    `;
  }
}

function showAvatarModal() {
  const modal = document.getElementById("avatarModal");
  const preview = document.getElementById("avatarPreview");
  const saveButton = document.getElementById("avatarSaveButton");

  if (modal) {
    modal.style.display = "flex";

    // Показываем текущую аватарку или заглушку
    if (currentUserAvatar) {
      preview.src = currentUserAvatar;
    } else {
      preview.src =
        "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iOTYiIGhlaWdodD0iOTYiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTIiIGN5PSI4IiByPSIzIiBmaWxsPSIjOTk5Ii8+CjxwYXRoIGQ9Im0xNS41IDE0LjUtMy0yLTMgMiIgc3Ryb2tlPSIjOTk5IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPgo8L3N2Zz4K";
    }

    // Сбрасываем состояние
    selectedAvatarFile = null;
    if (saveButton) {
      saveButton.disabled = true;
    }
  }
}

function hideAvatarModal() {
  const modal = document.getElementById("avatarModal");
  if (modal) {
    modal.style.display = "none";
  }
  selectedAvatarFile = null;
}

function handleAvatarFileChange(e) {
  const file = e.target.files[0];
  const preview = document.getElementById("avatarPreview");
  const saveButton = document.getElementById("avatarSaveButton");

  if (file && file.type.startsWith("image/")) {
    const reader = new FileReader();
    reader.onload = function (e) {
      selectedAvatarFile = e.target.result;
      if (preview) {
        preview.src = selectedAvatarFile;
      }
      if (saveButton) {
        saveButton.disabled = false;
      }
    };
    reader.readAsDataURL(file);
  }
}

function saveAvatar() {
  if (selectedAvatarFile) {
    currentUserAvatar = selectedAvatarFile;
    updateAvatarButton();

    // Обновляем аватарку в списке пользователей
    const user = users.find((u) => u.name === currentUsername);
    if (user) {
      user.avatar = currentUserAvatar;
      updateUsersList();
    }

    // Сохраняем в localStorage
    localStorage.setItem(
      `airchat-avatar-${currentUsername}`,
      currentUserAvatar
    );

    hideAvatarModal();
    console.log("[DEBUG] Avatar saved for user:", currentUsername);
  }
}

function deleteAvatar() {
  currentUserAvatar = null;
  updateAvatarButton();

  // Обновляем аватарку в списке пользователей
  const user = users.find((u) => u.name === currentUsername);
  if (user) {
    user.avatar = null;
    updateUsersList();
  }

  // Удаляем из localStorage
  localStorage.removeItem(`airchat-avatar-${currentUsername}`);

  hideAvatarModal();
  console.log("[DEBUG] Avatar deleted for user:", currentUsername);
}

// Функции для работы с UI
function addMessage(text, isOwn = false, isImage = false) {
  console.log("[DEBUG] addMessage:", JSON.stringify(text), "isImage:", isImage);
  const messageDiv = document.createElement("div");
  messageDiv.className = `chat-message ${
    isOwn ? "chat-message-right" : "chat-message-left"
  }`;

  if (isImage) {
    const img = document.createElement("img");
    img.src = text;
    img.alt = "Изображение";
    img.className = "chat-message-image";
    img.onclick = () => openImageModal(text);
    messageDiv.appendChild(img);
  } else {
    messageDiv.textContent = text;
  }

  messageList.appendChild(messageDiv);
  messageList.scrollTop = messageList.scrollHeight;
}

function updateUsersList() {
  sidebarUsers.innerHTML = "";
  users.forEach((user) => {
    const avatarContainer = document.createElement("div");
    avatarContainer.style.position = "relative";

    if (user.avatar) {
      const avatarImg = document.createElement("img");
      avatarImg.src = user.avatar;
      avatarImg.alt = user.name;
      avatarImg.className = "sidebar-avatar";
      avatarContainer.appendChild(avatarImg);
    } else {
      const avatarDiv = document.createElement("div");
      avatarDiv.className = "sidebar-avatar sidebar-avatar-initial";
      avatarDiv.textContent = user.name[0].toUpperCase();
      avatarContainer.appendChild(avatarDiv);
    }

    // Добавляем индикатор голосового чата
    if (user.inVoice) {
      const voiceIndicator = document.createElement("div");
      voiceIndicator.className = "voice-indicator";
      voiceIndicator.innerHTML = "🎤";
      avatarContainer.appendChild(voiceIndicator);
    }

    sidebarUsers.appendChild(avatarContainer);
  });
}

// Функция для обновления счетчика участников
function updateParticipantsCount() {
  const participantsElement = document.querySelector(".chat-participants");
  if (participantsElement) {
    participantsElement.textContent = `Участников: ${users.length}`;
  }
}

// Функция для добавления/удаления пользователей на основе сообщений
function handleUserMessage(message) {
  console.log(`[DEBUG] handleUserMessage called with: "${message}"`);
  console.log(`[DEBUG] Current users count: ${users.length}`);
  console.log(
    `[DEBUG] Current users:`,
    users.map((u) => u.name)
  );

  if (message.includes(" joined the chat")) {
    const username = message.split(" joined the chat")[0];
    console.log(`[DEBUG] Processing join for user: "${username}"`);

    // Проверяем, что пользователь не существует уже
    if (!users.find((user) => user.name === username)) {
      // Загружаем аватарку из localStorage если есть
      const savedAvatar = localStorage.getItem(`airchat-avatar-${username}`);
      const newUser = {
        name: username,
        avatar: savedAvatar,
        inVoice: false,
      };
      users.push(newUser);
      updateUsersList();
      updateParticipantsCount();
      console.log(
        `[DEBUG] Добавлен пользователь: ${username}, всего пользователей: ${users.length}`
      );
      console.log(
        `[DEBUG] Users after add:`,
        users.map((u) => u.name)
      );
    } else {
      console.log(`[DEBUG] Пользователь ${username} уже существует в списке`);
    }
  } else if (message.includes(" подключился к голосовому чату")) {
    const username = message.split(" подключился к голосовому чату")[0];
    console.log(`[DEBUG] Processing voice connect for user: "${username}"`);
    const user = users.find((user) => user.name === username);
    if (user) {
      user.inVoice = true;
      updateUsersList();
      console.log(
        `[DEBUG] Пользователь ${username} подключился к голосовому чату`
      );
    } else {
      console.log(
        `[DEBUG] Пользователь ${username} не найден для подключения к голосовому чату`
      );
    }
  } else if (message.includes(" отключился от голосового чата")) {
    const username = message.split(" отключился от голосового чата")[0];
    console.log(`[DEBUG] Processing voice disconnect for user: "${username}"`);
    const user = users.find((user) => user.name === username);
    if (user) {
      user.inVoice = false;
      updateUsersList();
      console.log(
        `[DEBUG] Пользователь ${username} отключился от голосового чата`
      );
    } else {
      console.log(
        `[DEBUG] Пользователь ${username} не найден для отключения от голосового чата`
      );
    }
  } else {
    console.log(
      `[DEBUG] Message doesn't match any user patterns: "${message}"`
    );
  }
  // Можно добавить обработку выхода пользователей, если это будет реализовано на сервере
}

// Функция для обновления состояния кнопки звонка
function updateCallButton(callButton) {
  if (isInVoiceChat) {
    callButton.style.backgroundColor = "#ff4757"; // Красный цвет когда в голосовом чате
    callButton.title = "Отключиться от голосового чата";
    callButton.classList.add("voice-active"); // Добавляем класс для анимации
    callButton.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24">
        <path fill="#fff" d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>
        <path fill="#fff" d="M3 3l18 18-1.41 1.41L3 4.41z"/>
      </svg>
    `;
  } else {
    callButton.style.backgroundColor = "#007bff"; // Синий цвет по умолчанию
    callButton.title = "Подключиться к голосовому чату";
    callButton.classList.remove("voice-active"); // Убираем класс анимации
    callButton.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24">
        <path fill="#fff" d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>
      </svg>
    `;
  }
}

// Функция для открытия изображения в модальном окне
function openImageModal(imageSrc) {
  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.style.zIndex = "3000";
  modal.innerHTML = `
    <div style="max-width: 90vw; max-height: 90vh; position: relative;">
      <img src="${imageSrc}" alt="Изображение" style="max-width: 100%; max-height: 100%; border-radius: 12px;" />
      <button 
        style="position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.7); color: white; border: none; border-radius: 50%; width: 40px; height: 40px; cursor: pointer; font-size: 20px;"
        onclick="this.parentElement.parentElement.remove()"
      >×</button>
    </div>
  `;
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  };
  document.body.appendChild(modal);
}

// Функции для работы с прикреплением изображений
function handleAttachButtonClick() {
  const fileInput = document.getElementById("imageFileInput");
  if (fileInput) {
    fileInput.click();
  }
}

function handleImageFileChange(e) {
  const file = e.target.files[0];
  if (file && file.type.startsWith("image/")) {
    console.log("[DEBUG] Image file selected:", file.name, "Size:", file.size);

    try {
      const reader = new FileReader();
      reader.onload = function (e) {
        try {
          // Сжимаем изображение перед отправкой
          compressImage(e.target.result, (compressedImageData) => {
            console.log(
              "[DEBUG] Image compressed, new size:",
              compressedImageData.length
            );
            sendImageMessage(compressedImageData);
          });
        } catch (error) {
          console.error("[ERROR] Image compression failed:", error);
        }
      };

      reader.onerror = function (error) {
        console.error("[ERROR] FileReader error:", error);
      };

      reader.readAsDataURL(file);
    } catch (error) {
      console.error("[ERROR] Image processing failed:", error);
    }
  } else {
    console.warn("[WARNING] Invalid file type or no file selected");
  }

  // Очищаем input ПОСЛЕ обработки
  setTimeout(() => {
    e.target.value = "";
  }, 100);
}

// Функция сжатия изображений
function compressImage(imageData, callback) {
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();

    img.onload = function () {
      try {
        // Устанавливаем более строгие максимальные размеры
        const maxWidth = 600;  // Уменьшено с 800
        const maxHeight = 450; // Уменьшено с 600

        let { width, height } = img;

        // Вычисляем новые размеры с сохранением пропорций
        if (width > maxWidth || height > maxHeight) {
          const widthRatio = maxWidth / width;
          const heightRatio = maxHeight / height;
          const ratio = Math.min(widthRatio, heightRatio);
          
          width = Math.floor(width * ratio);
          height = Math.floor(height * ratio);
        }

        canvas.width = width;
        canvas.height = height;

        // Рисуем сжатое изображение
        ctx.drawImage(img, 0, 0, width, height);

        // Конвертируем в base64 с более низким качеством для лучшего сжатия
        const compressedData = canvas.toDataURL("image/jpeg", 0.5); // Уменьшено с 0.7
        
        console.log("[DEBUG] Image compressed from", imageData.length, "to", compressedData.length);
        
        // Проверяем финальный размер
        if (compressedData.length > 5 * 1024 * 1024) { // 5MB лимит
          console.error("[ERROR] Image still too large after compression:", compressedData.length);
          return;
        }
        
        callback(compressedData);
      } catch (error) {
        console.error("[ERROR] Image compression error:", error);
      }
    };

    img.onerror = function (error) {
      console.error("[ERROR] Image load error:", error);
    };

    img.src = imageData;
  } catch (error) {
    console.error("[ERROR] Compression function error:", error);
  }
}

function sendImageMessage(imageData) {
  try {
    // Отправляем изображение в основной процесс Electron
    ipcRenderer.send("send-image-message", imageData);
    console.log(
      "[DEBUG] Image message sent to main process, size:",
      imageData.length
    );
    
    // Устанавливаем таймаут для отправки (10 секунд)
    const timeoutId = setTimeout(() => {
      console.error("[ERROR] Image send timeout - operation took too long");
    }, 10000);
    
    // Очищаем таймаут при получении ответа
    const successHandler = (event, message) => {
      clearTimeout(timeoutId);
      ipcRenderer.removeListener("image-send-success", successHandler);
      ipcRenderer.removeListener("image-send-error", errorHandler);
    };
    
    const errorHandler = (event, error) => {
      clearTimeout(timeoutId);
      ipcRenderer.removeListener("image-send-success", successHandler);
      ipcRenderer.removeListener("image-send-error", errorHandler);
    };
    
    // Временно подписываемся на события для этой отправки
    ipcRenderer.once("image-send-success", successHandler);
    ipcRenderer.once("image-send-error", errorHandler);
    
  } catch (error) {
    console.error("[ERROR] Failed to send image message:", error);
  }
}

// Инициализация и обработчики событий после загрузки DOM
document.addEventListener("DOMContentLoaded", () => {
  // Инициализируем тему
  initializeTheme();

  // Получаем DOM элементы
  const callButton = document.getElementById("callButton");
  const logoutButton = document.getElementById("logoutButton");
  const logoutModal = document.getElementById("logoutModal");
  const logoutConfirm = document.getElementById("logoutConfirm");
  const logoutCancel = document.getElementById("logoutCancel");
  const themeButton = document.getElementById("themeButton");
  const avatarButton = document.getElementById("avatarButton");
  const avatarModal = document.getElementById("avatarModal");
  const avatarFileInput = document.getElementById("avatar-file");
  const avatarSaveButton = document.getElementById("avatarSaveButton");
  const avatarDeleteButton = document.getElementById("avatarDeleteButton");
  const avatarCancelButton = document.getElementById("avatarCancelButton");
  const avatarCloseButton = document.getElementById("avatarCloseButton");
  const attachButton = document.getElementById("attachButton");
  const imageFileInput = document.getElementById("imageFileInput");

  // Theme button handler
  if (themeButton) {
    themeButton.addEventListener("click", toggleTheme);
    console.log("Theme button event listener added.");
  }

  // Avatar button handler
  if (avatarButton) {
    avatarButton.addEventListener("click", showAvatarModal);
    console.log("Avatar button event listener added.");
  }

  // Avatar modal handlers
  if (avatarFileInput) {
    avatarFileInput.addEventListener("change", handleAvatarFileChange);
  }

  if (avatarSaveButton) {
    avatarSaveButton.addEventListener("click", saveAvatar);
  }

  if (avatarDeleteButton) {
    avatarDeleteButton.addEventListener("click", deleteAvatar);
  }

  if (avatarCancelButton) {
    avatarCancelButton.addEventListener("click", hideAvatarModal);
  }

  if (avatarCloseButton) {
    avatarCloseButton.addEventListener("click", hideAvatarModal);
  }

  // Attach button handler
  if (attachButton) {
    attachButton.addEventListener("click", handleAttachButtonClick);
    console.log("Attach button event listener added.");
  }

  // Image file input handler
  if (imageFileInput) {
    imageFileInput.addEventListener("change", handleImageFileChange);
    console.log("Image file input event listener added.");
  }

  // Call button handler
  if (callButton) {
    // Инициальное состояние кнопки
    updateCallButton(callButton);

    callButton.addEventListener("click", () => {
      if (isInVoiceChat) {
        // Отключаемся от голосового чата
        console.log("Отключение от голосового чата");
        ipcRenderer.send("voice-command", "/leave");
        // Не меняем состояние здесь - ждем подтверждения от voice-state-changed
      } else {
        // Подключаемся к голосовому чату
        console.log("Подключение к голосовому чату");
        ipcRenderer.send("voice-command", "/voice");
        // Не меняем состояние здесь - ждем подтверждения от voice-state-changed
      }
    });
    console.log("Call button event listener added.");
  } else {
    console.error("Call button element not found!");
  }

  // Logout handlers
  if (logoutButton) {
    logoutButton.addEventListener("click", () => {
      console.log("Logout button clicked.");
      if (logoutModal) {
        logoutModal.style.display = "flex";
        console.log("Logout modal shown.");
      } else {
        console.error("Logout modal element not found when trying to show!");
      }
    });
    console.log("Logout button event listener added.");
  } else {
    console.error("Logout button element not found!");
  }

  if (logoutConfirm) {
    logoutConfirm.addEventListener("click", () => {
      console.log("Logout confirm button clicked.");
      if (logoutModal) {
        logoutModal.style.display = "none";
        console.log("Logout modal hidden on confirm.");
      }
      // Здесь будет логика выхода - отправляем сообщение в основной процесс
      ipcRenderer.send("request-logout");
    });
    console.log("Logout confirm button event listener added.");
  } else {
    console.error("Logout confirm button element not found!");
  }

  if (logoutCancel) {
    logoutCancel.addEventListener("click", () => {
      console.log("Logout cancel button clicked.");
      if (logoutModal) {
        logoutModal.style.display = "none";
        console.log("Logout modal hidden on cancel.");
      }
    });
    console.log("Logout cancel button event listener added.");
  } else {
    console.error("Logout cancel button element not found!");
  }

  // Убедимся, что модальные окна скрыты при загрузке
  if (logoutModal) {
    logoutModal.style.display = "none";
    console.log("Logout modal initially hidden.");
  } else {
    console.error("Logout modal element not found on DOMContentLoaded!");
  }

  if (avatarModal) {
    avatarModal.style.display = "none";
    console.log("Avatar modal initially hidden.");
  }

  // Инициализация списка пользователей
  updateUsersList();
  updateParticipantsCount();
});

// Обработчик для получения имени пользователя
ipcRenderer.on("set-username", (event, username) => {
  currentUsername = username;
  console.log("[DEBUG] Current username set to:", currentUsername);

  // Загружаем сохранённую аватарку пользователя
  const savedAvatar = localStorage.getItem(`airchat-avatar-${username}`);
  if (savedAvatar) {
    currentUserAvatar = savedAvatar;
    updateAvatarButton();
    console.log("[DEBUG] Loaded saved avatar for user:", username);
  }
});

// Обработчик для изменения состояния голосового чата
ipcRenderer.on("voice-state-changed", (event, isConnected) => {
  console.log("[DEBUG] Voice state changed:", isConnected);
  isInVoiceChat = isConnected;
  const callButton = document.getElementById("callButton");
  if (callButton) {
    updateCallButton(callButton);
  }
});

// Обработчик входящих сообщений чата от основного процесса
ipcRenderer.on("display-chat-message", (event, message) => {
  console.log("Received message from main process:", message);
  // Удаляем символ новой строки из сообщения
  message = message.trim();

  // Разделяем сообщения по символам новой строки если они склеены
  const messages = message.split("\n").filter((msg) => msg.trim().length > 0);

  messages.forEach((singleMessage) => {
    singleMessage = singleMessage.trim();
    console.log(`[DEBUG] Processing single message: "${singleMessage}"`);

    if (singleMessage) {
      // Проверяем, является ли это сообщением с изображением
      if (singleMessage.includes("]: IMAGE_DATA:")) {
        const parts = singleMessage.split("]: IMAGE_DATA:");
        if (parts.length === 2) {
          const senderInfo = parts[0] + "]:"; // Например "[adam1]:"
          const imageData = parts[1];

          // Определяем, является ли сообщение собственным
          const isOwnMessage = senderInfo.includes(`[${currentUsername}]:`);

          // Добавляем изображение в чат
          addMessage(imageData, isOwnMessage, true);
          console.log("[DEBUG] Image message processed from:", senderInfo);
          return; // Выходим, чтобы не обрабатывать как обычное сообщение
        }
      }

      // Определяем, является ли сообщение собственным
      const isOwnMessage =
        singleMessage.includes(`[${currentUsername}]:`) ||
        singleMessage.startsWith(`[${currentUsername}]:`);
      console.log(
        "[DEBUG] Is own message:",
        isOwnMessage,
        "Current username:",
        currentUsername
      );

      addMessage(singleMessage, isOwnMessage);

      // Обрабатываем сообщение на основе его содержимого
      handleUserMessage(singleMessage);
    }
  });
});

// Обработчики sendButton и messageInput
sendButton.addEventListener("click", () => {
  const text = messageInput.value.trim();
  if (text) {
    // Отправляем сообщение в основной процесс Electron
    ipcRenderer.send("send-chat-message", text);
    messageInput.value = "";
  }
});

messageInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    sendButton.click();
  }
});

// Обработчики результата отправки изображений
ipcRenderer.on("image-send-success", (event, message) => {
  console.log("[DEBUG] Image sent successfully:", message);
});

ipcRenderer.on("image-send-error", (event, error) => {
  console.error("[ERROR] Image send failed:", error);
  // Можно показать уведомление пользователю
});
