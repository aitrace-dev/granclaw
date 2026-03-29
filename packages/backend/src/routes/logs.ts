import { Router, Request, Response } from 'express';
import { AgentAction } from '../db.js';

const router = Router();

// GET /logs?agentId=&type=&limit=50&offset=0
router.get('/', async (req: Request, res: Response) => {
  const { agentId, type, limit = '50', offset = '0' } = req.query;

  const filter: Record<string, unknown> = {};
  if (agentId) filter.agentId = agentId;
  if (type) filter.type = type;

  const [items, total] = await Promise.all([
    AgentAction.find(filter)
      .sort({ createdAt: -1 })
      .skip(Number(offset))
      .limit(Number(limit))
      .lean(),
    AgentAction.countDocuments(filter),
  ]);

  res.json({ items, total, limit: Number(limit), offset: Number(offset) });
});

export default router;
