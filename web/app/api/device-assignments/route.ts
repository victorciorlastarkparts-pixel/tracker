import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { applyRateLimit, getAuthContextFromRequest } from '@/lib/request';

const upsertAssignmentSchema = z.object({
  deviceName: z.string().trim().min(1),
  userId: z.string().trim().min(1).nullable()
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
  if (!applyRateLimit(`device-assignments:${client}`, 120, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const [assignments, deviceRows] = await Promise.all([
    prisma.deviceAssignment.findMany({
      orderBy: { deviceName: 'asc' },
      select: {
        deviceName: true,
        userId: true,
        user: {
          select: {
            username: true,
            role: true
          }
        }
      }
    }),
    prisma.activity.findMany({
      distinct: ['deviceName'],
      select: { deviceName: true },
      orderBy: { deviceName: 'asc' }
    })
  ]);

  return NextResponse.json({
    devices: deviceRows.map((x) => x.deviceName),
    assignments: assignments.map((item) => ({
      deviceName: item.deviceName,
      userId: item.userId,
      username: item.user.username,
      role: item.user.role
    }))
  });
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
  if (!applyRateLimit(`device-assignments-write:${client}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = upsertAssignmentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 });
  }

  if (!parsed.data.userId) {
    await prisma.deviceAssignment.deleteMany({ where: { deviceName: parsed.data.deviceName } });
    return NextResponse.json({ ok: true, deviceName: parsed.data.deviceName, unassigned: true });
  }

  const user = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, username: true, role: true }
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const assignment = await prisma.deviceAssignment.upsert({
    where: { deviceName: parsed.data.deviceName },
    update: { userId: user.id },
    create: {
      deviceName: parsed.data.deviceName,
      userId: user.id
    },
    select: {
      deviceName: true,
      userId: true,
      user: {
        select: {
          username: true,
          role: true
        }
      }
    }
  });

  const reassigned = await prisma.activity.updateMany({
    where: { deviceName: parsed.data.deviceName },
    data: { userId: user.id }
  });

  return NextResponse.json({
    ok: true,
    assignment: {
      deviceName: assignment.deviceName,
      userId: assignment.userId,
      username: assignment.user.username,
      role: assignment.user.role
    },
    reassignedCount: reassigned.count
  });
}
