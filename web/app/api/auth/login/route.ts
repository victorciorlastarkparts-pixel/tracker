import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { signAuthToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { applyRateLimit } from '@/lib/request';

const loginSchema = z.object({
  login: z.string().trim().min(1),
  password: z.string().min(1)
});

export async function POST(req: NextRequest) {
  try {
    const client = req.headers.get('x-forwarded-for') ?? 'local';
    if (!applyRateLimit(`login:${client}`, 20, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await req.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload: login e senha sao obrigatorios' }, { status: 400 });
    }

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username: parsed.data.login },
          { email: parsed.data.login }
        ]
      }
    });
    if (!user) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    if (!process.env.JWT_SECRET) {
      return NextResponse.json({ error: 'JWT_SECRET missing in environment' }, { status: 500 });
    }

    const token = await signAuthToken({
      sub: user.id,
      username: user.username,
      email: user.email ?? undefined,
      role: user.role
    });
    return NextResponse.json({ token, role: user.role, userId: user.id, username: user.username });
  } catch (error) {
    console.error('LOGIN_ROUTE_ERROR', error);
    return NextResponse.json({ error: 'Login failed due to server error' }, { status: 500 });
  }
}
