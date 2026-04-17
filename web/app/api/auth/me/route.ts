import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { applyRateLimit, getAuthContextFromRequest } from '@/lib/request';

export async function GET(req: NextRequest) {
  const auth = await getAuthContextFromRequest(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = req.headers.get('x-forwarded-for') ?? auth.userId;
  if (!applyRateLimit(`auth-me:${client}`, 120, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: {
      id: true,
      username: true,
      email: true,
      role: true
    }
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json(user);
}
