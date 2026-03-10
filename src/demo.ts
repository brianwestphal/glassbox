import { saveGuidedReviewConfig } from './ai/config.js';
import { appendFileScores, createAnalysis, saveUserPreferences, updateAnalysisStatus } from './db/ai-queries.js';
import { addAnnotation, addReviewFile, createReview } from './db/queries.js';
import type { FileDiff } from './git/diff.js';

export interface DemoScenario {
  id: number;
  label: string;
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  { id: 1, label: 'Main UI with guided review notes' },
  { id: 2, label: 'Risk mode with inline risk notes' },
  { id: 3, label: 'Narrative mode with walkthrough notes' },
  { id: 4, label: 'Annotations with different categories' },
  { id: 5, label: 'Settings dialog with guided review' },
];

// --- Fake file diffs ---

const DEMO_FILES: Array<{ path: string; status: 'added' | 'modified' | 'deleted'; hunks: FileDiff['hunks'] }> = [
  {
    path: 'src/auth/session.ts',
    status: 'modified',
    hunks: [{
      oldStart: 1, oldCount: 18, newStart: 1, newCount: 28,
      lines: [
        { type: 'context', oldNum: 1, newNum: 1, content: "import { randomBytes } from 'crypto';" },
        { type: 'context', oldNum: 2, newNum: 2, content: "import type { Request, Response } from 'express';" },
        { type: 'add', oldNum: null, newNum: 3, content: "import { redis } from '../db/redis.js';" },
        { type: 'context', oldNum: 3, newNum: 4, content: '' },
        { type: 'context', oldNum: 4, newNum: 5, content: 'export interface Session {' },
        { type: 'context', oldNum: 5, newNum: 6, content: '  id: string;' },
        { type: 'context', oldNum: 6, newNum: 7, content: '  userId: string;' },
        { type: 'remove', oldNum: 7, newNum: null, content: '  expiresAt: number;' },
        { type: 'add', oldNum: null, newNum: 8, content: '  expiresAt: Date;' },
        { type: 'add', oldNum: null, newNum: 9, content: '  refreshToken: string;' },
        { type: 'context', oldNum: 8, newNum: 10, content: '}' },
        { type: 'context', oldNum: 9, newNum: 11, content: '' },
        { type: 'remove', oldNum: 10, newNum: null, content: 'const sessions = new Map<string, Session>();' },
        { type: 'add', oldNum: null, newNum: 12, content: 'const SESSION_TTL = 60 * 60 * 24; // 24 hours' },
        { type: 'context', oldNum: 11, newNum: 13, content: '' },
        { type: 'remove', oldNum: 12, newNum: null, content: 'export function createSession(userId: string): Session {' },
        { type: 'remove', oldNum: 13, newNum: null, content: '  const session: Session = {' },
        { type: 'remove', oldNum: 14, newNum: null, content: "    id: randomBytes(32).toString('hex')," },
        { type: 'remove', oldNum: 15, newNum: null, content: '    userId,' },
        { type: 'remove', oldNum: 16, newNum: null, content: '    expiresAt: Date.now() + 86400000,' },
        { type: 'remove', oldNum: 17, newNum: null, content: '  };' },
        { type: 'remove', oldNum: 18, newNum: null, content: '  sessions.set(session.id, session);' },
        { type: 'add', oldNum: null, newNum: 14, content: 'export async function createSession(userId: string): Promise<Session> {' },
        { type: 'add', oldNum: null, newNum: 15, content: "  const id = randomBytes(32).toString('hex');" },
        { type: 'add', oldNum: null, newNum: 16, content: "  const refreshToken = randomBytes(48).toString('hex');" },
        { type: 'add', oldNum: null, newNum: 17, content: '  const session: Session = {' },
        { type: 'add', oldNum: null, newNum: 18, content: '    id,' },
        { type: 'add', oldNum: null, newNum: 19, content: '    userId,' },
        { type: 'add', oldNum: null, newNum: 20, content: '    expiresAt: new Date(Date.now() + SESSION_TTL * 1000),' },
        { type: 'add', oldNum: null, newNum: 21, content: '    refreshToken,' },
        { type: 'add', oldNum: null, newNum: 22, content: '  };' },
        { type: 'add', oldNum: null, newNum: 23, content: "  await redis.set(`session:${id}`, JSON.stringify(session), 'EX', SESSION_TTL);" },
        { type: 'context', oldNum: 19, newNum: 24, content: '  return session;' },
        { type: 'context', oldNum: 20, newNum: 25, content: '}' },
        { type: 'context', oldNum: 21, newNum: 26, content: '' },
        { type: 'add', oldNum: null, newNum: 27, content: 'export async function validateSession(id: string): Promise<Session | null> {' },
        { type: 'add', oldNum: null, newNum: 28, content: "  const raw = await redis.get(`session:${id}`);" },
        { type: 'add', oldNum: null, newNum: 29, content: '  if (raw === null) return null;' },
        { type: 'add', oldNum: null, newNum: 30, content: '  const session = JSON.parse(raw) as Session;' },
        { type: 'add', oldNum: null, newNum: 31, content: '  if (new Date(session.expiresAt) < new Date()) return null;' },
        { type: 'add', oldNum: null, newNum: 32, content: '  return session;' },
        { type: 'add', oldNum: null, newNum: 33, content: '}' },
      ],
    }],
  },
  {
    path: 'src/api/routes/users.ts',
    status: 'modified',
    hunks: [{
      oldStart: 12, oldCount: 10, newStart: 12, newCount: 16,
      lines: [
        { type: 'context', oldNum: 12, newNum: 12, content: "router.post('/login', async (req, res) => {" },
        { type: 'context', oldNum: 13, newNum: 13, content: '  const { email, password } = req.body;' },
        { type: 'add', oldNum: null, newNum: 14, content: '' },
        { type: 'add', oldNum: null, newNum: 15, content: '  if (!email || !password) {' },
        { type: 'add', oldNum: null, newNum: 16, content: "    return res.status(400).json({ error: 'Missing credentials' });" },
        { type: 'add', oldNum: null, newNum: 17, content: '  }' },
        { type: 'context', oldNum: 14, newNum: 18, content: '' },
        { type: 'context', oldNum: 15, newNum: 19, content: '  const user = await findUserByEmail(email);' },
        { type: 'remove', oldNum: 16, newNum: null, content: '  if (!user || user.password !== password) {' },
        { type: 'add', oldNum: null, newNum: 20, content: '  if (!user || !(await verifyPassword(password, user.passwordHash))) {' },
        { type: 'context', oldNum: 17, newNum: 21, content: "    return res.status(401).json({ error: 'Invalid credentials' });" },
        { type: 'context', oldNum: 18, newNum: 22, content: '  }' },
        { type: 'context', oldNum: 19, newNum: 23, content: '' },
        { type: 'remove', oldNum: 20, newNum: null, content: '  const session = createSession(user.id);' },
        { type: 'add', oldNum: null, newNum: 24, content: '  const session = await createSession(user.id);' },
        { type: 'add', oldNum: null, newNum: 25, content: "  res.cookie('sid', session.id, { httpOnly: true, secure: true, sameSite: 'strict' });" },
        { type: 'context', oldNum: 21, newNum: 26, content: '  res.json({ ok: true });' },
        { type: 'context', oldNum: 22, newNum: 27, content: '});' },
      ],
    }],
  },
  {
    path: 'src/db/redis.ts',
    status: 'added',
    hunks: [{
      oldStart: 0, oldCount: 0, newStart: 1, newCount: 12,
      lines: [
        { type: 'add', oldNum: null, newNum: 1, content: "import Redis from 'ioredis';" },
        { type: 'add', oldNum: null, newNum: 2, content: '' },
        { type: 'add', oldNum: null, newNum: 3, content: "const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';" },
        { type: 'add', oldNum: null, newNum: 4, content: '' },
        { type: 'add', oldNum: null, newNum: 5, content: 'export const redis = new Redis(REDIS_URL, {' },
        { type: 'add', oldNum: null, newNum: 6, content: '  maxRetriesPerRequest: 3,' },
        { type: 'add', oldNum: null, newNum: 7, content: '  retryStrategy(times) {' },
        { type: 'add', oldNum: null, newNum: 8, content: '    return Math.min(times * 200, 5000);' },
        { type: 'add', oldNum: null, newNum: 9, content: '  },' },
        { type: 'add', oldNum: null, newNum: 10, content: '});' },
        { type: 'add', oldNum: null, newNum: 11, content: '' },
        { type: 'add', oldNum: null, newNum: 12, content: "redis.on('error', (err) => console.error('Redis error:', err));" },
      ],
    }],
  },
  {
    path: 'src/middleware/auth.ts',
    status: 'modified',
    hunks: [{
      oldStart: 1, oldCount: 8, newStart: 1, newCount: 14,
      lines: [
        { type: 'context', oldNum: 1, newNum: 1, content: "import type { NextFunction, Request, Response } from 'express';" },
        { type: 'remove', oldNum: 2, newNum: null, content: "import { getSession } from '../auth/session.js';" },
        { type: 'add', oldNum: null, newNum: 2, content: "import { validateSession } from '../auth/session.js';" },
        { type: 'context', oldNum: 3, newNum: 3, content: '' },
        { type: 'remove', oldNum: 4, newNum: null, content: 'export function requireAuth(req: Request, res: Response, next: NextFunction) {' },
        { type: 'remove', oldNum: 5, newNum: null, content: "  const session = getSession(req.cookies.sid);" },
        { type: 'remove', oldNum: 6, newNum: null, content: '  if (!session) return res.status(401).end();' },
        { type: 'add', oldNum: null, newNum: 4, content: 'export async function requireAuth(req: Request, res: Response, next: NextFunction) {' },
        { type: 'add', oldNum: null, newNum: 5, content: '  const sid = req.cookies.sid ?? req.headers.authorization?.replace(/^Bearer /, \'\');' },
        { type: 'add', oldNum: null, newNum: 6, content: '  if (!sid) return res.status(401).json({ error: \'Not authenticated\' });' },
        { type: 'add', oldNum: null, newNum: 7, content: '' },
        { type: 'add', oldNum: null, newNum: 8, content: '  const session = await validateSession(sid);' },
        { type: 'add', oldNum: null, newNum: 9, content: '  if (!session) return res.status(401).json({ error: \'Session expired\' });' },
        { type: 'context', oldNum: 7, newNum: 10, content: '' },
        { type: 'context', oldNum: 8, newNum: 11, content: '  req.userId = session.userId;' },
        { type: 'add', oldNum: null, newNum: 12, content: '  req.sessionId = session.id;' },
        { type: 'context', oldNum: 9, newNum: 13, content: '  next();' },
        { type: 'context', oldNum: 10, newNum: 14, content: '}' },
      ],
    }],
  },
  {
    path: 'src/utils/password.ts',
    status: 'added',
    hunks: [{
      oldStart: 0, oldCount: 0, newStart: 1, newCount: 11,
      lines: [
        { type: 'add', oldNum: null, newNum: 1, content: "import bcrypt from 'bcrypt';" },
        { type: 'add', oldNum: null, newNum: 2, content: '' },
        { type: 'add', oldNum: null, newNum: 3, content: 'const SALT_ROUNDS = 12;' },
        { type: 'add', oldNum: null, newNum: 4, content: '' },
        { type: 'add', oldNum: null, newNum: 5, content: 'export async function hashPassword(password: string): Promise<string> {' },
        { type: 'add', oldNum: null, newNum: 6, content: '  return bcrypt.hash(password, SALT_ROUNDS);' },
        { type: 'add', oldNum: null, newNum: 7, content: '}' },
        { type: 'add', oldNum: null, newNum: 8, content: '' },
        { type: 'add', oldNum: null, newNum: 9, content: 'export async function verifyPassword(password: string, hash: string): Promise<boolean> {' },
        { type: 'add', oldNum: null, newNum: 10, content: '  return bcrypt.compare(password, hash);' },
        { type: 'add', oldNum: null, newNum: 11, content: '}' },
      ],
    }],
  },
  {
    path: 'tests/auth.test.ts',
    status: 'added',
    hunks: [{
      oldStart: 0, oldCount: 0, newStart: 1, newCount: 15,
      lines: [
        { type: 'add', oldNum: null, newNum: 1, content: "import { describe, expect, it } from 'vitest';" },
        { type: 'add', oldNum: null, newNum: 2, content: "import { createSession, validateSession } from '../src/auth/session.js';" },
        { type: 'add', oldNum: null, newNum: 3, content: '' },
        { type: 'add', oldNum: null, newNum: 4, content: "describe('Session management', () => {" },
        { type: 'add', oldNum: null, newNum: 5, content: "  it('creates and validates a session', async () => {" },
        { type: 'add', oldNum: null, newNum: 6, content: "    const session = await createSession('user-1');" },
        { type: 'add', oldNum: null, newNum: 7, content: '    expect(session.id).toBeDefined();' },
        { type: 'add', oldNum: null, newNum: 8, content: "    expect(session.userId).toBe('user-1');" },
        { type: 'add', oldNum: null, newNum: 9, content: '' },
        { type: 'add', oldNum: null, newNum: 10, content: '    const valid = await validateSession(session.id);' },
        { type: 'add', oldNum: null, newNum: 11, content: '    expect(valid).not.toBeNull();' },
        { type: 'add', oldNum: null, newNum: 12, content: '  });' },
        { type: 'add', oldNum: null, newNum: 13, content: '' },
        { type: 'add', oldNum: null, newNum: 14, content: "  it('rejects expired sessions', async () => {" },
        { type: 'add', oldNum: null, newNum: 15, content: "    const result = await validateSession('nonexistent');" },
        { type: 'add', oldNum: null, newNum: 16, content: '    expect(result).toBeNull();' },
        { type: 'add', oldNum: null, newNum: 17, content: '  });' },
        { type: 'add', oldNum: null, newNum: 18, content: '});' },
      ],
    }],
  },
  {
    path: 'package.json',
    status: 'modified',
    hunks: [{
      oldStart: 10, oldCount: 3, newStart: 10, newCount: 5,
      lines: [
        { type: 'context', oldNum: 10, newNum: 10, content: '  "dependencies": {' },
        { type: 'context', oldNum: 11, newNum: 11, content: '    "express": "^4.18.2",' },
        { type: 'add', oldNum: null, newNum: 12, content: '    "bcrypt": "^5.1.1",' },
        { type: 'add', oldNum: null, newNum: 13, content: '    "ioredis": "^5.3.2",' },
        { type: 'context', oldNum: 12, newNum: 14, content: '    "typescript": "^5.3.0"' },
      ],
    }],
  },
];

// --- Guided review notes ---

const GUIDED_NOTES: Record<string, { overview: string; lines: Array<{ line: number; content: string }> }> = {
  'src/auth/session.ts': {
    overview: 'This file manages user sessions — the mechanism that keeps you logged in across requests. The change migrates from in-memory storage (a Map) to Redis, which persists sessions across server restarts and works in multi-server deployments.',
    lines: [
      { line: 3, content: "Redis is an in-memory data store that runs as a separate process. Unlike a JavaScript Map, data in Redis survives server restarts and can be shared across multiple server instances." },
      { line: 8, content: "Changed from a number (Unix timestamp) to a Date object. Date objects are more readable and less error-prone than raw milliseconds — compare 'new Date() > expiresAt' vs 'Date.now() > expiresAt'." },
      { line: 9, content: "A refresh token allows the client to get a new session without re-entering credentials. This is a security best practice — short-lived sessions with refresh tokens limit the damage if a session ID is stolen." },
      { line: 12, content: "Defining the TTL as a named constant makes the code self-documenting. The '60 * 60 * 24' expression is clearer than a magic number like 86400." },
      { line: 23, content: "Template literals (backtick strings) let you embed expressions with ${...}. The 'EX' flag tells Redis to automatically delete this key after SESSION_TTL seconds — no need for manual cleanup." },
      { line: 30, content: "JSON.parse returns 'unknown' in strict TypeScript. The 'as Session' is a type assertion telling the compiler to trust that the stored JSON matches the Session shape." },
    ],
  },
  'src/api/routes/users.ts': {
    overview: 'The login route now validates input, uses proper password hashing instead of plaintext comparison, and sets a secure HTTP cookie. These are fundamental security improvements.',
    lines: [
      { line: 15, content: "Input validation is a key security practice. Always verify that required fields exist before using them — this prevents crashes from undefined values and makes error messages more helpful." },
      { line: 20, content: "verifyPassword uses bcrypt to compare the plaintext password against a stored hash. The old code compared passwords directly, which means passwords were stored in plaintext — a critical security vulnerability." },
      { line: 25, content: "httpOnly prevents JavaScript from reading the cookie (mitigates XSS attacks). 'secure' ensures it's only sent over HTTPS. 'sameSite: strict' prevents the cookie from being sent in cross-site requests (mitigates CSRF attacks)." },
    ],
  },
  'src/db/redis.ts': {
    overview: 'A new module that initializes the Redis connection. It reads the connection URL from an environment variable with a sensible local default, and includes retry logic for resilience.',
    lines: [
      { line: 3, content: "The nullish coalescing operator (??) returns the right side only if the left is null or undefined. This gives you a fallback: use the env variable if set, otherwise default to localhost." },
      { line: 7, content: "A retry strategy controls what happens when Redis is temporarily unreachable. This implements exponential backoff — waiting longer between each retry, capped at 5 seconds — to avoid overwhelming a recovering server." },
      { line: 12, content: "Listening for 'error' events prevents unhandled exceptions from crashing the process. In Node.js, an EventEmitter that emits 'error' with no listener will throw." },
    ],
  },
  'src/middleware/auth.ts': {
    overview: 'The auth middleware now supports both cookie-based and Bearer token authentication, and returns proper JSON error responses instead of empty 401s.',
    lines: [
      { line: 5, content: "Optional chaining (?.) safely accesses properties that might not exist. This line checks for a session ID in cookies first, then falls back to an Authorization header — supporting both browser and API clients." },
      { line: 12, content: "Attaching the session ID to the request object makes it available to downstream route handlers. This is a common Express pattern called 'request augmentation'." },
    ],
  },
  'src/utils/password.ts': {
    overview: 'A utility module for securely hashing and verifying passwords using bcrypt. Bcrypt is an industry-standard algorithm specifically designed for password hashing.',
    lines: [
      { line: 3, content: "Salt rounds control how computationally expensive the hash is. 12 rounds means 2^12 (4,096) iterations. Higher is more secure but slower — 12 is a good balance for most applications." },
      { line: 6, content: "bcrypt.hash automatically generates a random salt and embeds it in the output. You never need to store the salt separately — it's included in the hash string itself." },
      { line: 10, content: "bcrypt.compare is timing-safe, meaning it takes the same amount of time regardless of where the mismatch occurs. This prevents timing attacks where an attacker measures response times to guess the hash character by character." },
    ],
  },
};

// --- Risk scores ---

const RISK_SCORES: Array<{ path: string; aggregate: number; scores: Record<string, number>; rationale: string; notes: { overview: string; lines: Array<{ line: number; content: string }> } }> = [
  {
    path: 'src/auth/session.ts',
    aggregate: 0.65,
    scores: { security: 0.65, correctness: 0.4, 'error-handling': 0.5, maintainability: 0.2, architecture: 0.3, performance: 0.15 },
    rationale: 'Session data is JSON-serialized without schema validation. Redis key construction uses string interpolation which could be exploited if session IDs contain special characters.',
    notes: {
      overview: 'Moderate security risk from unvalidated deserialization and potential Redis key injection.',
      lines: [
        { line: 23, content: "Template literal in Redis key — if 'id' ever contains colons or special Redis characters, this could cause key collisions or unexpected behavior." },
        { line: 30, content: 'JSON.parse without validation — a corrupted Redis entry would cause a runtime crash. Consider wrapping in try/catch or using a schema validator like zod.' },
      ],
    },
  },
  {
    path: 'src/api/routes/users.ts',
    aggregate: 0.45,
    scores: { security: 0.45, correctness: 0.3, 'error-handling': 0.35, maintainability: 0.2, architecture: 0.15, performance: 0.1 },
    rationale: 'Login route has good input validation and secure cookie settings, but lacks rate limiting which makes it vulnerable to brute-force attacks.',
    notes: {
      overview: 'Solid authentication improvements, but missing rate limiting on the login endpoint.',
      lines: [
        { line: 12, content: 'No rate limiting on login attempts. Consider adding express-rate-limit to prevent brute-force attacks.' },
      ],
    },
  },
  {
    path: 'src/db/redis.ts',
    aggregate: 0.35,
    scores: { security: 0.35, correctness: 0.2, 'error-handling': 0.3, maintainability: 0.1, architecture: 0.15, performance: 0.1 },
    rationale: 'Redis connection is established at module load time. If Redis is down, the import itself will start retrying, which could delay application startup.',
    notes: {
      overview: 'Minor risk from eager connection initialization. Connection errors are handled but could delay startup.',
      lines: [
        { line: 5, content: 'Connection is created at import time. Consider lazy initialization to avoid blocking app startup if Redis is temporarily unavailable.' },
      ],
    },
  },
  {
    path: 'src/middleware/auth.ts',
    aggregate: 0.3,
    scores: { security: 0.3, correctness: 0.2, 'error-handling': 0.15, maintainability: 0.1, architecture: 0.1, performance: 0.1 },
    rationale: 'Auth middleware correctly validates sessions but the Bearer token extraction could be tighter.',
    notes: {
      overview: 'Low risk. Bearer token parsing is functional but could be more strict with format validation.',
      lines: [
        { line: 5, content: "The regex replace is loose — it only strips 'Bearer ' prefix but doesn't validate the token format. A malformed Authorization header would pass through." },
      ],
    },
  },
  {
    path: 'src/utils/password.ts',
    aggregate: 0.1,
    scores: { security: 0.1, correctness: 0.05, 'error-handling': 0.1, maintainability: 0.05, architecture: 0.05, performance: 0.1 },
    rationale: 'Well-implemented password hashing with appropriate salt rounds. No significant concerns.',
    notes: {
      overview: 'Clean, secure implementation. Salt rounds are appropriate for production use.',
      lines: [],
    },
  },
  {
    path: 'tests/auth.test.ts',
    aggregate: 0.05,
    scores: { security: 0.0, correctness: 0.05, 'error-handling': 0.0, maintainability: 0.05, architecture: 0.0, performance: 0.0 },
    rationale: 'Test file with basic coverage. Consider adding tests for edge cases like expired sessions and concurrent access.',
    notes: {
      overview: 'Basic test coverage. No security or correctness risks in test code itself.',
      lines: [],
    },
  },
  {
    path: 'package.json',
    aggregate: 0.15,
    scores: { security: 0.15, correctness: 0.0, 'error-handling': 0.0, maintainability: 0.05, architecture: 0.0, performance: 0.0 },
    rationale: 'New dependencies are well-known and maintained. Bcrypt 5.x uses N-API bindings which are stable.',
    notes: {
      overview: 'Low risk. Dependencies are well-maintained and widely used.',
      lines: [],
    },
  },
];

// --- Narrative order ---

const NARRATIVE_ORDER: Array<{ path: string; position: number; rationale: string; notes: { overview: string; lines: Array<{ line: number; content: string }> } }> = [
  { path: 'src/utils/password.ts', position: 1, rationale: 'Start with this utility — it introduces the bcrypt dependency used by the login route.', notes: { overview: 'Read first: this new utility module is a building block used by the authentication changes that follow.', lines: [{ line: 3, content: 'This salt rounds constant is referenced conceptually in the login route changes.' }] } },
  { path: 'src/db/redis.ts', position: 2, rationale: 'Redis client setup — needed to understand the session storage migration.', notes: { overview: 'Read second: the Redis client created here replaces the in-memory Map used for sessions.', lines: [{ line: 5, content: 'This exported redis instance is imported by the session module next.' }] } },
  { path: 'src/auth/session.ts', position: 3, rationale: 'Core session changes — depends on Redis client, used by auth middleware.', notes: { overview: 'The main change: sessions move from an in-memory Map to Redis. The interface gains a refresh token and the functions become async.', lines: [{ line: 14, content: 'Note this is now async — all callers need to be updated to await the result.' }, { line: 27, content: 'New function that replaces the old synchronous getSession.' }] } },
  { path: 'src/middleware/auth.ts', position: 4, rationale: 'Auth middleware — consumes the new async session API.', notes: { overview: 'Updated to use the new async validateSession. Also adds Bearer token support for API clients.', lines: [{ line: 4, content: 'Changed to async to accommodate the Redis-backed session lookup.' }] } },
  { path: 'src/api/routes/users.ts', position: 5, rationale: 'Login route — integrates password hashing and new session creation.', notes: { overview: 'The login endpoint ties together the password utility and session changes.', lines: [{ line: 20, content: 'This is where verifyPassword (from step 1) gets used in practice.' }, { line: 24, content: 'The await here is new — createSession is now async because of the Redis migration.' }] } },
  { path: 'package.json', position: 6, rationale: 'Dependencies — confirms bcrypt and ioredis were added.', notes: { overview: 'Quick check: the two new dependencies (bcrypt, ioredis) that the code changes require.', lines: [] } },
  { path: 'tests/auth.test.ts', position: 7, rationale: 'Tests — read last to verify the changes work correctly.', notes: { overview: 'Tests for the session management changes. Read these last to confirm the new async API works as expected.', lines: [] } },
];

// --- Annotations ---

const ANNOTATIONS: Array<{ filePath: string; line: number; side: string; category: string; content: string }> = [
  { filePath: 'src/auth/session.ts', line: 23, side: 'new', category: 'bug', content: 'Redis key should be sanitized — if a session ID contains a colon, it will conflict with the key namespace.' },
  { filePath: 'src/auth/session.ts', line: 30, side: 'new', category: 'fix', content: 'Wrap JSON.parse in try/catch to handle corrupted Redis data gracefully instead of crashing.' },
  { filePath: 'src/auth/session.ts', line: 12, side: 'new', category: 'pattern-follow', content: 'Good use of a named constant instead of a magic number. This makes the TTL self-documenting.' },
  { filePath: 'src/api/routes/users.ts', line: 15, side: 'new', category: 'pattern-follow', content: 'Good input validation pattern — checking required fields early and returning a descriptive error.' },
  { filePath: 'src/api/routes/users.ts', line: 25, side: 'new', category: 'style', content: "Consider extracting cookie options into a shared constant so they're consistent across all cookie-setting code." },
  { filePath: 'src/api/routes/users.ts', line: 12, side: 'new', category: 'fix', content: 'Add rate limiting to prevent brute-force login attempts. Use express-rate-limit with a window of 15 minutes and max 5 attempts.' },
  { filePath: 'src/db/redis.ts', line: 5, side: 'new', category: 'note', content: 'Consider using lazy initialization so the app can start even if Redis is temporarily down.' },
  { filePath: 'src/middleware/auth.ts', line: 5, side: 'new', category: 'fix', content: "Validate the token format after extracting it. A regex like /^[a-f0-9]{64}$/ would reject malformed tokens early." },
  { filePath: 'src/utils/password.ts', line: 3, side: 'new', category: 'remember', content: 'Always use bcrypt or argon2 for password hashing. Never use SHA/MD5 for passwords.' },
];

// --- Setup functions ---

export async function setupDemoReview(scenario: number): Promise<{ reviewId: string }> {
  const repoRoot = process.cwd();

  // Create review
  const review = await createReview(repoRoot, 'demo-project', 'demo', `scenario-${String(scenario)}`);

  // Add files
  const fileIdMap = new Map<string, string>();
  for (const file of DEMO_FILES) {
    const diff: FileDiff = {
      filePath: file.path,
      oldPath: null,
      status: file.status,
      hunks: file.hunks,
      isBinary: false,
    };
    const rf = await addReviewFile(review.id, file.path, JSON.stringify(diff));
    fileIdMap.set(file.path, rf.id);
  }

  // Common: mark some files as reviewed
  const { updateFileStatus } = await import('./db/queries.js');
  const reviewedPaths = ['src/utils/password.ts', 'src/db/redis.ts', 'package.json'];
  for (const p of reviewedPaths) {
    const fid = fileIdMap.get(p);
    if (fid !== undefined) await updateFileStatus(fid, 'reviewed');
  }

  // Scenario-specific setup
  switch (scenario) {
    case 1: // Main UI with guided review notes
      await setupGuidedNotes(review.id, fileIdMap);
      saveGuidedReviewConfig({ enabled: true, topics: ['codebase', 'typescript'] });
      await saveUserPreferences({ sort_mode: 'folder' });
      break;

    case 2: // Risk mode
      await setupRiskScores(review.id, fileIdMap);
      await saveUserPreferences({ sort_mode: 'risk', show_risk_scores: true });
      break;

    case 3: // Narrative mode
      await setupNarrativeOrder(review.id, fileIdMap);
      await saveUserPreferences({ sort_mode: 'narrative' });
      break;

    case 4: // Annotations
      await setupAnnotations(fileIdMap);
      await saveUserPreferences({ sort_mode: 'folder' });
      break;

    case 5: // Settings dialog (just needs guided review enabled)
      saveGuidedReviewConfig({ enabled: true, topics: ['programming', 'codebase', 'typescript', 'javascript'] });
      await saveUserPreferences({ sort_mode: 'folder' });
      break;

    default:
      break;
  }

  return { reviewId: review.id };
}

async function setupGuidedNotes(reviewId: string, fileIdMap: Map<string, string>) {
  const analysis = await createAnalysis(reviewId, 'guided');
  const scores = Object.entries(GUIDED_NOTES).map(([path, notes], idx) => ({
    reviewFileId: fileIdMap.get(path) ?? '',
    filePath: path,
    sortOrder: idx,
    aggregateScore: null,
    rationale: null,
    dimensionScores: null,
    notes,
  }));
  await appendFileScores(analysis.id, scores);
  await updateAnalysisStatus(analysis.id, 'completed');
}

async function setupRiskScores(reviewId: string, fileIdMap: Map<string, string>) {
  const analysis = await createAnalysis(reviewId, 'risk');
  const sorted = RISK_SCORES.slice().sort((a, b) => b.aggregate - a.aggregate);
  const scores = sorted.map((r, idx) => ({
    reviewFileId: fileIdMap.get(r.path) ?? '',
    filePath: r.path,
    sortOrder: idx,
    aggregateScore: r.aggregate,
    rationale: r.rationale,
    dimensionScores: r.scores,
    notes: r.notes,
  }));
  await appendFileScores(analysis.id, scores);
  await updateAnalysisStatus(analysis.id, 'completed');
}

async function setupNarrativeOrder(reviewId: string, fileIdMap: Map<string, string>) {
  const analysis = await createAnalysis(reviewId, 'narrative');
  const scores = NARRATIVE_ORDER.map(r => ({
    reviewFileId: fileIdMap.get(r.path) ?? '',
    filePath: r.path,
    sortOrder: r.position,
    aggregateScore: null,
    rationale: r.rationale,
    dimensionScores: null,
    notes: r.notes,
  }));
  await appendFileScores(analysis.id, scores);
  await updateAnalysisStatus(analysis.id, 'completed');
}

async function setupAnnotations(fileIdMap: Map<string, string>) {
  for (const ann of ANNOTATIONS) {
    const fileId = fileIdMap.get(ann.filePath);
    if (fileId !== undefined) {
      await addAnnotation(fileId, ann.line, ann.side, ann.category, ann.content);
    }
  }
}
