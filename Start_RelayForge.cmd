@echo off
cd /d "%~dp0"
echo RelayForge v0.1.0 — Local AI Coding Gateway
echo Starting relay on http://127.0.0.1:18765
echo.
echo Clients: Base URL = http://127.0.0.1:18765/v1
echo          API Key  = RELAYFORGE_TOKEN (see startup log)
echo.
node src\server.js
pause
