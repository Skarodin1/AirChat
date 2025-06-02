const { ipcRenderer } = require("electron");

// Переключение между формами
function showLoginForm() {
  hideAllForms();
  const loginForm = document.getElementById("login-form");
  loginForm.classList.remove("hidden-form");
  loginForm.classList.add("main-form");

  // Переинициализируем обработчики для формы входа
  initializeLoginForm();
}

function showRegistrationForm() {
  hideAllForms();
  const registerForm = document.getElementById("register-form");
  registerForm.classList.remove("hidden-form");
  registerForm.classList.add("active");

  // Переинициализируем обработчики для формы регистрации
  initializeRegistrationForm();
}

function showQuickJoinForm() {
  hideAllForms();
  const quickForm = document.getElementById("main-form");
  quickForm.classList.remove("hidden-form");
  quickForm.classList.add("active");
}

function hideAllForms() {
  // Скрываем все формы
  document
    .querySelectorAll("#login-form, #register-form, #main-form")
    .forEach((form) => {
      form.classList.remove("active", "main-form");
      form.classList.add("hidden-form");
    });
}

// Создание комнаты (быстрое подключение)
function createRoom() {
  const name = document.getElementById("userName").value.trim();
  const ip = document.getElementById("serverIP").value.trim();

  // Валидация
  let hasErrors = false;

  if (name.length < 2) {
    showError("userName", "Имя должно содержать минимум 2 символа");
    hasErrors = true;
  } else {
    hideError("userName");
  }

  if (!validateIP(ip)) {
    showError("serverIP", "Введите корректный IP адрес");
    hasErrors = true;
  } else {
    hideError("serverIP");
  }

  if (!hasErrors) {
    // Отправляем данные для быстрого подключения
    ipcRenderer.send("join-room", {
      ip: ip,
      name: name,
      quickJoin: true,
    });
  }
}

// Переключение между вкладками (устаревшая функция, но оставляем для совместимости)
function switchTab(tabName) {
  if (tabName === "login") {
    showLoginForm();
  } else if (tabName === "register") {
    showRegistrationForm();
  }
}

// Валидация силы пароля
function checkPasswordStrength(password) {
  const strengthIndicator = document.getElementById("passwordStrength");
  const strengthBar = document.getElementById("passwordStrengthBar");

  if (password.length === 0) {
    strengthIndicator.style.display = "none";
    return;
  }

  strengthIndicator.style.display = "block";

  let score = 0;

  // Критерии силы пароля
  if (password.length >= 8) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  // Обновляем индикатор
  if (score <= 2) {
    strengthBar.className = "password-strength-bar strength-weak";
    strengthBar.style.width = "33%";
  } else if (score <= 4) {
    strengthBar.className = "password-strength-bar strength-medium";
    strengthBar.style.width = "66%";
  } else {
    strengthBar.className = "password-strength-bar strength-strong";
    strengthBar.style.width = "100%";
  }
}

// Показать ошибку
function showError(fieldId, message) {
  const field = document.getElementById(fieldId);
  const errorDiv = document.getElementById(fieldId + "Error");

  field.classList.add("error");
  errorDiv.textContent = message;
  errorDiv.style.display = "block";
}

// Скрыть ошибку
function hideError(fieldId) {
  const field = document.getElementById(fieldId);
  const errorDiv = document.getElementById(fieldId + "Error");

  field.classList.remove("error");
  errorDiv.style.display = "none";
}

// Валидация IP адреса
function validateIP(ip) {
  const ipRegex =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  return ipRegex.test(ip) || ip === "localhost" || ip.includes(":");
}

// Инициализация формы входа
function initializeLoginForm() {
  const loginForm = document.getElementById("loginForm");
  if (!loginForm) return;

  // Удаляем старые обработчики (если есть)
  const newLoginForm = loginForm.cloneNode(true);
  loginForm.parentNode.replaceChild(newLoginForm, loginForm);

  // Добавляем новый обработчик
  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const username = document.getElementById("loginUsername").value.trim();
    const password = document.getElementById("loginPassword").value;
    const serverIP = document.getElementById("loginServerIP").value.trim();

    // Валидация
    let hasErrors = false;

    if (username.length < 3) {
      showError(
        "loginUsername",
        "Имя пользователя должно содержать минимум 3 символа"
      );
      hasErrors = true;
    } else {
      hideError("loginUsername");
    }

    if (password.length < 6) {
      showError("loginPassword", "Пароль должен содержать минимум 6 символов");
      hasErrors = true;
    } else {
      hideError("loginPassword");
    }

    if (!validateIP(serverIP)) {
      showError("loginServerIP", "Введите корректный IP адрес");
      hasErrors = true;
    } else {
      hideError("loginServerIP");
    }

    if (!hasErrors) {
      // Отправляем данные для входа в главный процесс
      ipcRenderer.send("auth-login", {
        username: username,
        password: password,
        serverIP: serverIP,
      });
    }
  });
}

// Инициализация формы регистрации
function initializeRegistrationForm() {
  const registerForm = document.getElementById("registerForm");
  if (!registerForm) return;

  // Удаляем старые обработчики (если есть)
  const newRegisterForm = registerForm.cloneNode(true);
  registerForm.parentNode.replaceChild(newRegisterForm, registerForm);

  // Добавляем новый обработчик формы
  document
    .getElementById("registerForm")
    .addEventListener("submit", async (e) => {
      e.preventDefault();

      const username = document.getElementById("registerUsername").value.trim();
      const email = document.getElementById("registerEmail").value.trim();
      const password = document.getElementById("registerPassword").value;
      const confirmPassword = document.getElementById("confirmPassword").value;

      // Валидация
      let hasErrors = false;

      if (username.length < 3 || username.length > 20) {
        showError(
          "registerUsername",
          "Имя пользователя должно содержать от 3 до 20 символов"
        );
        hasErrors = true;
      } else if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        showError(
          "registerUsername",
          "Имя может содержать только буквы, цифры и подчеркивания"
        );
        hasErrors = true;
      } else {
        hideError("registerUsername");
      }

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showError(
          "registerEmail",
          "Пожалуйста, введите корректный email адрес"
        );
        hasErrors = true;
      } else {
        hideError("registerEmail");
      }

      if (password.length < 6) {
        showError(
          "registerPassword",
          "Пароль должен содержать минимум 6 символов"
        );
        hasErrors = true;
      } else {
        hideError("registerPassword");
      }

      if (password !== confirmPassword) {
        showError("confirmPassword", "Пароли не совпадают");
        hasErrors = true;
      } else {
        hideError("confirmPassword");
      }

      if (!hasErrors) {
        // Отправляем данные для регистрации в главный процесс
        ipcRenderer.send("auth-register", {
          username: username,
          email: email,
          password: password,
        });
      }
    });

  // Обработчик для проверки силы пароля
  const passwordField = document.getElementById("registerPassword");
  if (passwordField) {
    passwordField.addEventListener("input", (e) => {
      checkPasswordStrength(e.target.value);
    });
  }
}

// Обработчики событий после загрузки DOM
document.addEventListener("DOMContentLoaded", () => {
  // Инициализируем главную форму входа
  initializeLoginForm();

  // Получение локального IP
  ipcRenderer.send("get-local-ip");
});

// Обработчики IPC сообщений
ipcRenderer.on("local-ip-response", (event, ip) => {
  document.getElementById("loginServerIP").value = ip;
  document.getElementById("serverIP").value = ip;
});

ipcRenderer.on("auth-login-response", (event, response) => {
  if (response.success) {
    // Успешный вход - переходим к подключению
    ipcRenderer.send("join-room", {
      ip: response.serverIP,
      name: response.username,
      token: response.token,
    });
  } else {
    // Показываем ошибку
    showError("loginPassword", response.error || "Ошибка входа");
  }
});

ipcRenderer.on("auth-register-response", (event, response) => {
  if (response.success) {
    // Успешная регистрация - показываем сообщение
    alert("✅ Регистрация успешна! Теперь вы можете войти в систему.");
    showLoginForm();

    // Заполняем форму входа
    document.getElementById("loginUsername").value = response.username;
  } else {
    // Показываем ошибку
    if (response.field) {
      showError(
        "register" +
          response.field.charAt(0).toUpperCase() +
          response.field.slice(1),
        response.error
      );
    } else {
      alert("❌ Ошибка регистрации: " + response.error);
    }
  }
});

// Глобальные функции для кнопок
window.switchTab = switchTab;
window.showLoginForm = showLoginForm;
window.showRegistrationForm = showRegistrationForm;
window.showQuickJoinForm = showQuickJoinForm;
window.createRoom = createRoom;
