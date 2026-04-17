import { NextRequest } from 'next/server';
import { verifyAuthToken } from './auth';

const rateMap = new Map<string, { count: number; resetAt: number }>();

export function applyRateLimit(key: string, limit = 120, windowMs = 60_000) {
  const now = Date.now();
  const current = rateMap.get(key);

  if (!current || current.resetAt < now) {
    rateMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (current.count >= limit) {
    return false;
  }

  current.count += 1;
  rateMap.set(key, current);
  return true;
}

export async function getUserIdFromRequest(req: NextRequest): Promise<string | null> {
  const context = await getAuthContextFromRequest(req);
  return context?.userId ?? null;
}

export type AuthContext = {
  userId: string;
  username: string;
  role: 'ADMIN' | 'USER';
};

export async function getAuthContextFromRequest(req: NextRequest): Promise<AuthContext | null> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  try {
    const token = authHeader.replace('Bearer ', '').trim();
    const payload = await verifyAuthToken(token);
    return {
      userId: payload.sub,
      username: payload.username,
      role: payload.role
    };
  } catch {
    return null;
  }
}
