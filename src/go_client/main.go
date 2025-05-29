package main

import (
	"bufio"
	"fmt"
	"math"
	"net"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gordonklaus/portaudio"
	"github.com/hraban/opus"
)

const (
	sampleRate       = 48000
	channels         = 1
	frameSize        = 960  // 20мс при 48кГц
	maxBytes         = 1275 // Максимальный размер пакета Opus
	jitterBufferSize = 20   // 400мс буфер для большей стабильности
	noiseThreshold   = 0.02 // Порог шумоподавления (возможно, стоит также пересмотреть)

	// Константы обработки аудио
	vadThreshold         = 0.005 // Порог определения голосовой активности
	softGateFactor       = 0.1   // Коэффициент ослабления для мягкого гейта
	gainFactor           = 1.2   // Небольшое усиление для слабых сигналов
	compressionThreshold = 0.8   // Порог для компрессии динамического диапазона
	vadHangoverTimeMs    = 150   // Время удержания VAD в миллисекундах

	// Константы буферизации
	inputBufferMultiplier = 3 // Размер входного буфера относительно frameSize
	minBufferThreshold    = 7 // Минимальное количество фреймов для начала воспроизведения
)

var (
	voiceConn     *net.UDPConn
	stopAudio     chan struct{}
	audioWg       sync.WaitGroup
	paInitialized bool = false

	// Вычисляем количество кадров для удержания VAD
	// Длительность одного фрейма = frameSize / sampleRate = 960 / 48000 = 0.02 сек = 20 мс
	vadHangoverFrames = vadHangoverTimeMs / 20
)

type AudioState struct {
	inputStream     *portaudio.Stream
	outputStream    *portaudio.Stream
	buffer          *AudioBuffer
	lastLogTime     time.Time
	packetsReceived int
	bytesReceived   int64
	samplesDecoded  int
	samplesPlayed   int
}

type AudioBuffer struct {
	InputBuffer   []float32
	OutputBuffer  []float32
	OpusInputBuf  []int16
	OpusOutputBuf []int16
	Encoder       *opus.Encoder
	Decoder       *opus.Decoder
	JitterBuffer  [][]float32 // Буфер для сглаживания воспроизведения
}

// JitterBuffer управляет временем пакетов аудио
type JitterBuffer struct {
	buffer    [][]float32
	maxSize   int
	frameSize int
	mutex     sync.RWMutex
}

func NewJitterBuffer(size int, frameSize int) *JitterBuffer {
	return &JitterBuffer{
		buffer:    make([][]float32, 0, size),
		maxSize:   size,
		frameSize: frameSize,
	}
}

func (jb *JitterBuffer) Add(data []float32) {
	jb.mutex.Lock()
	defer jb.mutex.Unlock()

	if len(jb.buffer) >= jb.maxSize {
		// Буфер полон, удаляем самый старый фрейм
		jb.buffer = jb.buffer[1:]
	}

	// Создаем копию данных
	frame := make([]float32, len(data))
	copy(frame, data)

	jb.buffer = append(jb.buffer, frame)
}

func (jb *JitterBuffer) Get() []float32 {
	jb.mutex.Lock()
	defer jb.mutex.Unlock()

	if len(jb.buffer) == 0 {
		return make([]float32, jb.frameSize) // Возвращаем тишину если буфер пуст
	}

	// Получаем самый старый фрейм
	frame := jb.buffer[0]
	jb.buffer = jb.buffer[1:]
	return frame
}

func (jb *JitterBuffer) Available() int {
	jb.mutex.RLock()
	defer jb.mutex.RUnlock()
	return len(jb.buffer)
}

// Enhanced audio processing
type AudioProcessor struct {
	vadEnabled           bool
	lastVadState         bool
	energyThreshold      float32
	smoothingFactor      float32
	noiseFloor           float32
	framesSinceLastVoice int // Счетчик кадров с момента последнего обнаружения голоса
	vadHangoverFrames    int // Количество кадров для удержания VAD
}

func NewAudioProcessor() *AudioProcessor {
	return &AudioProcessor{
		vadEnabled:           true,
		lastVadState:         false,
		energyThreshold:      vadThreshold,
		smoothingFactor:      0.95,
		noiseFloor:           0.001,
		framesSinceLastVoice: 0,                 // Инициализация счетчика
		vadHangoverFrames:    vadHangoverFrames, // Инициализация из вычисленной глобальной переменной
	}
}

func (ap *AudioProcessor) ProcessInput(buffer []float32) []float32 {
	// Создаем копию входного буфера
	processed := make([]float32, len(buffer))
	copy(processed, buffer)

	// Вычисляем энергию сигнала
	energy := float32(0)
	for _, sample := range processed {
		energy += sample * sample
	}
	energy /= float32(len(processed))

	// Определение голосовой активности
	if energy > ap.energyThreshold {
		ap.framesSinceLastVoice = 0 // Голос есть, сбрасываем счетчик
	} else {
		ap.framesSinceLastVoice++ // Голоса нет, увеличиваем счетчик
	}

	// Мягкий гейт с учетом времени удержания
	if ap.framesSinceLastVoice > ap.vadHangoverFrames {
		for i := range processed {
			processed[i] *= softGateFactor // Ослабляем сигнал, а не обнуляем
		}
		return processed
	}

	// Фильтр высоких частот (пропускаем только частоты выше определенного порога)
	applyHighPassFilter(processed)

	// Динамическая компрессия диапазона (уменьшение разницы между самыми тихими и громкими звуками)
	ap.applyCompression(processed)

	// Финальная нормализация амплитуды (приведение громкости к стандартному уровню)
	normalizeAmplitude(processed)

	return processed
}

func (ap *AudioProcessor) applyCompression(buffer []float32) {
	// Find peak amplitude
	peak := float32(0)
	for _, sample := range buffer {
		if abs := float32(math.Abs(float64(sample))); abs > peak {
			peak = abs
		}
	}

	if peak > compressionThreshold {
		ratio := compressionThreshold / peak
		for i := range buffer {
			buffer[i] *= ratio
		}
	}
}

func float32ToInt16(float32Buf []float32) []int16 {
	int16Buf := make([]int16, len(float32Buf))
	for i, f := range float32Buf {
		// Convert float32 [-1.0,1.0] to int16
		s := f * 32767.0
		if s > 32767.0 {
			s = 32767.0
		} else if s < -32767.0 {
			s = -32767.0
		}
		int16Buf[i] = int16(s)
	}
	return int16Buf
}

func int16ToFloat32(int16Buf []int16) []float32 {
	float32Buf := make([]float32, len(int16Buf))
	for i, s := range int16Buf {
		// Convert int16 to float32 [-1.0,1.0]
		float32Buf[i] = float32(s) / 32767.0
	}
	return float32Buf
}

func initPortAudio() error {
	if !paInitialized {
		if err := portaudio.Initialize(); err != nil {
			return fmt.Errorf("failed to initialize portaudio: %v", err)
		}
		paInitialized = true
	}
	return nil
}

func terminatePortAudio() {
	if paInitialized {
		portaudio.Terminate()
		paInitialized = false
	}
}

// Функция для фильтрации низких частот
func applyHighPassFilter(buf []float32) {
	rc := 1.0 / (2 * math.Pi * 100.0) // Частота среза 100 Гц
	dt := 1.0 / float64(sampleRate)
	alpha := float32(rc / (rc + dt))
	prev := float32(0)
	for i := range buf {
		buf[i] = alpha * (prev + buf[i] - prev)
		prev = buf[i]
	}
}

// Функция для нормализации амплитуды
func normalizeAmplitude(buf []float32) {
	max := float32(0)
	for _, s := range buf {
		if abs := float32(math.Abs(float64(s))); abs > max {
			max = abs
		}
	}

	if max > 1.0 {
		scale := 1.0 / max
		for i := range buf {
			buf[i] *= float32(scale)
		}
	}
}

func initAudio() (*AudioBuffer, error) {
	encoder, err := opus.NewEncoder(sampleRate, channels, opus.AppVoIP)
	if err != nil {
		return nil, fmt.Errorf("failed to create encoder: %v", err)
	}

	// Оптимальные настройки для голосового чата
	encoder.SetBitrate(32000)     // 32 kbps для голоса
	encoder.SetComplexity(8)      // Баланс между качеством и нагрузкой
	encoder.SetInBandFEC(true)    // Включаем коррекцию ошибок
	encoder.SetPacketLossPerc(30) // Агрессивная коррекция ошибок

	decoder, err := opus.NewDecoder(sampleRate, channels)
	if err != nil {
		return nil, fmt.Errorf("failed to create decoder: %v", err)
	}

	return &AudioBuffer{
		InputBuffer:   make([]float32, frameSize),
		OutputBuffer:  make([]float32, frameSize),
		OpusInputBuf:  make([]int16, frameSize),
		OpusOutputBuf: make([]int16, frameSize),
		Encoder:       encoder,
		Decoder:       decoder,
		JitterBuffer:  make([][]float32, 0, jitterBufferSize),
	}, nil
}

func startAudioStream(conn *net.UDPConn, buffer *AudioBuffer) error {
	// Увеличиваем буферы UDP
	conn.SetWriteBuffer(32768) // Увеличиваем буфер отправки
	conn.SetReadBuffer(32768)  // Увеличиваем буфер приема

	audioState := &AudioState{
		buffer:      buffer,
		lastLogTime: time.Now(),
	}

	// Проверяем UDP соединение
	remoteAddr := conn.RemoteAddr().(*net.UDPAddr)
	fmt.Printf("Голосовое соединение установлено с %s\n", remoteAddr.String())

	fmt.Println("Инициализация аудиопотоков...")

	defaultOutputDevice, err := portaudio.DefaultOutputDevice()
	if err != nil {
		return fmt.Errorf("ошибка получения устройства вывода по умолчанию: %v", err)
	}
	fmt.Printf("Используется устройство вывода: %s\n", defaultOutputDevice.Name)

	defaultInputDevice, err := portaudio.DefaultInputDevice()
	if err != nil {
		return fmt.Errorf("ошибка получения устройства ввода по умолчанию: %v", err)
	}
	fmt.Printf("Используется устройство ввода: %s\n", defaultInputDevice.Name)

	// Открываем входной поток (микрофон)
	inputStreamParams := portaudio.StreamParameters{
		Input: portaudio.StreamDeviceParameters{
			Device:   defaultInputDevice,
			Channels: channels,
			Latency:  defaultInputDevice.DefaultLowInputLatency,
		},
		Output: portaudio.StreamDeviceParameters{
			Channels: 0,
		},
		SampleRate:      float64(sampleRate),
		FramesPerBuffer: frameSize,
	}

	audioState.inputStream, err = portaudio.OpenStream(inputStreamParams, buffer.InputBuffer)
	if err != nil {
		return fmt.Errorf("failed to open input stream: %v", err)
	}

	// Открываем выходной поток (динамики)
	outputStreamParams := portaudio.StreamParameters{
		Input: portaudio.StreamDeviceParameters{
			Channels: 0,
		},
		Output: portaudio.StreamDeviceParameters{
			Device:   defaultOutputDevice,
			Channels: channels,
			Latency:  defaultOutputDevice.DefaultLowOutputLatency,
		},
		SampleRate:      float64(sampleRate),
		FramesPerBuffer: frameSize,
	}

	audioState.outputStream, err = portaudio.OpenStream(outputStreamParams, buffer.OutputBuffer)
	if err != nil {
		audioState.inputStream.Close()
		return fmt.Errorf("failed to open output stream: %v", err)
	}

	if err := audioState.inputStream.Start(); err != nil {
		audioState.inputStream.Close()
		audioState.outputStream.Close()
		return fmt.Errorf("failed to start input stream: %v", err)
	}

	if err := audioState.outputStream.Start(); err != nil {
		audioState.inputStream.Stop()
		audioState.inputStream.Close()
		audioState.outputStream.Close()
		return fmt.Errorf("failed to start output stream: %v", err)
	}

	fmt.Println("✅ Аудиопотоки инициализированы")

	// Инициализируем аудио процессор и джиттер буфер
	processor := NewAudioProcessor()
	jitterBuffer := NewJitterBuffer(jitterBufferSize, frameSize)

	// Модифицируем горутину записи
	audioWg.Add(1)
	go func() {
		defer audioWg.Done()
		defer audioState.inputStream.Stop()
		defer audioState.inputStream.Close()

		inputAccumulator := make([]float32, 0, frameSize*inputBufferMultiplier)
		encodedData := make([]byte, maxBytes)

		for {
			select {
			case <-stopAudio:
				return
			default:
				err := audioState.inputStream.Read()
				if err != nil {
					time.Sleep(10 * time.Millisecond)
					continue
				}

				// Накапливаем данные
				inputAccumulator = append(inputAccumulator, buffer.InputBuffer...)

				// Обрабатываем только если накопили достаточно данных
				for len(inputAccumulator) >= frameSize {
					// Копируем frameSize сэмплов
					copy(buffer.InputBuffer, inputAccumulator[:frameSize])

					// Сдвигаем буфер
					inputAccumulator = append(inputAccumulator[:0], inputAccumulator[frameSize:]...)

					// Обрабатываем входной звук
					processed := processor.ProcessInput(buffer.InputBuffer)

					// Конвертируем и кодируем
					opusData := float32ToInt16(processed)
					n, err := buffer.Encoder.Encode(opusData, encodedData)
					if err == nil && n > 0 && n <= maxBytes {
						conn.Write(encodedData[:n])
					}
				}

				time.Sleep(5 * time.Millisecond)
			}
		}
	}()

	// Добавляем горутину для отправки heartbeat
	audioWg.Add(1)
	go func() {
		defer audioWg.Done()
		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()

		heartbeat := []byte{0}
		for {
			select {
			case <-stopAudio:
				return
			case <-ticker.C:
				conn.Write(heartbeat)
			}
		}
	}()

	// Модифицируем горутину воспроизведения
	audioWg.Add(1)
	go func() {
		defer audioWg.Done()
		defer audioState.outputStream.Stop()
		defer audioState.outputStream.Close()

		receiveBuf := make([]byte, maxBytes)

		for {
			select {
			case <-stopAudio:
				return
			default:
				conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
				n, _, err := conn.ReadFromUDP(receiveBuf)
				if err != nil {
					if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
						continue
					}
					continue
				}

				// Пропускаем heartbeat пакеты
				if n == 1 && receiveBuf[0] == 0 {
					continue
				}

				// Декодируем полученные данные
				samplesRead, err := buffer.Decoder.Decode(receiveBuf[:n], buffer.OpusOutputBuf)
				if err != nil || samplesRead != frameSize {
					continue
				}

				// Конвертируем в float32
				audioFloat := int16ToFloat32(buffer.OpusOutputBuf)

				// Обрабатываем выходной звук
				processed := processor.ProcessInput(audioFloat)

				// Добавляем в джиттер буфер
				jitterBuffer.Add(processed)

				// Воспроизводим только если есть достаточно данных в джиттер-буфере
				if jitterBuffer.Available() >= minBufferThreshold {
					// Получаем следующий фрейм из джиттер буфера
					playbackData := jitterBuffer.Get()

					// Копируем в выходной буфер PortAudio
					copy(buffer.OutputBuffer, playbackData)

					// Воспроизводим
					err = audioState.outputStream.Write()
					if err != nil {
						// Можно добавить логирование ошибки записи, если это происходит часто
						// log.Printf("Ошибка записи в аудиопоток: %v", err)
						continue
					}
				}
			}
		}
	}()

	return nil
}

func main() {
	// Инициализируем PortAudio в начале программы
	if err := initPortAudio(); err != nil {
		fmt.Printf("Ошибка инициализации PortAudio: %v\n", err)
		return
	}
	// Гарантируем завершение работы PortAudio при выходе
	defer terminatePortAudio()

	reader := bufio.NewReader(os.Stdin)

	// Запрашиваем IP сервера
	fmt.Print("Введите IP сервера (или нажмите Enter для localhost): ")
	serverIP, _ := reader.ReadString('\n')
	serverIP = strings.TrimSpace(serverIP)
	if serverIP == "" {
		serverIP = "127.0.0.1"
	}

	// Запрашиваем имя пользователя
	fmt.Print("Введите ваше имя: ")
	username, _ := reader.ReadString('\n')
	username = strings.TrimSpace(username)
	for username == "" {
		fmt.Print("Имя не может быть пустым. Введите ваше имя: ")
		username, _ = reader.ReadString('\n')
		username = strings.TrimSpace(username)
	}

	serverAddr, err := net.ResolveUDPAddr("udp", serverIP+":6000")
	if err != nil {
		fmt.Println("Ошибка разрешения адреса:", err)
		return
	}

	conn, err := net.DialUDP("udp", nil, serverAddr)
	if err != nil {
		fmt.Println("Ошибка подключения:", err)
		return
	}
	defer conn.Close()

	// Отправляем сообщение о подключении
	_, err = conn.Write([]byte(username + " joined the chat"))
	if err != nil {
		fmt.Println("Ошибка отправки:", err)
		return
	}

	// Горутина для чтения входящих сообщений
	go func() {
		buffer := make([]byte, 4096)
		for {
			n, _, err := conn.ReadFromUDP(buffer)
			if err != nil {
				fmt.Println("Ошибка чтения:", err)
				return
			}
			fmt.Printf("\r%s\n> ", string(buffer[:n]))
		}
	}()

	fmt.Println("\nДоступные команды:")
	fmt.Println("/voice - подключиться к голосовому чату")
	fmt.Println("/leave - отключиться от голосового чата")
	fmt.Println("/exit - выйти из чата")
	fmt.Println("Любой другой текст будет отправлен как сообщение")

	// Чтение ввода пользователя
	fmt.Print("> ")
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		text := scanner.Text()

		switch text {
		case "/voice":
			if voiceConn == nil {
				// Проверяем, что PortAudio инициализирован
				if !paInitialized {
					if err := initPortAudio(); err != nil {
						fmt.Printf("Ошибка инициализации PortAudio: %v\n", err)
						continue
					}
				}

				// Подключаемся к голосовому чату
				voiceAddr, err := net.ResolveUDPAddr("udp", serverIP+":6001")
				if err != nil {
					fmt.Println("Ошибка разрешения голосового адреса:", err)
					continue
				}
				voiceConn, err = net.DialUDP("udp", nil, voiceAddr)
				if err != nil {
					fmt.Println("Ошибка подключения к голосовому чату:", err)
					continue
				}

				// Инициализируем аудио
				audioBuffer, err := initAudio()
				if err != nil {
					fmt.Printf("Ошибка инициализации аудио: %v\n", err)
					voiceConn.Close()
					voiceConn = nil
					continue
				}

				// Создаем канал для остановки аудио
				stopAudio = make(chan struct{})

				// Запускаем аудио потоки
				err = startAudioStream(voiceConn, audioBuffer)
				if err != nil {
					fmt.Printf("Ошибка запуска аудио потока: %v\n", err)
					voiceConn.Close()
					voiceConn = nil
					continue
				}

				// Отправляем уведомление о подключении к голосовому чату
				conn.Write([]byte("VOICE_CONNECT"))
				fmt.Println("Вы подключились к голосовому чату")
			} else {
				fmt.Println("Вы уже подключены к голосовому чату")
			}

		case "/leave":
			if voiceConn != nil {
				// Останавливаем аудио потоки
				close(stopAudio)
				audioWg.Wait()

				// Отправляем уведомление об отключении от голосового чата
				conn.Write([]byte("VOICE_DISCONNECT"))
				voiceConn.Close()
				voiceConn = nil
				fmt.Println("Вы отключились от голосового чата")
			} else {
				fmt.Println("Вы не подключены к голосовому чату")
			}

		case "/exit":
			if voiceConn != nil {
				// Останавливаем аудио потоки
				close(stopAudio)
				audioWg.Wait()

				conn.Write([]byte("VOICE_DISCONNECT"))
				voiceConn.Close()
			}
			return

		default:
			// Отправляем обычное сообщение
			_, err := conn.Write([]byte("[" + username + "]: " + text))
			if err != nil {
				fmt.Println("Ошибка отправки:", err)
				return
			}
		}
		fmt.Print("> ")
	}
}
