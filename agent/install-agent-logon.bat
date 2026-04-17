@echo off
setlocal EnableExtensions

rem Auto-elevate to Administrator if needed.
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Solicitando permissao de Administrador...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
  exit /b
)

set "SCRIPT_DIR=%~dp0"
set "PS1=%SCRIPT_DIR%install-agent-logon.ps1"
set "LOGFILE=%SCRIPT_DIR%install-logon-log.txt"

if not exist "%PS1%" (
  echo ERRO: arquivo install-agent-logon.ps1 nao encontrado em %SCRIPT_DIR%
  pause
  exit /b 1
)

echo Executando instalador do agente (modo logon)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -AutoInstallDotNet:$true -ConfigureDefenderExclusions:$true -LogPath "%LOGFILE%" %*
set "EXITCODE=%ERRORLEVEL%"

echo.
echo Log salvo em: %LOGFILE%
if not "%EXITCODE%"=="0" (
  echo Instalacao falhou com codigo %EXITCODE%.
) else (
  echo Instalacao concluida.
)
pause

exit /b %EXITCODE%
