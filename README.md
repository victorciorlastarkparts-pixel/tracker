# MonitorGate

Sistema completo de monitoramento de atividades para Windows com agente local em C# e dashboard web em Next.js (Vercel).

## Arquitetura

- `agent/MonitorGate.Agent`: serviço local responsável por capturar janela ativa global, tempo em foreground e metadados de navegação.
- `web`: aplicação Next.js com API serverless (`/api/activity`, `/api/stats`, `/api/auth/login`) e dashboard de análise.
- Banco remoto: PostgreSQL via Prisma.
- Buffer local: SQLite no agente para resiliência offline e envio em lote.

## Recursos implementados

- Monitoramento de janela ativa global do Windows (multi-monitor suportado pela janela de foco do sistema).
- Registro por sessão, aplicativo, domínio/URL (opcional), data e duração.
- Polling leve (1s por padrão), registro apenas em mudança de foco.
- Persistência local SQLite no agente.
- Sync periódico em batch com autenticação Bearer e payload compactado (gzip).
- API REST protegida com validação Zod e rate limit.
- Dashboard com visão por dia, mês e geral, incluindo:
  - Apps mais usados
  - Sites mais visitados
  - Timeline diária
  - Ranking agregado e métricas gerais
- UI responsiva, leve e moderna.

## 1) Subir o frontend/API (Next.js)

Pré-requisitos: Node 18+ e PostgreSQL.

1. Entre em `web`.
2. Copie `.env.example` para `.env` e ajuste:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `INGEST_API_TOKEN`
   - `ADMIN_USER_ID`
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`
   - `ADMIN_EMAIL`

Se a senha do banco tiver caracteres especiais como `@`, `:`, `/`, `#` ou `?`, codifique na URL. Exemplo: `@` vira `%40`.
3. Instale dependências:
   - `npm install`
4. Gere o cliente Prisma:
   - `npm run db:generate`
5. Aplique schema no banco:
   - `npm run db:push`
6. Crie o usuario obrigatorio do sistema:
   - `npm run db:seed-endmin`
7. Rode localmente:
   - `npm run dev`

### Login obrigatorio

As credenciais administrativas nao ficam no codigo.

- Defina login e senha no arquivo `.env`.
- O comando `npm run db:seed-endmin` cria/atualiza o usuario com base nessas variaveis.

## 2) Rodar agente local (C#)

Pré-requisitos: .NET SDK 8.

1. Abra `agent/MonitorGate.Agent`.
2. Ajuste `appsettings.json`:
   - `UserId`: padrao `endmin-root` (usuario obrigatorio).
   - `ApiBaseUrl`: URL da aplicacao Vercel.
   - `ApiToken`: mesmo valor de `INGEST_API_TOKEN`.
   - `SendFullUrl`: `true` para enviar URL completa, `false` para privacidade.
   - `SyncIntervalSeconds`: intervalo de envio dos lotes.
3. Restaurar e executar:
   - `dotnet restore`
   - `dotnet run`

### Instalador (Windows Service)

Foi adicionado instalador automatizado:

- Arquivo: `agent/install-agent.ps1`
- Arquivo: `agent/install-agent.bat` (atalho facil com auto-permissao de Administrador)

Executar como Administrador:

```powershell
Set-Location .\agent
.\install-agent.ps1 -ApiBaseUrl "https://SEU-APP.vercel.app" -ApiToken "SEU_INGEST_API_TOKEN"
```

Opcao recomendada (mais facil):

```bat
cd /d D:\monitor.gate\agent
install-agent.bat -ApiBaseUrl "https://SEU-APP.vercel.app" -ApiToken "SEU_INGEST_API_TOKEN"
```

O `install-agent.bat` eleva sozinho para Administrador quando necessario e executa o script PowerShell por baixo.

Automacoes aplicadas no instalador:

- Instala automaticamente o .NET SDK 8 via winget quando ausente.
- Aplica automaticamente exclusoes no Windows Security para:
   - `C:\Program Files\MonitorGateAgent`
   - `C:\Program Files\MonitorGateAgent\MonitorGate.Agent.exe`

### Modo recomendado para captura de janela ativa (Logon do usuario)

Como `GetForegroundWindow` depende da sessao interativa do desktop, o modo recomendado e iniciar no logon do usuario (em vez de apenas Windows Service em Session 0).

- Arquivo: `agent/install-agent-logon.bat`
- Script: `agent/install-agent-logon.ps1`

Uso rapido:

```bat
cd /d D:\monitor.gate\agent
install-agent-logon.bat -ApiBaseUrl "https://SEU-APP.vercel.app" -ApiToken "SEU_INGEST_API_TOKEN" -SyncIntervalSeconds 120 -PollIntervalMs 1000 -BatchSize 300 -SendFullUrl:$false
```

Esse instalador:

- Publica e copia o agente para `Program Files`.
- Atualiza `appsettings.json`.
- Remove o servico legado `MonitorGateAgent` para evitar duplicidade.
- Cria tarefa agendada em `\MonitorGate\MonitorGateAgent-Logon` no logon do usuario atual.
- Inicia o agente imediatamente na sessao atual.
- Instala automaticamente o .NET SDK 8 via winget quando ausente.
- Aplica automaticamente exclusoes no Windows Security para o diretorio e executavel do agente.

Exemplo com parametros de 24/7:

```powershell
Set-Location .\agent
.\install-agent.ps1 -ApiBaseUrl "https://SEU-APP.vercel.app" -ApiToken "SEU_INGEST_API_TOKEN" -SyncIntervalSeconds 120 -PollIntervalMs 1000 -BatchSize 300 -SendFullUrl:$false
```

O script publica o agente, copia para `Program Files`, configura `appsettings.json`, cria/recria o servico `MonitorGateAgent` e inicia automaticamente.

## Como os dados sao enviados (24/7)

- Coleta local: a cada `PollIntervalMs` (padrao 1000 ms) o agente verifica a janela ativa.
- Gravacao local: ao detectar troca de foco, salva um registro no SQLite local.
- Envio remoto: a cada `SyncIntervalSeconds` (padrao 120 s, ou seja, 2 minutos) envia lote para `/api/activity`.
- Tamanho do lote: `BatchSize` (padrao 300 eventos por envio).
- Rede: payload JSON compactado com gzip + HTTPS + Bearer token.
- Resiliencia: se Vercel ficar indisponivel, continua gravando local e tenta sincronizar no proximo ciclo.

## Endpoints

- `POST /api/activity`
  - Auth: `Bearer <INGEST_API_TOKEN>`
  - Recebe lotes de atividades do agente
- `GET /api/stats?day=YYYY-MM-DD`
- `GET /api/stats?month=YYYY-MM`
- `GET /api/stats`
  - Auth: `Bearer <JWT>`
- `POST /api/auth/login`
  - Retorna JWT para uso nas rotas protegidas

## Modelo de dados principal

Atividade:

- `sessionId`
- `userId`
- `deviceName`
- `appName`
- `processName`
- `windowTitle`
- `url` (opcional)
- `urlDomain` (opcional)
- `startUtc` / `endUtc`
- `durationMs`

## Privacidade e segurança

- Token obrigatório para ingestão e dashboard.
- HTTPS no deploy (Vercel).
- Sanitização e validação com Zod.
- Rate limit por origem.
- Controle para não enviar URL completa (`SendFullUrl=false`).

## Riscos conhecidos e mitigação

- Lock de SQLite de navegadores: captura de URL via título da aba com fallback por domínio.
- Ambiguidade de abas modernas: estratégia best-effort sem injetar extensão no navegador.
- Operação 24/7: buffer local + sync em lote para reduzir CPU/rede.

## Deploy Vercel

Sim, importar do GitHub no Vercel e o caminho mais pratico para esse projeto.

### Passo a passo de producao (GitHub publico)

1. Suba o repositorio para o GitHub sem arquivo `.env`.
2. No Vercel, clique em New Project e importe o repositorio.
3. Em Root Directory, selecione `web`.
4. Confirme:
   - Build Command: `npm run build`
   - Output: default do Next.js
5. Em Environment Variables (Production), configure:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `INGEST_API_TOKEN`
   - `ADMIN_USER_ID`
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD`
   - `ADMIN_EMAIL`
6. Execute o deploy.
7. Rode o setup de banco (uma vez) apontando para o banco de producao:
   - `npm run db:push`
   - `npm run db:seed-endmin`
8. Valide o login no dashboard com usuario/senha definidos no env de producao.

### Observacoes de seguranca para repositorio publico

- Nunca commitar `.env`.
- Trocar `ADMIN_PASSWORD`, `JWT_SECRET` e `INGEST_API_TOKEN` por valores fortes.
- Rotacionar tokens periodicamente.

## Próximas evoluções recomendadas

- Extensão de navegador opcional para URL exata da aba ativa.
- Rate limit distribuído (Redis) em vez de memória local.
- Refresh token e expiração rotativa.
- Alertas e metas de produtividade.
