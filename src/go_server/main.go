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
	
	// Заменяем старый буфер новым
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
	
	if len(buffers) > 0 {
		return mixAudio(buffers)
	}

	return nil
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
	
	// Счетчики для статистики
	var packetsReceived int64
	var packetsProcessed int64
	var packetsSent int64 // Добавляем счетчик отправленных пакетов
	var lastStatsTime = time.Now()

	// Запускаем горутину очистки
	go cleanupInactiveClients(audioProcessor) // Передаем audioProcessor

	// Запускаем горутину для отправки heartbeat
	go sendHeartbeats(voiceConn)
	
	// Горутина для периодических логов статистики
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		
		for {
			<-ticker.C
			
			clientsMux.RLock()
			voiceClientsCount := 0
			for _, client := range clients {
				if client.inVoice && client.active {
					voiceClientsCount++
				}
			}
			clientsMux.RUnlock()
			
			currentTime := time.Now()
			duration := currentTime.Sub(lastStatsTime).Seconds()
			packetsPerSec := float64(packetsReceived) / duration
			processedPerSec := float64(packetsProcessed) / duration
			sentPerSec := float64(packetsSent) / duration
			
			if voiceClientsCount > 0 {
				log.Printf("🎙️ Голосовой чат: %d активных клиентов | Получено: %.1f пак/сек | Обработано: %.1f пак/сек | Отправлено: %.1f пак/сек", 
					voiceClientsCount, packetsPerSec, processedPerSec, sentPerSec)
			}
			
			// Сбрасываем счетчики
			packetsReceived = 0
			packetsProcessed = 0
			packetsSent = 0
			lastStatsTime = currentTime
		}
	}()

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

			clientsMux.RLock() // Блокируем для чтения списка клиентов

			// Получаем список всех клиентов в голосовом чате
			var voiceClients []*Client
			for _, client := range clients {
				if client.inVoice && client.encoder != nil {
					voiceClients = append(voiceClients, client)
				}
			}
			clientsMux.RUnlock()

			// Если нет клиентов в войсе, очищаем буферы и продолжаем
			if len(voiceClients) == 0 {
				audioProcessor.mutex.Lock()
				audioProcessor.buffers = make(map[string][]float32)
				audioProcessor.mutex.Unlock()
				continue
			}

			// Проверяем количество буферов для отладки
			audioProcessor.mutex.RLock()
			bufferCount := len(audioProcessor.buffers)
			audioProcessor.mutex.RUnlock()
			
			// Пропускаем цикл если нет буферов для обработки
			if bufferCount == 0 {
				continue
			}

			// Процессируем аудио для каждого клиента
			for _, client := range voiceClients {
				var mixed []float32
				
				// ПЕРЕКРЕСТНОЕ ВОСПРОИЗВЕДЕНИЕ: клиент слышит ДРУГИХ, не себя
				audioProcessor.mutex.RLock()
				for clientID, clientBuffer := range audioProcessor.buffers {
					if clientID != client.username { // Исключаем самого клиента
						if mixed == nil {
							mixed = make([]float32, len(clientBuffer))
							copy(mixed, clientBuffer)
						} else {
							// Микшируем если несколько источников
							for i := range mixed {
								mixed[i] = (mixed[i] + clientBuffer[i]) * 0.5
							}
						}
					}
				}
				audioProcessor.mutex.RUnlock()
				
				// Если нет данных от других клиентов, отправляем тишину
				if mixed == nil {
					mixed = make([]float32, frameSize)
				}

				// Convert to PCM
				pcm := make([]int16, len(mixed))
				for i, sample := range mixed {
					// Ограничиваем диапазон значений
					if sample > 1.0 {
						sample = 1.0
					} else if sample < -1.0 {
						sample = -1.0
					}
					pcm[i] = int16(sample * 32767.0)
				}

				// Encode with Opus
				encoded := make([]byte, maxPacketSize)
				n, err := client.encoder.Encode(pcm, encoded)
				if err != nil {
					log.Printf("❌ Ошибка кодирования Opus для %s: %v", client.username, err)
					continue
				}

				// Send to client
				if n > 0 {
					// Отправляем данные без шифрования
					voiceAddr, err := net.ResolveUDPAddr("udp", client.voiceAddr)
					if err == nil {
						_, writeErr := voiceConn.WriteTo(encoded[:n], voiceAddr)
						if writeErr != nil {
							log.Printf("❌ Ошибка отправки пакета %s: %v", client.username, writeErr)
						} else {
							packetsSent++
						}
					} else {
						log.Printf("❌ Ошибка разрешения адреса %s: %v", client.voiceAddr, err)
					}
				} else {
					log.Printf("⚠️ Кодировщик вернул 0 байт для %s", client.username)
				}
			}
		}
	}()

	// Main audio processing loop
	for {
		n, remoteAddr, err := voiceConn.ReadFrom(buffer)
		if err != nil {
			log.Printf("Error reading voice data: %v", err)
			continue
		}
		
		packetsReceived++

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
		
		// Декодируем полученные данные без расшифровки
		samplesDecoded, err := sender.decoder.Decode(buffer[:n], pcm)
		if err != nil {
			log.Printf("❌ Ошибка декодирования Opus для %s: %v (размер: %d)", 
				sender.username, err, len(buffer[:n]))
			clientsMux.Unlock()
			continue
		}
		
		if samplesDecoded != frameSize {
			log.Printf("⚠️ Неверное количество образцов для %s: получено %d, ожидалось %d", 
				sender.username, samplesDecoded, frameSize)
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
		packetsProcessed++
		
		clientsMux.Unlock()
	}
}

func mainLoop(pc net.PacketConn, voiceConn net.PacketConn, audioProcessor *AudioProcessor) { // Передаем audioProcessor
	log.Println("🚀 Главный цикл сервера запущен, ожидаем подключения...")
	
	for {
		buffer := make([]byte, 12*1024*1024) // Увеличиваем буфер до 12MB для изображений
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
			
			// Сначала отправляем новому пользователю список существующих участников
			for _, existingClient := range clients {
				joinMessage := existingClient.username + " joined the chat"
				pc.WriteTo([]byte(joinMessage), addr)
				log.Printf("📋 Отправляем новому пользователю %s информацию об участнике: %s", username, existingClient.username)
				
				// Если существующий участник в голосовом чате, тоже уведомляем
				if existingClient.inVoice {
					voiceMessage := existingClient.username + " подключился к голосовому чату"
					pc.WriteTo([]byte(voiceMessage), addr)
					log.Printf("🎤 Отправляем новому пользователю %s информацию о голосовом участнике: %s", username, existingClient.username)
				}
			}
			
			// Теперь добавляем нового клиента
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

			// Уведомляем всех остальных о новом пользователе
			clientsMux.RLock()
			for _, client := range clients {
				// Не отправляем самому себе
				if client.addr.String() != addr.String() {
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
		
		// Проверяем, является ли это сообщением с изображением
		if strings.Contains(msg, "]: IMAGE_DATA:") {
			log.Printf("📷 Обрабатываем изображение от %s, размер: %d байт", clientKey, len(msg))
		}
		
		clientsMux.RLock()
		for _, client := range clients {
			pc.WriteTo([]byte(msg), client.addr)
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
		log.Fatalf("Ошибка запуска сервера: %v", err)
	}
	defer pc.Close()

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

