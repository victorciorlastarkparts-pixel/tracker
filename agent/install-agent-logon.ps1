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
  [bool]$AutoInstallDotNet = $true,
  [bool]$ConfigureDefenderExclusions = $true,
  [string]$DotNetMajorVersion = '8',
  [string]$NuGetSource = 'https://api.nuget.org/v3/index.json',
  [string]$TaskName = 'MonitorGateAgent-Logon',
  [string]$LogPath = ''
)

$ErrorActionPreference = 'Stop'
$projectPath = Join-Path $PSScriptRoot 'MonitorGate.Agent\MonitorGate.Agent.csproj'
$publishDir = Join-Path $PSScriptRoot 'publish'
$installDir = Join-Path $env:ProgramFiles 'MonitorGateAgent'
$exePath = Join-Path $installDir 'MonitorGate.Agent.exe'
$appSettingsPath = Join-Path $installDir 'appsettings.json'
$runtime = 'win-x64'

function Get-HasDotNetSdk {
  param([string]$MajorVersion)

  if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    return $false
  }

  $sdkList = & dotnet --list-sdks 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace(($sdkList | Out-String))) {
    return $false
  }

  foreach ($line in $sdkList) {
    if ($line -match "^$([Regex]::Escape($MajorVersion))\.") {
      return $true
    }
  }

  return $false
}

function Install-DotNetSdkIfNeeded {
  param([string]$MajorVersion)

  if (Get-HasDotNetSdk -MajorVersion $MajorVersion) {
    Write-Host ".NET SDK $MajorVersion detectado."
    return
  }

  if (-not $AutoInstallDotNet) {
    throw ".NET SDK $MajorVersion nao encontrado. Ative -AutoInstallDotNet ou instale manualmente."
  }

  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($null -eq $winget) {
    throw ".NET SDK $MajorVersion nao encontrado e winget indisponivel. Instale o .NET SDK manualmente e rode novamente."
  }

  Write-Host "Instalando .NET SDK $MajorVersion via winget..."
  & winget install --id Microsoft.DotNet.SDK.$MajorVersion --exact --accept-package-agreements --accept-source-agreements --silent
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao instalar .NET SDK $MajorVersion via winget (codigo $LASTEXITCODE)."
  }

  $machinePath = [Environment]::GetEnvironmentVariable('Path', [EnvironmentVariableTarget]::Machine)
  $userPath = [Environment]::GetEnvironmentVariable('Path', [EnvironmentVariableTarget]::User)
  $env:Path = "$machinePath;$userPath"

  if (-not (Get-HasDotNetSdk -MajorVersion $MajorVersion)) {
    throw ".NET SDK $MajorVersion foi instalado, mas ainda nao esta disponivel. Abra novo terminal e tente novamente."
  }

  Write-Host ".NET SDK $MajorVersion instalado com sucesso."
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
    Write-Warning 'Add-MpPreference nao disponivel. Pulando exclusoes no Windows Security.'
    return
  }

  try {
    Add-MpPreference -ExclusionPath $InstallDirectory -ErrorAction Stop
    Add-MpPreference -ExclusionProcess $ExecutablePath -ErrorAction Stop
    Write-Host 'Exclusoes do Windows Security aplicadas com sucesso.'
  }
  catch {
    Write-Warning "Nao foi possivel aplicar exclusoes automaticamente: $($_.Exception.Message)"
    Write-Warning 'Se necessario, adicione manualmente em Windows Security > Virus & threat protection > Exclusions.'
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

function Stop-AgentProcesses {
  try {
    Get-Process -Name 'MonitorGate.Agent' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  }
  catch {
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

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)

if (-not $isAdmin) {
  throw 'Permissao de Administrador obrigatoria. Execute pelo arquivo install-agent-logon.bat (auto-elevacao).'
}

if ([string]::IsNullOrWhiteSpace($LogPath)) {
  $LogPath = Join-Path $PSScriptRoot 'install-logon-log.txt'
}

if (Test-Path $LogPath) {
  Remove-Item $LogPath -Force
}

Start-Transcript -Path $LogPath -Force | Out-Null

try {
  Install-DotNetSdkIfNeeded -MajorVersion $DotNetMajorVersion

  if (-not (Test-Path $projectPath)) {
    throw "Projeto nao encontrado: $projectPath"
  }

  if (Test-Path $publishDir) {
    Remove-Item -Path $publishDir -Recurse -Force
  }

  Write-Host 'Publicando agente...'
  Write-Host "Restaurando pacotes via NuGet source: $NuGetSource"
  dotnet restore $projectPath --source $NuGetSource -r $runtime
  if ($LASTEXITCODE -ne 0) {
    throw "Falha no restore de pacotes NuGet (codigo $LASTEXITCODE)."
  }

  dotnet publish $projectPath -c Release -r $runtime --self-contained true -p:PublishSingleFile=true --no-restore -o $publishDir
  if ($LASTEXITCODE -ne 0) {
    throw "Falha no publish do agente (codigo $LASTEXITCODE)."
  }

  if (-not (Test-Path $publishDir)) {
    throw "Pasta de publish nao foi gerada: $publishDir"
  }

  $taskPath = '\MonitorGate\'
  $fullTaskName = "$taskPath$TaskName"

  # Stop legacy service before file copy to prevent locked native DLLs.
  $legacyService = Get-Service -Name 'MonitorGateAgent' -ErrorAction SilentlyContinue
  if ($null -ne $legacyService) {
    Write-Host 'Servico legado encontrado. Parando/removendo antes da copia...'
    sc.exe stop MonitorGateAgent | Out-Null
    sc.exe delete MonitorGateAgent | Out-Null
  }

  # Stop and remove scheduled task before replacing binaries.
  try {
    Stop-ScheduledTask -TaskPath $taskPath -TaskName $TaskName -ErrorAction SilentlyContinue
  }
  catch {
  }

  try {
    Unregister-ScheduledTask -TaskPath $taskPath -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  }
  catch {
  }

  # Kill any remaining agent process to avoid native SQLite DLL lock during overwrite.
  Stop-AgentProcesses

  Write-Host 'Copiando arquivos para pasta de instalacao...'
  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  $copied = $false
  for ($i = 1; $i -le 8 -and -not $copied; $i++) {
    try {
      Copy-Item -Path (Join-Path $publishDir '*') -Destination $installDir -Recurse -Force
      $copied = $true
    }
    catch {
      if ($i -eq 8) {
        throw
      }

      Stop-AgentProcesses
      [System.Threading.Thread]::Sleep(500)
    }
  }

  if (-not (Test-Path $appSettingsPath)) {
    throw "appsettings.json nao encontrado apos copia: $appSettingsPath"
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

  Write-Host 'Iniciando agente agora (sessao atual)...'
  Start-AgentBestEffort -ExecutablePath $exePath -TaskPath $taskPath -TaskName $TaskName

  Write-Host 'Instalacao concluida com sucesso (modo logon).'
  Write-Host "Tarefa: $fullTaskName"
  Write-Host "Usuario: $env:USERDOMAIN\$env:USERNAME"
  Write-Host "Intervalo de sync: $SyncIntervalSeconds segundos"
  Write-Host "Log de instalacao: $LogPath"
}
finally {
  Stop-Transcript | Out-Null
}
