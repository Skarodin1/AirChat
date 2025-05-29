package main

import (
	"log"
	"math"
	"net"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/hraban/opus"
)

const (
	sampleRate    = 48000
	channels      = 1
	frameSize     = 960  // 20ms at 48kHz
	maxPacketSize = 1275 // Максимальный размер пакета Opus

	// Увеличиваем таймауты
	clientTimeout     = 30 * time.Second       // Увеличиваем до 30 секунд
	heartbeatInterval = 5 * time.Second        // Увеличиваем интервал
	maxBufferAge      = 500 * time.Millisecond // Увеличиваем время жизни буфера
)

type Client struct {
	addr         net.Addr
	username     string
	inVoice      bool
	voiceAddr    string
	decoder      *opus.Decoder
	encoder      *opus.Encoder
	lastActivity time.Time
	active       bool
}

// AudioBuffer больше не используется глобально, AudioProcessor управляет этим
// type AudioBuffer struct {
// 	data      []float32
// 	timestamp time.Time
// }

var (
	clients    = make(map[string]*Client)
	clientsMux sync.RWMutex
	// audioBuffers    = make(map[string][]AudioBuffer) // Удалено
	// audioSenders    = make(map[string]string) // Это поле не использовалось, удаляем
	// audioBuffersMux sync.RWMutex // Удалено
	mixInterval = 20 * time.Millisecond
	// audioProcessor будет инициализирован в handleVoiceData
)

// Улучшенная функция микширования аудио с улучшенной обработкой буферов
func mixAudio(buffers [][]float32) []float32 {
	if len(buffers) == 0 {
		return nil
	}

	// Проверяем размеры буферов
	frameLen := len(buffers[0])
	for i, buf := range buffers {
		if len(buf) != frameLen {
			log.Printf("Неверный размер буфера %d: %d (ожидалось %d)", i, len(buf), frameLen)
			return nil
		}
	}

	// Создаем выходной буфер
	mixed := make([]float32, frameLen)

	// Вычисляем коэффициент масштабирования для микширования
	scale := float32(1.0) / float32(len(buffers))

	// Микшируем все буферы с масштабированием
	for _, buf := range buffers {
		for i := range buf {
			mixed[i] += buf[i] * scale
		}
	}

	// Применяем компрессию динамического диапазона
	maxAmplitude := float32(0)
	for _, sample := range mixed {
		if abs := float32(math.Abs(float64(sample))); abs > maxAmplitude {
			maxAmplitude = abs
		}
	}

	// Мягкое ограничение и нормализация
	if maxAmplitude > 1.0 {
		// Применяем кривую мягкого ограничения
		for i := range mixed {
			mixed[i] = float32(math.Tanh(float64(mixed[i])))
		}
	}

	return mixed
}

// AudioProcessor обрабатывает аудиопотоки
type AudioProcessor struct {
	sampleRate int
	channels   int
	frameSize  int
	buffers    map[string][]float32
	mutex      sync.RWMutex
}

func NewAudioProcessor() *AudioProcessor {
	return &AudioProcessor{
		sampleRate: sampleRate,
		channels:   channels,
		frameSize:  frameSize,
		buffers:    make(map[string][]float32),
	}
}

func (ap *AudioProcessor) AddBuffer(clientID string, buffer []float32) {
	ap.mutex.Lock()
	defer ap.mutex.Unlock()

	if len(buffer) != ap.frameSize {
		return
	}
	ap.buffers[clientID] = buffer
}

func (ap *AudioProcessor) RemoveClient(clientID string) {
	ap.mutex.Lock()
	defer ap.mutex.Unlock()
	delete(ap.buffers, clientID)
}

func (ap *AudioProcessor) GetMixedAudioForClient(excludeClientID string) []float32 {
	ap.mutex.RLock()
	defer ap.mutex.RUnlock()

	var buffers [][]float32
	for clientID, buffer := range ap.buffers {
		if clientID != excludeClientID {
			buffers = append(buffers, buffer)
		}
	}

	return mixAudio(buffers)
}

func cleanup(pc, voiceConn net.PacketConn) {
	log.Println("Завершение работы сервера...")

	clientsMux.RLock()
	for _, client := range clients {
		pc.WriteTo([]byte("Сервер завершает работу"), client.addr)
	}
	clientsMux.RUnlock()

	if pc != nil {
		pc.Close()
	}
	if voiceConn != nil {
		voiceConn.Close()
	}
}

// New function to clean up inactive clients
func cleanupInactiveClients(ap *AudioProcessor) { // Передаем AudioProcessor
	ticker := time.NewTicker(clientTimeout / 2)
	defer ticker.Stop()

	for {
		<-ticker.C
		now := time.Now()

		clientsMux.Lock()
		for _, client := range clients {
			// Проверяем только клиентов в войсе
			if !client.inVoice {
				continue
			}

			timeSinceLastActivity := now.Sub(client.lastActivity)
			if timeSinceLastActivity > clientTimeout {
				log.Printf("Отключаем неактивного клиента %s из войса (не было активности %.1f секунд)",
					client.username, timeSinceLastActivity.Seconds())

				// Отключаем только от войса, а не удаляем клиента полностью
				client.inVoice = false
				client.active = false

				ap.RemoveClient(client.username) // Удаляем из AudioProcessor
			} else if timeSinceLastActivity > clientTimeout/2 {
				log.Printf("Предупреждение: клиент %s неактивен в войсе %.1f секунд",
					client.username, timeSinceLastActivity.Seconds())
			}
		}
		clientsMux.Unlock()
	}
}

// New function to send heartbeats
func sendHeartbeats(voiceConn net.PacketConn) {
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	heartbeat := []byte{0} // Single byte heartbeat packet

	for {
		<-ticker.C
		clientsMux.RLock()
		for _, client := range clients {
			if client.inVoice {
				voiceAddr, err := net.ResolveUDPAddr("udp", client.voiceAddr)
				if err == nil {
					voiceConn.WriteTo(heartbeat, voiceAddr)
				}
			}
		}
		clientsMux.RUnlock()
	}
}

func handleVoiceData(voiceConn net.PacketConn) {
	buffer := make([]byte, maxPacketSize)
	audioProcessor := NewAudioProcessor()

	log.Println("Обработчик голосовых данных запущен")

	// Запускаем горутину очистки
	go cleanupInactiveClients(audioProcessor) // Передаем audioProcessor

	// Запускаем горутину для отправки heartbeat
	go sendHeartbeats(voiceConn)

	// Горутина микшера с восстановлением после паники
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("Восстановление после паники микшера: %v", r)
				go handleVoiceData(voiceConn) // Перезапускаем обработчик, передавая тот же voiceConn
			}
		}()

		ticker := time.NewTicker(mixInterval)
		defer ticker.Stop()

		for {
			<-ticker.C

			// audioBuffersMux.Lock() // Удалено, AudioProcessor имеет свой мьютекс
			clientsMux.RLock() // Блокируем для чтения списка клиентов

			// Process each client's audio
			for _, client := range clients {
				if !client.inVoice || client.encoder == nil {
					continue
				}

				// Get mixed audio for this client
				mixed := audioProcessor.GetMixedAudioForClient(client.username)
				if mixed == nil {
					continue
				}

				// Convert to PCM
				pcm := make([]int16, len(mixed))
				for i, sample := range mixed {
					pcm[i] = int16(sample * 32767.0)
				}

				// Encode with Opus
				encoded := make([]byte, maxPacketSize)
				n, err := client.encoder.Encode(pcm, encoded)
				if err != nil {
					continue
				}

				// Send to client
				if n > 0 {
					voiceAddr, err := net.ResolveUDPAddr("udp", client.voiceAddr)
					if err == nil {
						voiceConn.WriteTo(encoded[:n], voiceAddr)
					}
				}
			}

			clientsMux.RUnlock()
			// audioBuffersMux.Unlock() // Удалено
		}
	}()

	// Main audio processing loop
	for {
		n, remoteAddr, err := voiceConn.ReadFrom(buffer)
		if err != nil {
			log.Printf("Error reading voice data: %v", err)
			continue
		}

		// Update client activity
		clientsMux.Lock()
		var sender *Client
		for _, client := range clients {
			if client.voiceAddr == remoteAddr.String() {
				client.lastActivity = time.Now()
				client.active = true
				sender = client
				break
			}
		}

		if sender == nil {
			senderIP := strings.Split(remoteAddr.String(), ":")[0]
			for _, client := range clients {
				if client.inVoice && strings.Split(client.addr.String(), ":")[0] == senderIP {
					client.voiceAddr = remoteAddr.String()
					sender = client
					break
				}
			}
		}

		if sender == nil || !sender.inVoice || sender.decoder == nil {
			clientsMux.Unlock()
			continue
		}

		// Handle heartbeat packets (если они приходят на голосовой порт)
		if n == 1 && buffer[0] == 0 {
			clientsMux.Unlock()
			continue // Пропускаем heartbeat пакеты
		}

		if n > maxPacketSize { // Проверка размера пакета
			clientsMux.Unlock()
			continue
		}

		// Decode audio
		pcm := make([]int16, frameSize)
		samplesDecoded, err := sender.decoder.Decode(buffer[:n], pcm)
		if err != nil || samplesDecoded != frameSize {
			clientsMux.Unlock()
			continue
		}

		// Convert to float32
		floatPCM := make([]float32, frameSize)
		for i, sample := range pcm {
			floatPCM[i] = float32(sample) / 32767.0
		}

		// Add to audio processor
		audioProcessor.AddBuffer(sender.username, floatPCM)
		clientsMux.Unlock()
	}
}

func mainLoop(pc net.PacketConn, voiceConn net.PacketConn, audioProcessor *AudioProcessor) { // Передаем audioProcessor
	for {
		buffer := make([]byte, 4096)
		n, addr, err := pc.ReadFrom(buffer)
		if err != nil {
			log.Printf("Ошибка чтения: %v", err)
			continue
		}

		msg := string(buffer[:n])
		clientKey := addr.String()

		// Обработка нового подключения
		if strings.Contains(msg, " joined the chat") {
			username := strings.Split(msg, " joined the chat")[0]
			clientIP := strings.Split(clientKey, ":")[0]

			// Создаем кодеки Opus
			decoder, err := opus.NewDecoder(sampleRate, channels)
			if err != nil {
				log.Printf("Ошибка создания декодера Opus: %v", err)
				continue
			}

			encoder, err := opus.NewEncoder(sampleRate, channels, opus.AppVoIP)
			if err != nil {
				log.Printf("Ошибка создания энкодера Opus: %v", err)
				continue
			}

			// Настраиваем энкодер для лучшего качества
			encoder.SetBitrate(96000)     // Увеличиваем битрейт до 96 кбит/с
			encoder.SetComplexity(10)     // Максимальное качество
			encoder.SetPacketLossPerc(10) // Уменьшаем ожидаемые потери
			encoder.SetInBandFEC(true)    // Включаем коррекцию ошибок

			clientsMux.Lock()
			clients[clientKey] = &Client{
				addr:         addr,
				username:     username,
				inVoice:      false,
				voiceAddr:    clientIP + ":6001",
				decoder:      decoder,
				encoder:      encoder,
				lastActivity: time.Now(),
				active:       true,
			}
			clientsMux.Unlock()
			log.Printf("✨ Новый клиент: %s (%s) -> %s", username, clientIP, clientIP+":6001")

			// Уведомляем всех о новом пользователе
			clientsMux.RLock()
			for _, client := range clients {
				if client.addr.String() != clientKey {
					pc.WriteTo([]byte(msg), client.addr)
				}
			}
			clientsMux.RUnlock()
			continue
		}

		// Обработка голосовых уведомлений
		if msg == "VOICE_CONNECT" {
			clientsMux.Lock()
			if client, ok := clients[clientKey]; ok {
				client.inVoice = true
				client.lastActivity = time.Now()
				notification := client.username + " подключился к голосовому чату"
				log.Printf("🎤 %s (%s) вошёл в голосовой чат",
					client.username, strings.Split(clientKey, ":")[0])

				// Уведомляем всех о подключении к голосовому чату
				for _, c := range clients {
					pc.WriteTo([]byte(notification), c.addr)
				}
			} else {
				log.Printf("❌ Попытка подключения от неизвестного: %s", clientKey)
			}
			clientsMux.Unlock()
			continue
		}

		if msg == "VOICE_DISCONNECT" {
			clientsMux.Lock()
			if client, ok := clients[clientKey]; ok {
				client.inVoice = false
				audioProcessor.RemoveClient(client.username) // Удаляем из AudioProcessor
				notification := client.username + " отключился от голосового чата"
				log.Printf("🔇 %s (%s) вышел из голосового чата",
					client.username, strings.Split(clientKey, ":")[0])

				// Уведомляем всех об отключении от голосового чата
				for _, c := range clients {
					pc.WriteTo([]byte(notification), c.addr)
				}
			}
			clientsMux.Unlock()
			continue
		}

		// Рассылаем обычные сообщения всем клиентам
		log.Printf("Сообщение от %s: %s", clientKey, msg)
		clientsMux.RLock()
		for _, client := range clients {
			if client.addr.String() != clientKey {
				pc.WriteTo([]byte(msg), client.addr)
			}
		}
		clientsMux.RUnlock()
	}
}

func main() {
	// Создаем канал для обработки сигналов завершения
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	pc, err := net.ListenPacket("udp", ":6000")
	if err != nil {
		log.Fatal("Ошибка запуска сервера:", err)
	}

	voiceConn, err := net.ListenPacket("udp", ":6001")
	if err != nil {
		pc.Close()
		log.Fatal("Ошибка запуска голосового сервера:", err)
	}

	// Отложенная очистка ресурсов
	defer cleanup(pc, voiceConn)

	log.Println("Сервер запущен на порту :6000")
	log.Println("Голосовой сервер запущен на порту :6001")

	audioProcessor := NewAudioProcessor() // Создаем AudioProcessor здесь

	// Запускаем обработку голосовых данных в отдельной горутине
	go handleVoiceData(voiceConn) // AudioProcessor будет создан внутри handleVoiceData

	// Горутина для обработки сигналов завершения
	go func() {
		<-sigChan
		cleanup(pc, voiceConn)
		os.Exit(0)
	}()

	mainLoop(pc, voiceConn, audioProcessor) // Передаем audioProcessor в mainLoop
}
