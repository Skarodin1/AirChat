package main

import (
	"bufio"
	"fmt"
	"net"
	"os"
)

func main() {
	serverAddr, err := net.ResolveUDPAddr("udp", "26.131.44.133:6000")
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

	// Горутина для получения сообщений
	go func() {
		buffer := make([]byte, 4096)
		for {
			n, _, err := conn.ReadFromUDP(buffer)
			if err != nil {
				fmt.Println("Ошибка чтения:", err)
				return
			}
			fmt.Printf("\nСообщение: %s\n> ", string(buffer[:n]))
		}
	}()

	// Отправка сообщений с клавиатуры
	scanner := bufio.NewScanner(os.Stdin)
	fmt.Print("> ")
	for scanner.Scan() {
		text := scanner.Text()
		if text == "exit" {
			fmt.Println("Выход из чата")
			break
		}
		_, err := conn.Write([]byte(text))
		if err != nil {
			fmt.Println("Ошибка отправки:", err)
			return
		}
		fmt.Print("> ")
	}

	if err := scanner.Err(); err != nil {
		fmt.Println("Ошибка ввода:", err)
	}
}
