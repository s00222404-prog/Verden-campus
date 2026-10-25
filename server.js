import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const BUCKET = process.env.STORAGE_BUCKET || 'assignments';
const ALLOWED_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const supabaseReady = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const supabase = supabaseReady
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(cors({
  origin(origin, callback) {
    const allowed = process.env.APP_ORIGIN;
    if (!origin || !allowed || origin === allowed) return callback(null, true);
    return callback(new Error('Origin not allowed'));
  }
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.static(publicDir, { extensions: ['html'] }));

const apiLimiter = rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: 'draft-8', legacyHeaders: false });
const pinLimiter = rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false });
app.use('/api', apiLimiter);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter(_req, file, callback) {
    if (!ALLOWED_MIME.has(file.mimetype)) return callback(new Error('Only PDF, PNG or JPG files are allowed'));
    callback(null, true);
  }
});

function needSupabase(_req, res, next) {
  if (!supabase) return res.status(503).json({ error: 'Backend is not configured: add Supabase environment variables.' });
  next();
}
function sha(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}
function secureEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function randomPin() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}
function cleanName(value, max = 80) {
  return String(value || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, max);
}
function isValidFile(file) {
  if (!file || file.size > MAX_FILE_BYTES || !ALLOWED_MIME.has(file.mimetype)) return false;
  const ext = path.extname(file.originalname || '').toLowerCase();
  return (file.mimetype === 'application/pdf' && ext === '.pdf') ||
    (file.mimetype === 'image/png' && ext === '.png') ||
    (file.mimetype === 'image/jpeg' && ['.jpg', '.jpeg'].includes(ext));
}
async function findActiveSession(pin) {
  const { data, error } = await supabase.from('sessions')
    .select('id, assignment_name, assignment_path, assignment_mime, status, expires_at')
    .eq('pin_hash', sha(pin)).eq('status', 'active').gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) throw error;
  return data;
}
async function teacherSession(req, res, next) {
  try {
    const token = req.get('x-teacher-token');
    const { id } = req.params;
    if (!token) return res.status(401).json({ error: 'Teacher token required.' });
    const { data, error } = await supabase.from('sessions')
      .select('id, teacher_token_hash, status, expires_at')
      .eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data || !secureEqual(data.teacher_token_hash, sha(token))) return res.status(403).json({ error: 'Access denied.' });
    req.session = data;
    next();
  } catch (error) {
    next(error);
  }
}

// Ping endpoint is intentionally available only during 08:00–13:15 Europe/Berlin.
app.get('/ping', (_req, res) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const minutes = Number(values.hour) * 60 + Number(values.minute);
  const active = minutes >= 480 && minutes <= 795;
  res.status(active ? 200 : 403).json({ ok: active, service: 'CampusFlow LIVE', window: '08:00–13:15 Europe/Berlin' });
});
app.get('/health', (_req, res) => res.json({ ok: true, configured: supabaseReady }));
app.get('/api/config-status', (_req, res) => res.json({ configured: supabaseReady }));

app.post('/api/teacher/sessions', needSupabase, async (req, res, next) => {
  try {
    const configuredKey = process.env.TEACHER_ACCESS_KEY;
    if (!configuredKey || !secureEqual(req.get('x-teacher-key'), configuredKey)) {
      return res.status(403).json({ error: 'Teacher access key is invalid.' });
    }
    let pin, existing;
    for (let i = 0; i < 10; i++) {
      pin = randomPin();
      const result = await supabase.from('sessions').select('id').eq('pin_hash', sha(pin)).maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) { existing = false; break; }
    }
    if (existing !== false) return res.status(503).json({ error: 'Could not allocate a session PIN. Try again.' });
    const teacherToken = crypto.randomBytes(32).toString('base64url');
    const { data, error } = await supabase.from('sessions').insert({
      pin_hash: sha(pin),
      teacher_token_hash: sha(teacherToken),
      status: 'active',
      expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
    }).select('id, created_at, expires_at').single();
    if (error) throw error;
    res.status(201).json({ id: data.id, pin, teacherToken, createdAt: data.created_at, expiresAt: data.expires_at });
  } catch (error) { next(error); }
});

app.post('/api/teacher/sessions/:id/assignment', needSupabase, teacherSession, upload.single('file'), async (req, res, next) => {
  try {
    if (req.session.status !== 'active') return res.status(409).json({ error: 'Session is closed.' });
    if (!req.file || !isValidFile(req.file)) return res.status(400).json({ error: 'Choose a PDF, PNG or JPG file up to 5 MB.' });
    const safeName = cleanName(req.file.originalname, 100).replace(/[^a-zA-Z0-9._-]/g, '_') || 'assignment';
    const objectPath = 'sessions/' + req.params.id + '/assignment-' + crypto.randomUUID() + '-' + safeName;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(objectPath, req.file.buffer, {
      contentType: req.file.mimetype, upsert: false
    });
    if (uploadError) throw uploadError;
    const { error } = await supabase.from('sessions').update({
      assignment_name: safeName,
      assignment_path: objectPath,
      assignment_mime: req.file.mimetype,
      assignment_size: req.file.size
    }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true, assignmentName: safeName });
  } catch (error) { next(error); }
});

app.get('/api/teacher/sessions/:id/submissions', needSupabase, teacherSession, async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('submissions')
      .select('id, student_name, answer_text, file_path, file_mime, file_size, created_at, opened_at')
      .eq('session_id', req.params.id).order('created_at', { ascending: true });
    if (error) throw error;
    const rows = await Promise.all((data || []).map(async row => {
      let fileUrl = null;
      if (row.file_path) {
        const signed = await supabase.storage.from(BUCKET).createSignedUrl(row.file_path, 300);
        if (!signed.error) fileUrl = signed.data.signedUrl;
      }
      return { ...row, fileUrl };
    }));
    res.json({ submissions: rows });
  } catch (error) { next(error); }
});

app.post('/api/teacher/sessions/:id/submissions/:submissionId/open', needSupabase, teacherSession, async (req, res, next) => {
  try {
    const { error } = await supabase.from('submissions').update({ opened_at: new Date().toISOString() })
      .eq('id', req.params.submissionId).eq('session_id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.post('/api/teacher/sessions/:id/close', needSupabase, teacherSession, async (req, res, next) => {
  try {
    const { error } = await supabase.from('sessions')
      .update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.post('/api/student/session', needSupabase, pinLimiter, async (req, res, next) => {
  try {
    const pin = String(req.body?.pin || '');
    if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'Enter the 4-digit session PIN.' });
    const session = await findActiveSession(pin);
    if (!session) return res.status(404).json({ error: 'Session not found or expired.' });
    if (!session.assignment_path) return res.status(409).json({ error: 'The teacher has not uploaded an assignment yet.' });
    const signed = await supabase.storage.from(BUCKET).createSignedUrl(session.assignment_path, 300);
    if (signed.error) throw signed.error;
    res.json({ id: session.id, assignmentName: session.assignment_name, assignmentUrl: signed.data.signedUrl, expiresAt: session.expires_at });
  } catch (error) { next(error); }
});

app.post('/api/student/session/:id/submissions', needSupabase, pinLimiter, upload.single('file'), async (req, res, next) => {
  try {
    const pin = String(req.body?.pin || '');
    if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'Enter the 4-digit session PIN.' });
    const session = await findActiveSession(pin);
    if (!session || session.id !== req.params.id) return res.status(403).json({ error: 'This session is not active.' });
    const answerText = String(req.body?.answerText || '').trim().slice(0, 10000);
    if (!answerText && !req.file) return res.status(400).json({ error: 'Write an answer or attach a file.' });
    let filePath = null, fileMime = null, fileSize = null;
    if (req.file) {
      if (!isValidFile(req.file)) return res.status(400).json({ error: 'Choose a PDF, PNG or JPG file up to 5 MB.' });
      filePath = 'sessions/' + session.id + '/submissions/' + crypto.randomUUID() + '-' + (cleanName(req.file.originalname, 100).replace(/[^a-zA-Z0-9._-]/g, '_') || 'answer');
      const { error: storageError } = await supabase.storage.from(BUCKET).upload(filePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
      if (storageError) throw storageError;
      fileMime = req.file.mimetype;
      fileSize = req.file.size;
    }
    const { data, error } = await supabase.from('submissions').insert({
      session_id: session.id,
      student_name: cleanName(req.body?.studentName, 60) || 'Student',
      answer_text: answerText || null,
      file_path: filePath,
      file_mime: fileMime,
      file_size: fileSize
    }).select('id, created_at').single();
    if (error) throw error;
    res.status(201).json({ ok: true, id: data.id, createdAt: data.created_at });
  } catch (error) { next(error); }
});

app.get('/api/teacher/sessions/:id', needSupabase, teacherSession, async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('sessions').select('id, status, assignment_name, created_at, expires_at').eq('id', req.params.id).single();
    if (error) throw error;
    res.json(data);
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File is larger than 5 MB.' });
  }
  if (error.message === 'Origin not allowed') return res.status(403).json({ error: error.message });
  console.error('Request failed:', error.message);
  res.status(500).json({ error: 'Something went wrong. Check server logs.' });
});

app.listen(PORT, () => console.log('CampusFlow LIVE API listening on port ' + PORT));
