import { Router, Request, Response } from 'express';
import { getAgents, getAgent } from '../config.js';
import { AgentSession } from '../db.js';

const router = Router();

// GET /agents — list all configured agents with live session status
router.get('/', async (_req: Request, res: Response) => {
  const agents = getAgents();

  const sessions = await AgentSession.find({
    agentId: { $in: agents.map((a) => a.id) },
  });
  const sessionMap = Object.fromEntries(sessions.map((s) => [s.agentId, s.sessionId]));

  const result = agents.map((a) => ({
    id: a.id,
    name: a.name,
    model: a.model,
    allowedTools: a.allowedTools,
    bigBrother: a.bigBrother,
    sessionId: sessionMap[a.id] ?? null,
    status: sessionMap[a.id] ? 'active' : 'idle',
  }));

  res.json(result);
});

// GET /agents/:id — single agent detail
router.get('/:id', async (req: Request, res: Response) => {
  const agent = getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  const session = await AgentSession.findOne({ agentId: agent.id }).sort({ lastActiveAt: -1 });

  res.json({
    ...agent,
    sessionId: session?.sessionId ?? null,
    status: session ? 'active' : 'idle',
  });
});

export default router;
