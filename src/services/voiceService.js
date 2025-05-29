class VoiceService {
  constructor() {
    this.ws = null;
    this.udpSocket = null;
    this.mediaStream = null;
    this.audioContext = null;
    this.isConnected = false;
    this.onMessageCallback = null;
    this.onVoiceCallback = null;
  }

  async connect(username, ip) {
    try {
      // Подключаемся к WebSocket серверу по указанному IP
      this.ws = new WebSocket(`ws://${ip}:8080/ws`);

      this.ws.onopen = () => {
        console.log("WebSocket подключен");
        this.isConnected = true;
        // Отправляем информацию о пользователе
        this.ws.send(
          JSON.stringify({
            type: "join",
            username: username,
          })
        );
      };

      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (this.onMessageCallback) {
          this.onMessageCallback(data);
        }
      };

      this.ws.onerror = (error) => {
        console.error("WebSocket ошибка:", error);
      };

      this.ws.onclose = () => {
        console.log("WebSocket отключен");
        this.isConnected = false;
      };

      // Инициализируем аудио контекст
      this.audioContext = new (window.AudioContext ||
        window.webkitAudioContext)();

      // Запрашиваем доступ к микрофону
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });

      // Создаем источник аудио
      const source = this.audioContext.createMediaStreamSource(
        this.mediaStream
      );

      // Создаем обработчик аудио
      const processor = this.audioContext.createScriptProcessor(2048, 1, 1);

      source.connect(processor);
      processor.connect(this.audioContext.destination);

      // Обработка аудио данных
      processor.onaudioprocess = (e) => {
        if (!this.isConnected) return;

        const inputData = e.inputBuffer.getChannelData(0);
        if (this.onVoiceCallback) {
          this.onVoiceCallback(inputData);
        }
      };

      return true;
    } catch (error) {
      console.error("Ошибка подключения:", error);
      return false;
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
    }
    if (this.audioContext) {
      this.audioContext.close();
    }
    this.isConnected = false;
  }

  sendMessage(text) {
    if (this.ws && this.isConnected) {
      this.ws.send(
        JSON.stringify({
          type: "message",
          text: text,
        })
      );
    }
  }

  setMessageCallback(callback) {
    this.onMessageCallback = callback;
  }

  setVoiceCallback(callback) {
    this.onVoiceCallback = callback;
  }
}

export default new VoiceService();
