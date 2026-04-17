param(
  [string]$OutputDir = '',
  [string]$Runtime = 'win-x64'
)

$ErrorActionPreference = 'Stop'

$projectPath = Join-Path $PSScriptRoot 'MonitorGate.Agent\MonitorGate.Agent.csproj'
if (-not (Test-Path $projectPath)) {
  throw "Projeto nao encontrado: $projectPath"
}

if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $OutputDir = Join-Path $PSScriptRoot '_InstallKit'
}

$tempPublish = Join-Path $PSScriptRoot '_kit-temp-publish'

if (Test-Path $tempPublish) {
  Remove-Item $tempPublish -Recurse -Force
}
if (Test-Path $OutputDir) {
  Remove-Item $OutputDir -Recurse -Force
}

Write-Host 'Publicando binario self-contained para o kit...'
dotnet restore $projectPath -r $Runtime
if ($LASTEXITCODE -ne 0) {
  throw "Falha no dotnet restore (codigo $LASTEXITCODE)."
}

dotnet publish $projectPath -c Release -r $Runtime --self-contained true -p:PublishSingleFile=true --no-restore -o $tempPublish
if ($LASTEXITCODE -ne 0) {
  throw "Falha no dotnet publish (codigo $LASTEXITCODE)."
}

$payloadDir = Join-Path $OutputDir 'payload'
New-Item -ItemType Directory -Path $payloadDir -Force | Out-Null
Copy-Item -Path (Join-Path $tempPublish '*') -Destination $payloadDir -Recurse -Force

$installPs1 = @'
param(
  [Parameter(Mandatory = $true)]
  [string]$ApiBaseUrl,

  [Parameter(Mandatory = $true)]
  [string]$ApiToken,

  [string]$UserId = 'endmin-root',
  [string]$DeviceName = $env:COMPUTERNAME,
  [int]$PollIntervalMs = 1000,
  [int]$ForegroundSliceSeconds = 2,
  [int]$IdleThresholdSeconds = 40,
  [int]$SyncIntervalSeconds = 120,
  [int]$BatchSize = 300,
  [bool]$SendFullUrl = $false,
  [bool]$ConfigureDefenderExclusions = $true,
  [string]$TaskName = 'MonitorGateAgent-Logon',
  [string]$LogPath = ''
)

$ErrorActionPreference = 'Stop'

$payloadDir = Join-Path $PSScriptRoot 'payload'
$installDir = Join-Path $env:ProgramFiles 'MonitorGateAgent'
$exePath = Join-Path $installDir 'MonitorGate.Agent.exe'
$appSettingsPath = Join-Path $installDir 'appsettings.json'

function Stop-AgentProcesses {
  try {
    Get-Process -Name 'MonitorGate.Agent' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  } catch {
  }
}

function Unblock-PublishedFiles {
  param([string]$FolderPath)

  if (-not (Test-Path $FolderPath)) {
    return
  }

  Get-ChildItem -Path $FolderPath -Recurse -File | ForEach-Object {
    try {
      Unblock-File -Path $_.FullName -ErrorAction Stop
    }
    catch {
    }
  }
}

function Ensure-DefenderExclusions {
  param(
    [string]$InstallDirectory,
    [string]$ExecutablePath
  )

  if (-not $ConfigureDefenderExclusions) {
    return
  }

  $addMpPreference = Get-Command Add-MpPreference -ErrorAction SilentlyContinue
  if ($null -eq $addMpPreference) {
    Write-Warning 'Add-MpPreference nao disponivel. Pulando exclusoes do Windows Security.'
    return
  }

  try {
    Add-MpPreference -ExclusionPath $InstallDirectory -ErrorAction Stop
    Add-MpPreference -ExclusionProcess $ExecutablePath -ErrorAction Stop
    Write-Host 'Exclusoes do Windows Security aplicadas com sucesso.'
  }
  catch {
    Write-Warning "Nao foi possivel aplicar exclusoes automaticamente: $($_.Exception.Message)"
  }
}

function Start-AgentBestEffort {
  param(
    [string]$ExecutablePath,
    [string]$TaskPath,
    [string]$TaskName
  )

  try {
    Start-Process -FilePath $ExecutablePath -WindowStyle Hidden -ErrorAction Stop
    Write-Host 'Agente iniciado na sessao atual.'
    return
  }
  catch {
    Write-Warning "Nao foi possivel iniciar o agente diretamente: $($_.Exception.Message)"
  }

  try {
    $cmdLine = "`"$ExecutablePath`""
    Start-Process -FilePath cmd.exe -ArgumentList '/c', 'start', '""', $cmdLine -WindowStyle Hidden -ErrorAction Stop
    Write-Host 'Agente iniciado via cmd.exe.'
    return
  }
  catch {
    Write-Warning "Nao foi possivel iniciar via cmd.exe: $($_.Exception.Message)"
  }

  try {
    Start-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction Stop
    Write-Host 'Agente iniciado via tarefa agendada.'
  }
  catch {
    Write-Warning "Falha ao iniciar via tarefa agendada: $($_.Exception.Message)"
    Write-Warning 'Instalacao concluida, mas o inicio imediato falhou. O agente iniciara no proximo logon.'
  }
}

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)

if (-not $isAdmin) {
  throw 'Permissao de Administrador obrigatoria. Execute o install.bat (auto-elevacao).'
}

if (-not (Test-Path $payloadDir)) {
  throw "Payload nao encontrado: $payloadDir"
}

if ([string]::IsNullOrWhiteSpace($LogPath)) {
  $LogPath = Join-Path $PSScriptRoot 'install-log.txt'
}

if (Test-Path $LogPath) {
  Remove-Item $LogPath -Force
}

Start-Transcript -Path $LogPath -Force | Out-Null

try {
  $taskPath = '\MonitorGate\'

  $legacyService = Get-Service -Name 'MonitorGateAgent' -ErrorAction SilentlyContinue
  if ($null -ne $legacyService) {
    Write-Host 'Servico legado encontrado. Removendo...'
    sc.exe stop MonitorGateAgent | Out-Null
    sc.exe delete MonitorGateAgent | Out-Null
  }

  try {
    Stop-ScheduledTask -TaskPath $taskPath -TaskName $TaskName -ErrorAction SilentlyContinue
  } catch {
  }

  try {
    Unregister-ScheduledTask -TaskPath $taskPath -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  } catch {
  }

  Stop-AgentProcesses

  Write-Host 'Copiando payload para Program Files...'
  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  Copy-Item -Path (Join-Path $payloadDir '*') -Destination $installDir -Recurse -Force

  if (-not (Test-Path $appSettingsPath)) {
    throw "appsettings.json nao encontrado: $appSettingsPath"
  }

  Unblock-PublishedFiles -FolderPath $installDir

  Write-Host 'Atualizando appsettings.json...'
  $config = Get-Content $appSettingsPath -Raw | ConvertFrom-Json
  $config.Agent.UserId = $UserId
  $config.Agent.DeviceName = $DeviceName
  $config.Agent.PollIntervalMs = $PollIntervalMs
  $config.Agent.ForegroundSliceSeconds = $ForegroundSliceSeconds
  $config.Agent.IdleThresholdSeconds = $IdleThresholdSeconds
  $config.Agent.SyncIntervalSeconds = $SyncIntervalSeconds
  $config.Agent.BatchSize = $BatchSize
  $config.Agent.ApiBaseUrl = $ApiBaseUrl
  $config.Agent.ApiToken = $ApiToken
  $config.Agent.SendFullUrl = $SendFullUrl
  $config | ConvertTo-Json -Depth 6 | Set-Content $appSettingsPath -Encoding UTF8

  Ensure-DefenderExclusions -InstallDirectory $installDir -ExecutablePath $exePath

  Write-Host 'Criando tarefa agendada no logon...'
  $action = New-ScheduledTaskAction -Execute $exePath
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 0)

  Register-ScheduledTask -TaskName $TaskName -TaskPath $taskPath -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'MonitorGate Agent iniciado no logon do usuario.' | Out-Null

  Write-Host 'Iniciando agente na sessao atual...'
  Start-AgentBestEffort -ExecutablePath $exePath -TaskPath $taskPath -TaskName $TaskName

  Write-Host 'Instalacao concluida com sucesso.'
  Write-Host "Pasta de instalacao: $installDir"
  Write-Host "Log: $LogPath"
}
finally {
  Stop-Transcript | Out-Null
}
'@

$installBat = @'
@echo off
setlocal EnableExtensions

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Solicitando permissao de Administrador...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
  exit /b
)

set "SCRIPT_DIR=%~dp0"
set "PS1=%SCRIPT_DIR%install.ps1"

if not exist "%PS1%" (
  echo ERRO: install.ps1 nao encontrado em %SCRIPT_DIR%
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" (
  echo Instalacao falhou com codigo %EXITCODE%.
) else (
  echo Instalacao concluida.
)
pause
exit /b %EXITCODE%
'@

$installCmd = @'
@echo off
setlocal EnableExtensions
call "%~dp0install.bat" %*
exit /b %ERRORLEVEL%
'@

$uninstallPs1 = @'
param(
  [string]$TaskName = 'MonitorGateAgent-Logon'
)

$ErrorActionPreference = 'Stop'
$installDir = Join-Path $env:ProgramFiles 'MonitorGateAgent'
$taskPath = '\MonitorGate\'

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)

if (-not $isAdmin) {
  throw 'Permissao de Administrador obrigatoria. Execute o uninstall.bat.'
}

try {
  Stop-ScheduledTask -TaskPath $taskPath -TaskName $TaskName -ErrorAction SilentlyContinue
} catch {
}

try {
  Unregister-ScheduledTask -TaskPath $taskPath -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
} catch {
}

try {
  Get-Process -Name 'MonitorGate.Agent' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
} catch {
}

if (Test-Path $installDir) {
  Remove-Item -Path $installDir -Recurse -Force
}

Write-Host 'Desinstalacao concluida.'
'@

$uninstallBat = @'
@echo off
setlocal EnableExtensions

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Solicitando permissao de Administrador...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -ArgumentList '%*' -Verb RunAs"
  exit /b
)

set "SCRIPT_DIR=%~dp0"
set "PS1=%SCRIPT_DIR%uninstall.ps1"

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" (
  echo Desinstalacao falhou com codigo %EXITCODE%.
) else (
  echo Desinstalacao concluida.
)
pause
exit /b %EXITCODE%
'@

$uninstallCmd = @'
@echo off
setlocal EnableExtensions
call "%~dp0uninstall.bat" %*
exit /b %ERRORLEVEL%
'@

$readme = @'
MONITORGATE INSTALL KIT

1) Copie esta pasta inteira para o PC destino.
2) Execute install.bat como Administrador (ele eleva automaticamente).
  Se o .bat nao abrir por politica da maquina, execute install.cmd.
3) Exemplo de instalacao:

install.bat -ApiBaseUrl "https://SEU-APP.vercel.app" -ApiToken "SEU_INGEST_API_TOKEN" -UserId "SEU_USER_ID" -IdleThresholdSeconds 40

Parametros principais:
-ApiBaseUrl (obrigatorio)
-ApiToken (obrigatorio)
-UserId (padrao: endmin-root)
-DeviceName (padrao: nome do computador)
-PollIntervalMs (padrao: 1000)
-SyncIntervalSeconds (padrao: 120)
-BatchSize (padrao: 300)
-IdleThresholdSeconds (padrao: 40)
-SendFullUrl:$false (padrao)

Remocao:
uninstall.bat
ou uninstall.cmd
'@

Set-Content -Path (Join-Path $OutputDir 'install.ps1') -Value $installPs1 -Encoding UTF8
Set-Content -Path (Join-Path $OutputDir 'install.bat') -Value $installBat -Encoding ASCII
Set-Content -Path (Join-Path $OutputDir 'install.cmd') -Value $installCmd -Encoding ASCII
Set-Content -Path (Join-Path $OutputDir 'uninstall.ps1') -Value $uninstallPs1 -Encoding UTF8
Set-Content -Path (Join-Path $OutputDir 'uninstall.bat') -Value $uninstallBat -Encoding ASCII
Set-Content -Path (Join-Path $OutputDir 'uninstall.cmd') -Value $uninstallCmd -Encoding ASCII
Set-Content -Path (Join-Path $OutputDir 'README.txt') -Value $readme -Encoding ASCII

if (Test-Path $tempPublish) {
  Remove-Item $tempPublish -Recurse -Force
}

Write-Host "Kit gerado com sucesso em: $OutputDir"
Write-Host 'Copie essa pasta para o outro PC e execute install.bat.'
