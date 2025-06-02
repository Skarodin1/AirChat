@echo off
echo Пересборка Go клиента...
cd src\go_client
go build -o ..\..\bin\client.exe main.go
echo Готово!
pause 