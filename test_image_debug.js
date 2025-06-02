// Диагностический скрипт для тестирования отправки изображений
console.log("=== AirChat Image Debug Test ===");

// Симуляция создания небольшого тестового изображения
function createTestImage() {
  const canvas = document.createElement("canvas");
  canvas.width = 100;
  canvas.height = 100;
  const ctx = canvas.getContext("2d");

  // Рисуем простой тест
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(0, 0, 50, 50);
  ctx.fillStyle = "#00ff00";
  ctx.fillRect(50, 0, 50, 50);
  ctx.fillStyle = "#0000ff";
  ctx.fillRect(0, 50, 50, 50);
  ctx.fillStyle = "#ffff00";
  ctx.fillRect(50, 50, 50, 50);

  return canvas.toDataURL("image/jpeg", 0.8);
}

// Проверяем работу сжатия
function testCompression() {
  const testImage = createTestImage();
  console.log("Test image size:", testImage.length);

  // Тестируем сжатие как в основном коде
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const img = new Image();

  img.onload = function () {
    canvas.width = 50;
    canvas.height = 50;
    ctx.drawImage(img, 0, 0, 50, 50);

    const compressed = canvas.toDataURL("image/jpeg", 0.5);
    console.log("Compressed size:", compressed.length);
    console.log(
      "Compression ratio:",
      (testImage.length / compressed.length).toFixed(2)
    );

    // Тестируем отправку
    if (typeof require !== "undefined") {
      const { ipcRenderer } = require("electron");
      console.log("Sending test image...");
      ipcRenderer.send("send-image-message", compressed);
    } else {
      console.log("Not in Electron environment");
    }
  };

  img.src = testImage;
}

// Запускаем тест при загрузке DOM
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", testCompression);
} else {
  testCompression();
}
