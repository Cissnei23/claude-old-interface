@echo off
cd /d "%~dp0"
echo Opening Claude local app...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$url='http://127.0.0.1:8780'; try { Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 1 ^| Out-Null } catch { Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory '%~dp0' -WindowStyle Hidden; Start-Sleep -Milliseconds 1200 }; Start-Process $url"
if errorlevel 1 (
  echo Could not start the app. Make sure Node.js and Claude Code are installed.
  pause
)
