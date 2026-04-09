import { Router, Request, Response } from 'express';
import { queryActions } from '../logs-db.js';

const router = Router();

// GET /logs?agentId=&type=&search=&limit=50&offset=0
router.get('/', (req: Request, res: Response) => {
  const { agentId, type, search, limit = '50', offset = '0' } = req.query;

  const result = queryActions({
    agentId: agentId as string | undefined,
    type: type as string | undefined,
    search: search as string | undefined,
    limit: Number(limit),
    offset: Number(offset),
  });

  res.json({ ...result, limit: Number(limit), offset: Number(offset) });
});

export default router;
