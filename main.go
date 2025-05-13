package main

import (
	"log"
	"net"
)

func main() {
	pc, err := net.ListenPacket("udp", ":6000")
	if err != nil {
		log.Fatal("Ошибка запуска сервера:", err)
	}
	defer pc.Close()
	log.Println("Сервер запущен на :6000")
	clients := make(map[string]net.Addr)
	buffer := make([]byte, 4096)

	for {
		n, addr, err := pc.ReadFrom(buffer)
		if err != nil {
			log.Printf("Ошибка чтения: %v", err)
			continue
		}
		clientKey := addr.String()
		if _, exists := clients[clientKey]; !exists {
			clients[clientKey] = addr
			log.Printf("Новый клиент: %s", clientKey)
		}
		for key, clientAddr := range clients {
			if key != clientKey {
				pc.WriteTo(buffer[:n], clientAddr)
			}
		}
	}
}
