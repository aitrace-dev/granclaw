import mongoose from 'mongoose';

export async function connectDb(uri: string): Promise<void> {
  await mongoose.connect(uri);
  console.log('[db] connected to MongoDB');
}

// ── Schemas ────────────────────────────────────────────────────────────────

const agentActionSchema = new mongoose.Schema(
  {
    agentId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ['message', 'tool_call', 'tool_result', 'error', 'system'],
      required: true,
    },
    input: { type: mongoose.Schema.Types.Mixed },
    output: { type: mongoose.Schema.Types.Mixed },
    durationMs: { type: Number },
  },
  { timestamps: true }
);

const agentSessionSchema = new mongoose.Schema(
  {
    agentId: { type: String, required: true, index: true },
    sessionId: { type: String, required: true, unique: true },
    lastActiveAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// ── Models ─────────────────────────────────────────────────────────────────

export const AgentAction = mongoose.model('AgentAction', agentActionSchema);
export const AgentSession = mongoose.model('AgentSession', agentSessionSchema);

// ── Helpers ────────────────────────────────────────────────────────────────

export async function logAction(
  agentId: string,
  type: string,
  input?: unknown,
  output?: unknown,
  durationMs?: number
): Promise<void> {
  await AgentAction.create({ agentId, type, input, output, durationMs });
}

export async function getSession(agentId: string): Promise<string | null> {
  const s = await AgentSession.findOne({ agentId }).sort({ lastActiveAt: -1 });
  return s?.sessionId ?? null;
}

export async function saveSession(agentId: string, sessionId: string): Promise<void> {
  await AgentSession.findOneAndUpdate(
    { agentId },
    { sessionId, lastActiveAt: new Date() },
    { upsert: true, new: true }
  );
}
