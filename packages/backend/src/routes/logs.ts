import { Router, Request, Response } from 'express';
import { queryActions } from '../logs-db.js';

const router = Router();

// GET /logs?agentId=&type=&search=&from=<epoch_ms>&to=<epoch_ms>&limit=50&offset=0
router.get('/', (req: Request, res: Response) => {
  const { agentId, type, search, from, to, limit = '50', offset = '0' } = req.query;

  const result = queryActions({
    agentId: agentId as string | undefined,
    type: type as string | undefined,
    search: search as string | undefined,
    from: from ? Number(from) : undefined,
    to: to ? Number(to) : undefined,
    limit: Number(limit),
    offset: Number(offset),
  });

  res.json({ ...result, limit: Number(limit), offset: Number(offset) });
});

export default router;
