import { prisma } from './prisma';

export type StatsQuery = {
  userId: string;
  month?: string;
  day?: string;
};

type ActivityRow = {
  id: string;
  appName: string;
  processName: string;
  windowTitle: string;
  urlDomain: string | null;
  durationMs: number;
  startUtc: Date;
  endUtc: Date;
  createdAt: Date;
};

const browserAppNames: Record<string, string> = {
  firefox: 'Mozilla Firefox',
  chrome: 'Google Chrome',
  msedge: 'Microsoft Edge'
};

const processAppNames: Record<string, string> = {
  ...browserAppNames,
  spotify: 'Spotify'
};

const browserNameSuffixRegex = /\s*[\-–—|:•·?]+\s*(Mozilla Firefox|Google Chrome|Microsoft Edge)\s*$/i;

const siteKeywordMap: Array<{ keyword: string; domain: string }> = [
  { keyword: 'chatgpt', domain: 'chatgpt.com' },
  { keyword: 'openai', domain: 'chatgpt.com' },
  { keyword: 'instagram', domain: 'instagram.com' },
  { keyword: 'whatsapp', domain: 'web.whatsapp.com' },
  { keyword: 'facebook', domain: 'facebook.com' },
  { keyword: 'x.com', domain: 'x.com' },
  { keyword: 'twitter', domain: 'x.com' },
  { keyword: 'github', domain: 'github.com' },
  { keyword: 'youtube', domain: 'youtube.com' },
  { keyword: 'linkedin', domain: 'linkedin.com' },
  { keyword: 'reddit', domain: 'reddit.com' }
];

function normalizeAppName(processName: string, appName: string): string {
  const friendlyName = processAppNames[processName.toLowerCase()];
  return friendlyName ?? appName;
}

function normalizeDomain(domain: string): string {
  return domain.toLowerCase().replace(/^www\./, '');
}

function normalizeBrowserTabTitle(title: string): string {
  let cleaned = title.trim().replace(browserNameSuffixRegex, '').trim();

  // Prevent noisy chart labels when tabs include long generated names.
  if (cleaned.length > 100) {
    return `${cleaned.slice(0, 97)}...`;
  }

  return cleaned;
}

function inferSiteLabel(activity: ActivityRow): string | null {
  if (activity.urlDomain) {
    return normalizeDomain(activity.urlDomain);
  }

  if (!browserAppNames[activity.processName.toLowerCase()]) {
    return null;
  }

  const browserTitle = normalizeBrowserTabTitle(activity.windowTitle);
  if (!browserTitle) {
    return null;
  }

  const domainMatch = browserTitle.match(/([a-z0-9-]+\.)+[a-z]{2,}/i);
  if (domainMatch) {
    return normalizeDomain(domainMatch[0]);
  }

  const lowerTitle = browserTitle.toLowerCase();
  for (const item of siteKeywordMap) {
    if (lowerTitle.includes(item.keyword)) {
      return item.domain;
    }
  }

  // If there is no domain, keep the tab title itself to avoid dropping browser activity.
  return browserTitle;
}

function normalizeSiteKey(label: string): string {
  return label.toLowerCase().replace(/\s+/g, ' ').trim();
}

function toDayRange(day?: string): { start: Date; end: Date } | null {
  if (!day) return null;
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function toMonthRange(month?: string): { start: Date; end: Date } | null {
  if (!month) return null;
  const [year, monthPart] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, monthPart - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthPart, 1, 0, 0, 0));
  return { start, end };
}

export async function getStats(query: StatsQuery) {
  const dayRange = toDayRange(query.day);
  const monthRange = toMonthRange(query.month);
  const where = {
    userId: query.userId,
    ...(dayRange
      ? { startUtc: { gte: dayRange.start, lt: dayRange.end } }
      : monthRange
        ? { startUtc: { gte: monthRange.start, lt: monthRange.end } }
        : {})
  };

  const activities = (await prisma.activity.findMany({
    where,
    orderBy: { startUtc: 'asc' },
    select: {
      id: true,
      appName: true,
      processName: true,
      windowTitle: true,
      urlDomain: true,
      durationMs: true,
      startUtc: true,
      endUtc: true,
      createdAt: true
    }
  })) as ActivityRow[];

  const latestPostedActivity = await prisma.activity.findFirst({
    where: { userId: query.userId },
    orderBy: { createdAt: 'desc' },
    select: {
      sessionId: true,
      createdAt: true
    }
  });

  const sessionStartAggregate = latestPostedActivity
    ? await prisma.activity.aggregate({
        where: {
          userId: query.userId,
          sessionId: latestPostedActivity.sessionId
        },
        _min: {
          startUtc: true
        }
      })
    : null;

  const totalMs = activities.reduce((acc: number, a: { durationMs: number }) => acc + a.durationMs, 0);

  const appMap = new Map<string, number>();
  const siteMap = new Map<string, { name: string; durationMs: number }>();

  for (const item of activities) {
    const app = normalizeAppName(item.processName, item.appName);
    appMap.set(app, (appMap.get(app) ?? 0) + item.durationMs);

    const site = inferSiteLabel(item);
    if (site) {
      const key = normalizeSiteKey(site);
      const current = siteMap.get(key);
      if (current) {
        current.durationMs += item.durationMs;
      } else {
        siteMap.set(key, { name: site, durationMs: item.durationMs });
      }
    }
  }

  const byDayMap = new Map<string, number>();
  for (const item of activities) {
    const key = item.startUtc.toISOString().slice(0, 10);
    byDayMap.set(key, (byDayMap.get(key) ?? 0) + item.durationMs);
  }

  const byDay = [...byDayMap.entries()].map(([date, durationMs]) => ({ date, durationMs }));
  byDay.sort((a, b) => a.date.localeCompare(b.date));

  const apps = [...appMap.entries()]
    .map(([name, durationMs]) => ({ name, durationMs }))
    .sort((a, b) => b.durationMs - a.durationMs);

  const sites = [...siteMap.values()]
    .sort((a, b) => b.durationMs - a.durationMs);

  return {
    totalMs,
    averageDailyMs: byDay.length ? Math.round(totalMs / byDay.length) : 0,
    sessionStartUtc: sessionStartAggregate?._min.startUtc?.toISOString() ?? null,
    lastPostUtc: latestPostedActivity?.createdAt.toISOString() ?? null,
    timeline: activities,
    byDay,
    apps,
    sites
  };
}
