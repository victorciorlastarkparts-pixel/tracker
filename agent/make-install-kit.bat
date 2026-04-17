@echo off
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
set "PS1=%SCRIPT_DIR%make-install-kit.ps1"

if not exist "%PS1%" (
  echo ERRO: make-install-kit.ps1 nao encontrado em %SCRIPT_DIR%
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" (
  echo Falha ao gerar kit (%EXITCODE%).
) else (
  echo Kit gerado com sucesso.
)
pause
exit /b %EXITCODE%
