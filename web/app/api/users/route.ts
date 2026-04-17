import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { applyRateLimit, getAuthContextFromRequest } from '@/lib/request';

const createUserSchema = z.object({
  username: z.string().trim().min(3),
  password: z.string().min(4),
  email: z.string().email().optional().or(z.literal('')).transform((v) => v || undefined)
});

export async function GET(req: NextRequest) {
  const auth = await getAuthContextFromRequest(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (auth.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const client = req.headers.get('x-forwarded-for') ?? auth.userId;
  if (!applyRateLimit(`users-list:${client}`, 120, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      createdAt: true
    }
  });

  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const auth = await getAuthContextFromRequest(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (auth.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const client = req.headers.get('x-forwarded-for') ?? auth.userId;
  if (!applyRateLimit(`users-create:${client}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const payload = await req.json().catch(() => null);
  const parsed = createUserSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 });
  }

  const username = parsed.data.username;
  const email = parsed.data.email;

  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { username },
        ...(email ? [{ email }] : [])
      ]
    },
    select: { id: true }
  });

  if (existing) {
    return NextResponse.json({ error: 'Usuario ja existe (username/email).' }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const created = await prisma.user.create({
    data: {
      username,
      email,
      passwordHash,
      role: 'USER'
    },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      createdAt: true
    }
  });

  return NextResponse.json({ user: created }, { status: 201 });
}
