import { NextRequest, NextResponse } from 'next/server';
import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { applyRateLimit } from '@/lib/request';

const activityItem = z.object({
  sessionId: z.string().min(6),
  appName: z.string().min(1),
  processName: z.string().min(1),
  windowTitle: z.string().min(1),
  url: z.string().url().optional().nullable(),
  urlDomain: z.string().optional().nullable(),
  startUtc: z.string().datetime({ offset: true }),
  endUtc: z.string().datetime({ offset: true }),
  durationMs: z.number().int().min(50).max(86_400_000)
});

const payloadSchema = z.object({
  userId: z.string().min(3),
  deviceName: z.string().optional().default('windows-device'),
  activities: z.array(activityItem).min(1).max(1000)
});

async function readPayload(req: NextRequest): Promise<unknown> {
  const encoding = req.headers.get('content-encoding')?.toLowerCase();
  if (encoding === 'gzip') {
    const compressed = new Uint8Array(await req.arrayBuffer());
    const json = gunzipSync(compressed).toString('utf-8');
    return JSON.parse(json);
  }

  return req.json();
}

export async function POST(req: NextRequest) {
  const ingestToken = process.env.INGEST_API_TOKEN;
  if (!ingestToken) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${ingestToken}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = req.headers.get('x-forwarded-for') ?? 'agent';
  if (!applyRateLimit(`ingest:${client}`, 180, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  let rawBody: unknown;
  try {
    rawBody = await readPayload(req);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation error', issues: parsed.error.issues }, { status: 400 });
  }

  const assignment = await prisma.deviceAssignment.findUnique({
    where: { deviceName: parsed.data.deviceName },
    select: { userId: true }
  });

  const effectiveUserId = assignment?.userId ?? parsed.data.userId;

  const user = await prisma.user.findUnique({ where: { id: effectiveUserId }, select: { id: true } });
  if (!user) {
    return NextResponse.json({ error: 'Unknown user' }, { status: 404 });
  }

  const rows = parsed.data.activities.map((item) => ({
    userId: effectiveUserId,
    sessionId: item.sessionId,
    deviceName: parsed.data.deviceName,
    appName: item.appName,
    processName: item.processName,
    windowTitle: item.windowTitle,
    url: item.url ?? null,
    urlDomain: item.urlDomain ?? null,
    startUtc: new Date(item.startUtc),
    endUtc: new Date(item.endUtc),
    durationMs: item.durationMs
  }));

  await prisma.activity.createMany({ data: rows });
  return NextResponse.json({
    inserted: rows.length,
    effectiveUserId,
    sourceUserId: parsed.data.userId,
    assignedByDevice: !!assignment
  });
}
