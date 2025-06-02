const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const bcrypt = require("bcrypt");
const sqlite3 = require("sqlite3").verbose();
const crypto = require("crypto");

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require("electron-squirrel-startup")) {
  app.quit();
}

let mainWindow;
let goClientProcess = null; // Переменная для хранения процесса Go клиента
let goServerProcess = null; // Переменная для хранения процесса Go сервера
let db = null; // База данных SQLite

// Инициализация базы данных
function initDatabase() {
  const dbPath = path.join(app.getPath("userData"), "airchat.db");
  db = new sqlite3.Database(dbPath);

  // Проверяем существование таблицы и её структуру
  db.get(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='users'",
    (err, row) => {
      if (err) {
        console.error("Error checking table structure:", err);
        return;
      }

      // Если таблица существует, но не содержит нужные колонки - удаляем её
      if (row && !row.sql.includes("email TEXT")) {
        db.run("DROP TABLE IF EXISTS users", (err) => {
          if (err) {
            console.error("Error dropping users table:", err);
            return;
          }
          createUsersTable();
        });
      } else if (!row) {
        // Если таблица не существует - создаём её
        createUsersTable();
      }
    }
  );

  console.log("Database initialized at:", dbPath);
}

// Функция создания таблицы users
function createUsersTable() {
  db.run(
    `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME
    )
  `,
    (err) => {
      if (err) {
        console.error("Error creating users table:", err);
      } else {
        console.log("Users table created successfully");
      }
    }
  );
}

// Генерация соли для пароля
function generateSalt() {
  return crypto.randomBytes(32).toString("hex");
}

// Хеширование пароля
async function hashPassword(password, salt) {
  return await bcrypt.hash(password + salt, 12);
}

// Проверка пароля
async function verifyPassword(password, salt, hash) {
  return await bcrypt.compare(password + salt, hash);
}

// Генерация токена сессии
function generateSessionToken() {
  return crypto.randomBytes(64).toString("hex");
}

// Функция для получения правильного пути к ресурсам
function getResourcePath(relativePath) {
  let finalPath;
  if (app.isPackaged) {
    // В собранном приложении ресурсы находятся в папке resources/bin
    finalPath = path.join(
      process.resourcesPath,
      "bin",
      path.basename(relativePath)
    );
  } else {
    // В режиме разработки используем обычный путь
    finalPath = path.join(__dirname, "..", relativePath);
  }

  // Добавляем подробное логирование
  console.log(`[DEBUG] Resource path resolution:`);
  console.log(`  - Relative path: ${relativePath}`);
  console.log(`  - Is packaged: ${app.isPackaged}`);
  console.log(`  - Resource path: ${process.resourcesPath}`);
  console.log(`  - Final path: ${finalPath}`);
  console.log(`  - File exists: ${require("fs").existsSync(finalPath)}`);

  if (!require("fs").existsSync(finalPath)) {
    console.error(`[ERROR] Resource file not found: ${finalPath}`);
    // Попробуем найти файл в других возможных местах
    const alternativePaths = [
      path.join(process.resourcesPath, relativePath),
      path.join(app.getAppPath(), relativePath),
      path.join(app.getAppPath(), "bin", path.basename(relativePath)),
    ];

    console.log("[DEBUG] Checking alternative paths:");
    alternativePaths.forEach((altPath) => {
      console.log(`  - ${altPath}: ${require("fs").existsSync(altPath)}`);
    });
  }

  return finalPath;
}

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Добавляем обработку разрешений на медиа
  mainWindow.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      if (permission === "media") {
        // Автоматически разрешаем доступ к микрофону и камере
        callback(true);
      } else {
        callback(false);
      }
    }
  );

  // and load the registration page first
  mainWindow.loadFile(path.join(__dirname, "register.html"));

  // Open the DevTools.
  // mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", () => {
  initDatabase();
  createWindow();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Обработка событий от страницы регистрации
ipcMain.on("create-room", (event, data) => {
  console.log("Creating room:", data);

  // Запускаем Go сервер
  const serverPath = getResourcePath("bin/server.exe");
  goServerProcess = spawn(serverPath, [], {
    detached: true,
    stdio: "pipe",
  });

  goServerProcess.stdout.on("data", (data) => {
    console.log(`[SERVER] ${data.toString()}`);
  });

  goServerProcess.stderr.on("data", (data) => {
    console.error(`[SERVER ERROR] ${data.toString()}`);
  });

  goServerProcess.on("error", (err) => {
    console.error(`Failed to start Go server: ${err}`);
    goServerProcess = null;
  });

  goServerProcess.on("close", (code) => {
    console.log(`Go server process exited with code ${code}`);
    goServerProcess = null;
  });

  // Небольшая задержка для запуска сервера, затем запускаем клиент
  setTimeout(() => {
    // Проверяем, что клиент не запущен уже
    if (goClientProcess) {
      console.log("Go client already running.");
      mainWindow.loadFile(path.join(__dirname, "index.html"));
      return;
    }

    const clientPath = getResourcePath("bin/client.exe");

    // Устанавливаем переменные окружения для дочернего процесса
    const env = { ...process.env, SERVER_IP: data.ip, USERNAME: data.name };

    console.log(`🔧 [DEBUG] Запускаем клиент с параметрами:`);
    console.log(`   SERVER_IP: ${data.ip}`);
    console.log(`   USERNAME: ${data.name}`);

    // Запускаем Go клиент с использованием spawn
    goClientProcess = spawn(clientPath, [], { env: env });

    // Обработка вывода Go клиента
    goClientProcess.stdout.on("data", (data) => {
      console.log("[DEBUG] Go client stdout (raw):", data);
      console.log("[DEBUG] Go client stdout (string):", data.toString());
      console.log("[DEBUG] Go client stdout (length):", data.length);
      console.log("[DEBUG] Go client stdout (hex):", data.toString("hex"));

      const message = data.toString().trim(); // Добавим trim для очистки
      console.log("[DEBUG] Message after trim:", `"${message}"`);

      // Фильтруем отладочные сообщения
      if (message.includes("[DEBUG]")) {
        console.log("🔧 [CLIENT DEBUG]:", message);
        return; // Не отправляем отладочные сообщения в UI
      }

      // Проверяем, что сообщение не пустое
      if (message.length === 0) {
        console.log("[DEBUG] Empty message, skipping");
        return;
      }

      console.log("[DEBUG] Sending message to renderer:", `"${message}"`);

      // Отправляем только обычные сообщения в рендерер-процесс
      if (mainWindow) {
        mainWindow.webContents.send("display-chat-message", message);
      }
    });

    goClientProcess.stderr.on("data", (data) => {
      console.error(`Go client stderr: ${data}`);
    });

    goClientProcess.on("error", (err) => {
      console.error(`Failed to start Go client process: ${err}`);
      goClientProcess = null;
    });

    goClientProcess.on("close", (code) => {
      console.log(`Go client process exited with code ${code}`);
      goClientProcess = null;
    });

    // После запуска клиента переходим на страницу чата
    mainWindow.loadFile(path.join(__dirname, "index.html"));

    // Отправляем имя пользователя в рендерер-процесс
    setTimeout(() => {
      if (mainWindow) {
        mainWindow.webContents.send("set-username", data.name);
      }
    }, 1000); // Небольшая задержка, чтобы страница успела загрузиться
  }, 2000); // Даем серверу 2 секунды на запуск
});

// Новый обработчик 'join-room' для запуска Go клиента через spawn
ipcMain.on("join-room", (event, data) => {
  console.log("Joining room:", data);

  // Получаем локальный IP для сравнения
  const interfaces = os.networkInterfaces();
  let localIP = "127.0.0.1";
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (!iface.internal && iface.family === "IPv4") {
        localIP = iface.address;
        break;
      }
    }
    if (localIP !== "127.0.0.1") break;
  }

  // Если IP совпадает с локальным, запускаем сервер
  const isLocalServer =
    data.ip === localIP || data.ip === "localhost" || data.ip === "127.0.0.1";

  if (isLocalServer && !goServerProcess) {
    console.log("Запускаем локальный сервер для подключения...");

    // Запускаем Go сервер
    const serverPath = getResourcePath("bin/server.exe");
    goServerProcess = spawn(serverPath, [], {
      detached: true,
      stdio: "pipe",
    });

    goServerProcess.stdout.on("data", (data) => {
      console.log(`[SERVER] ${data.toString()}`);
    });

    goServerProcess.stderr.on("data", (data) => {
      console.error(`[SERVER ERROR] ${data.toString()}`);
    });

    goServerProcess.on("error", (err) => {
      console.error(`Failed to start Go server: ${err}`);
      goServerProcess = null;
    });

    goServerProcess.on("close", (code) => {
      console.log(`Go server process exited with code ${code}`);
      goServerProcess = null;
    });

    // Даем серверу время на запуск
    setTimeout(() => startClient(), 2000);
  } else {
    // Сразу запускаем клиент для внешнего сервера
    startClient();
  }

  function startClient() {
    if (goClientProcess) {
      console.log("Go client already running.");
      mainWindow.loadFile(path.join(__dirname, "index.html"));
      return;
    }

    const clientPath = getResourcePath("bin/client.exe");
    console.log("[DEBUG] Starting Go client from path:", clientPath);

    // 🔧 ИСПРАВЛЕНИЕ: Для локального сервера принудительно используем localhost
    let connectIP = data.ip;
    if (isLocalServer) {
      connectIP = "127.0.0.1";
      console.log(
        `🔧 [DEBUG] Локальный сервер: заменяем ${data.ip} на ${connectIP}`
      );
    }

    // Устанавливаем переменные окружения для дочернего процесса
    const env = { ...process.env, SERVER_IP: connectIP, USERNAME: data.name };

    console.log(`🔧 [DEBUG] Запускаем клиент с параметрами:`);
    console.log(`   SERVER_IP: ${connectIP}`);
    console.log(`   USERNAME: ${data.name}`);
    console.log(`   Working Directory: ${process.cwd()}`);
    console.log(`   Is Packaged: ${app.isPackaged}`);
    console.log(`   Resource Path: ${process.resourcesPath}`);

    try {
      // Запускаем Go клиент с использованием spawn
      goClientProcess = spawn(clientPath, [], {
        env: env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: false, // Показываем окно процесса для отладки
      });

      console.log(
        "[DEBUG] Go client process started with PID:",
        goClientProcess.pid
      );
    } catch (error) {
      console.error("[ERROR] Failed to start Go client:", error);
      return;
    }

    // Обработка вывода Go клиента
    goClientProcess.stdout.on("data", (data) => {
      console.log("[DEBUG] Go client stdout (raw):", data);
      console.log("[DEBUG] Go client stdout (string):", data.toString());
      console.log("[DEBUG] Go client stdout (length):", data.length);
      console.log("[DEBUG] Go client stdout (hex):", data.toString("hex"));

      const message = data.toString().trim(); // Добавим trim для очистки
      console.log("[DEBUG] Message after trim:", `"${message}"`);

      // Фильтруем отладочные сообщения
      if (message.includes("[DEBUG]")) {
        console.log("🔧 [CLIENT DEBUG]:", message);
        return; // Не отправляем отладочные сообщения в UI
      }

      // Проверяем, что сообщение не пустое
      if (message.length === 0) {
        console.log("[DEBUG] Empty message, skipping");
        return;
      }

      console.log("[DEBUG] Sending message to renderer:", `"${message}"`);

      // Отправляем только обычные сообщения в рендерер-процесс
      if (mainWindow) {
        mainWindow.webContents.send("display-chat-message", message);
      }
    });

    goClientProcess.stderr.on("data", (data) => {
      console.error(`Go client stderr: ${data}`);
      // Обработка ошибок Go клиента
    });

    goClientProcess.on("error", (err) => {
      console.error(`Failed to start Go client process: ${err}`);
      goClientProcess = null; // Сбрасываем ссылку при ошибке запуска
    });

    goClientProcess.on("close", (code) => {
      console.log(`Go client process exited with code ${code}`);
      goClientProcess = null; // Сбрасываем ссылку при завершении
      // Возможно, стоит уведомить пользователя или вернуться на страницу регистрации
    });

    // После запуска клиента переходим на страницу чата
    mainWindow.loadFile(path.join(__dirname, "index.html"));

    // Отправляем имя пользователя в рендерер-процесс
    setTimeout(() => {
      if (mainWindow) {
        mainWindow.webContents.send("set-username", data.name);
      }
    }, 1000); // Небольшая задержка, чтобы страница успела загрузиться
  }
});

// Обработка сообщений чата из рендерер-процесса
ipcMain.on("send-chat-message", (event, message) => {
  console.log("Received chat message from renderer:", message);
  if (goClientProcess) {
    // Отправляем сообщение в стандартный ввод Go клиента
    goClientProcess.stdin.write(message + "\n");
  } else {
    console.error("Go client process not running.");
  }
});

// Обработка отправки изображений
ipcMain.on("send-image-message", (event, imageData) => {
  console.log("Received image message from renderer, size:", imageData.length);

  if (!goClientProcess) {
    console.error("Go client process not running.");
    // Отправляем ошибку обратно в renderer
    event.reply("image-send-error", "Go client not running");
    return;
  }

  try {
    // Проверяем размер сообщения
    if (imageData.length > 10 * 1024 * 1024) {
      // 10MB лимит
      console.error("Image too large:", imageData.length);
      event.reply("image-send-error", "Image too large");
      return;
    }

    // Отправляем изображение как специальное сообщение
    const imageMessage = `IMAGE_DATA:${imageData}`;

    console.log(
      "[DEBUG] Attempting to send image to Go client, message length:",
      imageMessage.length
    );

    // Используем write с callback для отслеживания ошибок
    const written = goClientProcess.stdin.write(imageMessage + "\n", (err) => {
      if (err) {
        console.error("Error writing image to Go client:", err);
        event.reply("image-send-error", err.message);
      } else {
        console.log("[DEBUG] Image sent to Go client successfully");
        event.reply("image-send-success", "Image sent successfully");
      }
    });

    if (!written) {
      console.warn("[WARNING] Write buffer is full, but continuing...");
    }
  } catch (error) {
    console.error("Error processing image:", error);
    event.reply("image-send-error", error.message);
  }
});

// Обработка команд голосового чата (отдельно от обычных сообщений)
ipcMain.on("voice-command", (event, command) => {
  console.log("Received voice command from renderer:", command);
  if (goClientProcess) {
    // Отправляем команду в стандартный ввод Go клиента
    goClientProcess.stdin.write(command + "\n");
    console.log("Sent voice command to Go client stdin.");

    // Отправляем обратно подтверждение изменения состояния
    if (command === "/voice") {
      mainWindow.webContents.send("voice-state-changed", true);
    } else if (command === "/leave") {
      mainWindow.webContents.send("voice-state-changed", false);
    }
  } else {
    console.error("Go client process not running.");
  }
});

// Обработка запроса на выход
ipcMain.on("request-logout", (event) => {
  console.log("Received logout request."); // Лог при получении запроса

  // Корректно завершаем Go клиент
  if (goClientProcess) {
    // Отправляем команду выхода
    goClientProcess.stdin.write("/exit\n");

    // Даем время на корректное завершение, затем принудительно завершаем
    setTimeout(() => {
      if (goClientProcess) {
        goClientProcess.kill("SIGTERM");
        goClientProcess = null;
      }
    }, 1000);
  }

  // Корректно завершаем Go сервер
  if (goServerProcess) {
    goServerProcess.kill("SIGTERM");
    goServerProcess = null;
  }

  if (mainWindow) {
    mainWindow.loadFile(path.join(__dirname, "register.html"));
    console.log("Loading registration page."); // Лог при загрузке страницы регистрации
  }
});

// Обработка закрытия приложения
app.on("before-quit", () => {
  if (goClientProcess) {
    goClientProcess.stdin.write("/exit\n");
    goClientProcess.kill("SIGTERM");
    goClientProcess = null;
  }

  if (goServerProcess) {
    goServerProcess.kill("SIGTERM");
    goServerProcess = null;
  }
});

// Обработка запроса локального IP от рендерер-процесса
ipcMain.on("get-local-ip", (event) => {
  const interfaces = os.networkInterfaces();
  let localIP = "127.0.0.1"; // Значение по умолчанию

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Пропускаем внутренние адреса и те, что не IPv4
      if (!iface.internal && iface.family === "IPv4") {
        localIP = iface.address;
        break;
      }
    }
    if (localIP !== "127.0.0.1") break; // Найден внешний IPv4, останавливаем поиск
  }

  console.log("Sending local IP:", localIP); // Лог отправляемого IP
  event.reply("local-ip-response", localIP);
});

// Обработчик регистрации пользователя
ipcMain.on("auth-register", async (event, userData) => {
  try {
    const { username, email, password } = userData;

    // Проверяем, не существует ли уже такой пользователь
    db.get(
      "SELECT id FROM users WHERE username = ? OR email = ?",
      [username, email],
      async (err, row) => {
        if (err) {
          console.error("Database error:", err);
          event.reply("auth-register-response", {
            success: false,
            error: "Ошибка базы данных",
          });
          return;
        }

        if (row) {
          event.reply("auth-register-response", {
            success: false,
            error: "Пользователь с таким именем или email уже существует",
            field: "username",
          });
          return;
        }

        // Создаем нового пользователя
        const salt = generateSalt();
        const passwordHash = await hashPassword(password, salt);

        db.run(
          "INSERT INTO users (username, email, password_hash, salt) VALUES (?, ?, ?, ?)",
          [username, email, passwordHash, salt],
          function (err) {
            if (err) {
              console.error("Error creating user:", err);
              event.reply("auth-register-response", {
                success: false,
                error: "Ошибка при создании пользователя",
              });
            } else {
              console.log("User registered successfully:", username);
              event.reply("auth-register-response", {
                success: true,
                username: username,
              });
            }
          }
        );
      }
    );
  } catch (error) {
    console.error("Registration error:", error);
    event.reply("auth-register-response", {
      success: false,
      error: "Внутренняя ошибка сервера",
    });
  }
});

// Обработчик входа пользователя
ipcMain.on("auth-login", async (event, loginData) => {
  try {
    const { username, password, serverIP } = loginData;

    // Ищем пользователя в базе данных
    db.get(
      "SELECT * FROM users WHERE username = ?",
      [username],
      async (err, user) => {
        if (err) {
          console.error("Database error:", err);
          event.reply("auth-login-response", {
            success: false,
            error: "Ошибка базы данных",
          });
          return;
        }

        if (!user) {
          event.reply("auth-login-response", {
            success: false,
            error: "Неверное имя пользователя или пароль",
          });
          return;
        }

        // Проверяем пароль
        const isValidPassword = await verifyPassword(
          password,
          user.salt,
          user.password_hash
        );

        if (!isValidPassword) {
          event.reply("auth-login-response", {
            success: false,
            error: "Неверное имя пользователя или пароль",
          });
          return;
        }

        // Обновляем время последнего входа
        db.run("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?", [
          user.id,
        ]);

        // Генерируем токен сессии
        const sessionToken = generateSessionToken();

        console.log("User logged in successfully:", username);
        event.reply("auth-login-response", {
          success: true,
          username: username,
          serverIP: serverIP,
          token: sessionToken,
        });
      }
    );
  } catch (error) {
    console.error("Login error:", error);
    event.reply("auth-login-response", {
      success: false,
      error: "Внутренняя ошибка сервера",
    });
  }
});
