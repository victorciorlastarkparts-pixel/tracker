'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Charts from '@/components/Charts';
import { formatDuration } from '@/lib/timeFormat';

type ApiStats = {
  totalMs: number;
  activeMs: number;
  idleMs: number;
  averageDailyMs: number;
  sessionStartUtc: string | null;
  lastPostUtc: string | null;
  devices: string[];
  scope: {
    role: 'ADMIN' | 'USER';
    userId: string;
    requestedUserId: string | null;
  };
  timeline: {
    id: string;
    appName: string;
    processName: string;
    windowTitle: string;
    urlDomain: string | null;
    durationMs: number;
    startUtc: string;
    endUtc: string;
  }[];
  byDay: { date: string; durationMs: number }[];
  apps: { name: string; durationMs: number }[];
  sites: { name: string; durationMs: number }[];
};

type MeResponse = {
  id: string;
  username: string;
  email: string | null;
  role: 'ADMIN' | 'USER';
};

type UsersResponse = {
  users: Array<{
    id: string;
    username: string;
    email: string | null;
    role: 'ADMIN' | 'USER';
    createdAt: string;
  }>;
};

const now = new Date();
const defaultDay = now.toISOString().slice(0, 10);
const defaultMonth = now.toISOString().slice(0, 7);

function formatDateTime(value: string | null): string {
  if (!value) return '--';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '--';

  return parsed.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getSyncStatus(lastPostUtc: string | null): {
  label: string;
  className: string;
} {
  if (!lastPostUtc) {
    return { label: 'Sem post', className: 'sync-badge sync-badge-offline' };
  }

  const parsed = new Date(lastPostUtc);
  if (Number.isNaN(parsed.getTime())) {
    return { label: 'Inválido', className: 'sync-badge sync-badge-offline' };
  }

  const elapsedMs = Date.now() - parsed.getTime();
  if (elapsedMs <= 3 * 60 * 1000) {
    return { label: 'Online', className: 'sync-badge sync-badge-online' };
  }

  if (elapsedMs <= 10 * 60 * 1000) {
    return { label: 'Atenção', className: 'sync-badge sync-badge-warn' };
  }

  return { label: 'Atrasado', className: 'sync-badge sync-badge-offline' };
}

export default function DashboardPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [users, setUsers] = useState<UsersResponse['users']>([]);
  const [day, setDay] = useState(defaultDay);
  const [month, setMonth] = useState(defaultMonth);
  const [mode, setMode] = useState<'day' | 'month' | 'general'>('day');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedDeviceName, setSelectedDeviceName] = useState('');
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<ApiStats | null>(null);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [userCreateStatus, setUserCreateStatus] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);

  const syncStatus = useMemo(() => getSyncStatus(stats?.lastPostUtc ?? null), [stats?.lastPostUtc]);

  // Verificar token ao montar
  useEffect(() => {
    setMounted(true);
    const savedToken = localStorage.getItem('mg_token');
    if (!savedToken) {
      router.push('/login');
    } else {
      setToken(savedToken);
    }
  }, [router]);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    async function loadSession() {
      try {
        const meRes = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (!meRes.ok) {
          throw new Error(`Falha ao obter sessao (${meRes.status})`);
        }

        const meData = (await meRes.json()) as MeResponse;
        if (cancelled) return;
        setMe(meData);

        if (meData.role === 'ADMIN') {
          const usersRes = await fetch('/api/users', {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (usersRes.ok) {
            const usersData = (await usersRes.json()) as UsersResponse;
            if (!cancelled) {
              setUsers(usersData.users);
            }
          }
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Falha ao carregar sessao');
      }
    }

    loadSession();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();

    if (mode === 'day') params.set('day', day);
    if (mode === 'month') params.set('month', month);
    if (selectedDeviceName) params.set('deviceName', selectedDeviceName);
    if (me?.role === 'ADMIN' && selectedUserId) params.set('userId', selectedUserId);

    return params.toString();
  }, [mode, day, month, selectedDeviceName, selectedUserId, me?.role]);

  async function loadStats() {
    if (!token) return;

    setLoading(true);
    setError('');

    try {
      const res = await fetch(`/api/stats${queryString ? `?${queryString}` : ''}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!res.ok) {
        throw new Error(`Erro ${res.status}`);
      }

      const data = (await res.json()) as ApiStats;
      setStats(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar estatísticas');
    } finally {
      setLoading(false);
    }
  }

  async function createUser() {
    if (!token || !newUsername || !newPassword) {
      return;
    }

    setCreatingUser(true);
    setUserCreateStatus('');

    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          email: newEmail
        })
      });

      const payload = (await res.json().catch(() => null)) as
        | { error?: string; user?: { id: string; username: string } }
        | null;

      if (!res.ok) {
        throw new Error(payload?.error || `Falha ao criar usuario (${res.status})`);
      }

      setUserCreateStatus(
        `Usuario criado: ${payload?.user?.username} (userId: ${payload?.user?.id})`
      );
      setNewUsername('');
      setNewPassword('');
      setNewEmail('');

      const usersRes = await fetch('/api/users', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (usersRes.ok) {
        const usersData = (await usersRes.json()) as UsersResponse;
        setUsers(usersData.users);
      }
    } catch (e) {
      setUserCreateStatus(e instanceof Error ? e.message : 'Falha ao criar usuario');
    } finally {
      setCreatingUser(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem('mg_token');
    router.push('/login');
  }

  if (!mounted) return null;

  return (
    <main className="dashboard-container">
      {/* Header */}
      <header className="dashboard-header">
        <div className="header-content">
          <div>
            <h1>Dashboard</h1>
            <p className="muted">Análise de uso de aplicativos e sites</p>
          </div>
          <button className="logout-button" onClick={handleLogout}>
            Sair
          </button>
        </div>
      </header>

      {/* Controls */}
      <div className="dashboard-content">
        <section className="controls-section">
          <div className="tabs">
            <button
              className={`tab ${mode === 'day' ? 'active' : ''}`}
              onClick={() => {
                setMode('day');
                setStats(null);
              }}
            >
              Por Dia
            </button>
            <button
              className={`tab ${mode === 'month' ? 'active' : ''}`}
              onClick={() => {
                setMode('month');
                setStats(null);
              }}
            >
              Por Mês
            </button>
            <button
              className={`tab ${mode === 'general' ? 'active' : ''}`}
              onClick={() => {
                setMode('general');
                setStats(null);
              }}
            >
              Geral
            </button>
          </div>

          <div className="controls-group">
            {me?.role === 'ADMIN' && (
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="date-input"
              >
                <option value="">Todos os usuarios</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.username} ({user.role})
                  </option>
                ))}
              </select>
            )}

            <select
              value={selectedDeviceName}
              onChange={(e) => setSelectedDeviceName(e.target.value)}
              className="date-input"
            >
              <option value="">Todos os PCs</option>
              {(stats?.devices ?? []).map((device) => (
                <option key={device} value={device}>
                  {device}
                </option>
              ))}
            </select>

            {mode === 'day' && (
              <input
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
                className="date-input"
              />
            )}
            {mode === 'month' && (
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="date-input"
              />
            )}
            <button
              className="refresh-button"
              onClick={loadStats}
              disabled={loading}
            >
              {loading ? '⟳ Carregando...' : '⟳ Atualizar'}
            </button>
          </div>
        </section>

        {me && (
          <section className="controls-section" style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <p className="muted">
                Sessao: <strong>{me.username}</strong> ({me.role})
              </p>
              {stats?.scope && (
                <p className="muted">
                  Escopo atual: {stats.scope.role === 'ADMIN' ? 'global' : 'restrito ao proprio usuario'}
                </p>
              )}
            </div>
          </section>
        )}

        {me?.role === 'ADMIN' && (
          <section className="controls-section" style={{ marginTop: 12 }}>
            <div style={{ display: 'grid', gap: 10, width: '100%' }}>
              <h3 style={{ margin: 0 }}>Criar usuario comum</h3>
              <div className="controls-group">
                <input
                  type="text"
                  placeholder="Username"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="date-input"
                />
                <input
                  type="password"
                  placeholder="Senha"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="date-input"
                />
                <input
                  type="email"
                  placeholder="Email (opcional)"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="date-input"
                />
                <button
                  className="refresh-button"
                  onClick={createUser}
                  disabled={creatingUser || !newUsername || !newPassword}
                >
                  {creatingUser ? 'Criando...' : 'Criar usuario'}
                </button>
              </div>
              {userCreateStatus && <p className="muted">{userCreateStatus}</p>}
            </div>
          </section>
        )}

        {error && (
          <div className="error-banner">
            <strong>Erro:</strong> {error}
          </div>
        )}

        {/* Stats Cards */}
        {stats && (
          <>
            <section className="stats-grid">
              <div className="stat-card">
                <p className="stat-label">Tempo Total</p>
                <p className="stat-value">{formatDuration(stats.totalMs)}</p>
              </div>
              <div className="stat-card">
                <p className="stat-label">Tempo Ativo</p>
                <p className="stat-value">{formatDuration(stats.activeMs)}</p>
              </div>
              <div className="stat-card">
                <p className="stat-label">Tempo Ocioso</p>
                <p className="stat-value">{formatDuration(stats.idleMs)}</p>
              </div>
              <div className="stat-card">
                <p className="stat-label">Média Diária</p>
                <p className="stat-value">{formatDuration(stats.averageDailyMs)}</p>
              </div>
              <div className="stat-card">
                <p className="stat-label">Apps</p>
                <p className="stat-value">{stats.apps.length}</p>
              </div>
              <div className="stat-card">
                <p className="stat-label">Sites</p>
                <p className="stat-value">{stats.sites.length}</p>
              </div>
              <div className="stat-card sync-status-card">
                <p className="stat-label">Sincronização</p>
                <div className="sync-status-head">
                  <span>Status</span>
                  <span className={syncStatus.className}>{syncStatus.label}</span>
                </div>
                <div className="sync-status-row">
                  <span>Início da sessão</span>
                  <strong>{formatDateTime(stats.sessionStartUtc)}</strong>
                </div>
                <div className="sync-status-row">
                  <span>Último post</span>
                  <strong>{formatDateTime(stats.lastPostUtc)}</strong>
                </div>
              </div>
            </section>

            {/* Charts Section */}
            <section className="charts-section">
              <Charts apps={stats.apps} sites={stats.sites} byDay={stats.byDay} />
            </section>

            {/* Rankings */}
            <section className="rankings-section">
              <div className="ranking-card">
                <h3>Todos os Apps</h3>
                <div className="ranking-list">
                  {stats.apps.length === 0 ? (
                    <p className="muted">Sem dados</p>
                  ) : (
                    stats.apps.map((item, idx) => (
                      <div key={`${item.name}-${idx}`} className="ranking-item">
                        <div className="ranking-info">
                          <span className="ranking-position">{idx + 1}</span>
                          <span className="ranking-name">{item.name}</span>
                        </div>
                        <span className="ranking-time">{formatDuration(item.durationMs)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="ranking-card">
                <h3>Todos os Sites</h3>
                <div className="ranking-list">
                  {stats.sites.length === 0 ? (
                    <p className="muted">Sem dados</p>
                  ) : (
                    stats.sites.map((item, idx) => (
                      <div key={`${item.name}-${idx}`} className="ranking-item">
                        <div className="ranking-info">
                          <span className="ranking-position">{idx + 1}</span>
                          <span className="ranking-name">{item.name}</span>
                        </div>
                        <span className="ranking-time">{formatDuration(item.durationMs)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>
          </>
        )}

        {!stats && !loading && !error && (
          <div className="empty-state">
            <p>Selecione um período e clique em Atualizar para visualizar os dados</p>
          </div>
        )}
      </div>
    </main>
  );
}
