import { NextRequest, NextResponse } from 'next/server';
import { applyRateLimit, getAuthContextFromRequest } from '@/lib/request';
import { getStats } from '@/lib/stats';

export async function GET(req: NextRequest) {
  const auth = await getAuthContextFromRequest(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = req.headers.get('x-forwarded-for') ?? auth.userId;
  if (!applyRateLimit(`stats:${client}`, 240, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { searchParams } = new URL(req.url);
  const day = searchParams.get('day') ?? undefined;
  const month = searchParams.get('month') ?? undefined;
  const deviceName = searchParams.get('deviceName') ?? undefined;
  const requestedUserId = searchParams.get('userId') ?? undefined;

  const effectiveUserId = auth.role === 'ADMIN'
    ? requestedUserId
    : auth.userId;

  const result = await getStats({ userId: effectiveUserId, deviceName, day, month });
  return NextResponse.json({
    ...result,
    scope: {
      role: auth.role,
      userId: auth.userId,
      requestedUserId: effectiveUserId ?? null
    }
  });
}
