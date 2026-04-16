import type { VercelRequest, VercelResponse } from '@vercel/node';
import scoresData from './scores.json';

const scores: Record<string, number> = (scoresData as any).scores ?? {};

function parseAddresses(req: VercelRequest): string[] {
  const raw = req.query.addresses || req.query.address || req.query.voters || '';

  let addresses: string[] = [];
  if (Array.isArray(raw)) {
    addresses = raw.flatMap((v) => String(v).split(','));
  } else {
    addresses = String(raw).split(',');
  }

  return [
    ...new Set(
      addresses
        .map((a) => a.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const addresses = parseAddresses(req);

  if (addresses.length === 0) {
    return res.status(200).json(scores);
  }

  const result: Record<string, number> = {};
  for (const addr of addresses) {
    result[addr] = scores[addr] ?? 0;
  }

  return res.status(200).json(result);
}
