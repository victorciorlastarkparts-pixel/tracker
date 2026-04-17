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
set "PS1=%SCRIPT_DIR%install-agent.ps1"
set "LOGFILE=%SCRIPT_DIR%install-log.txt"

if not exist "%PS1%" (
  echo ERRO: arquivo install-agent.ps1 nao encontrado em %SCRIPT_DIR%
  pause
  exit /b 1
)

echo Executando instalador do agente...
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -AutoInstallDotNet:$true -ConfigureDefenderExclusions:$true -LogPath "%LOGFILE%" %*
set "EXITCODE=%ERRORLEVEL%"

if not "%EXITCODE%"=="0" (
  echo.
  echo Instalacao falhou com codigo %EXITCODE%.
  echo Revise a saida acima para detalhes.
)

echo.
echo Log salvo em: %LOGFILE%
pause

exit /b %EXITCODE%
