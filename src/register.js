const { ipcRenderer } = require("electron");

// DOM элементы
const nameInput = document.getElementById("nameInput");
const ipInput = document.getElementById("ipInput");
const errorMessage = document.getElementById("errorMessage");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");

// Переменная для хранения локального IP
let localIPAddress = "";

// Запрашиваем локальный IP у основного процесса при загрузке страницы
ipcRenderer.send("get-local-ip");

// Обрабатываем ответ с локальным IP
ipcRenderer.on("local-ip-response", (event, ip) => {
  localIPAddress = ip;
  console.log("Received local IP:", localIPAddress); // Лог полученного IP
  // Если поле IP пустое, заполняем его локальным IP
  if (ipInput.value.trim() === "") {
    ipInput.placeholder = `Ваш IP (например ${localIPAddress})`;
  }
});

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.style.display = "block";
}

function hideError() {
  errorMessage.style.display = "none";
}

function handle(action) {
  const name = nameInput.value.trim();
  let ip = ipInput.value.trim();

  // Если IP не введен, используем локальный IP
  if (ip === "") {
    ip = localIPAddress;
  }

  if (!name || !ip) {
    showError("Введите данные!");
    return;
  }

  hideError();

  if (action === "create") {
    ipcRenderer.send("create-room", { name, ip });
  } else if (action === "join") {
    ipcRenderer.send("join-room", { name, ip });
  }
}

// Обработчики событий
createRoomBtn.addEventListener("click", () => handle("create"));
joinRoomBtn.addEventListener("click", () => handle("join"));

// Обработка Enter в полях ввода
nameInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    ipInput.focus();
  }
});

ipInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    // Используем локальный IP, если поле пустое, при нажатии Enter в IP поле
    if (ipInput.value.trim() === "") {
      // Заполняем поле placeholder'ом, но в handle будем использовать localIPAddress
    }
    createRoomBtn.click();
  }
});
