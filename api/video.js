// Zona Hot · servidor de vídeo (Vercel) · provedor: Kafox (paga em reais).
// A chave do Kafox fica só aqui (variável de ambiente), nunca no HTML.
// Variável obrigatória (painel da Vercel): KAFOX_API_KEY
// Opcional: KAFOX_MODEL (padrão wan-3, sem censura; wan-2.2 exige imagem inicial)
// Login: confere o token do Supabase, igual ao chat.js.
//
// Uso (POST, com Authorization: Bearer <token do usuário>):
//   { "action": "create", "prompt": "...", "imageUrl": "https://...", "duration": 5, "resolution": "480p" }
//   -> { "done": true, "videoUrl": "https://..." }
//   ou { "done": false, "id": "..." } se o Kafox devolver uma tarefa em andamento
//   Para o primeiro teste, mande "debug": true e a resposta traz um trecho do que o Kafox respondeu.

const SB_URL = process.env.SUPABASE_URL || 'https://hpttttewjywpiembcwwu.supabase.co';
const SB_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_yrjJkdljB3IOa4YSmwBAeA_ElgeJ0Um';
const API = 'https://api.kafox.dev/v1';
const MODEL = process.env.KAFOX_MODEL || 'wan-3';

const RESOLUTIONS = ['480p', '720p'];
const MAX_DURATION = 5;        // trava de custo: nunca passa de 5 s
const MAX_CREATE_PER_HOUR = 5; // trava de custo por usuário

const hits = new Map();
function limited(key, max, win) {
  const now = Date.now();
  const a = (hits.get(key) || []).filter(t => now - t < win);
  a.push(now); hits.set(key, a);
  return a.length > max;
}

const okTokens = new Map();
async function checkUser(token) {
  const now = Date.now();
  const c = okTokens.get(token);
  if (c && c.until > now) return c.id;
  try {
    const r = await fetch(SB_URL + '/auth/v1/user', {
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + token },
    });
    if (!r.ok) return null;
    const u = await r.json().catch(() => null);
    if (!u || !u.id) return null;
    if (okTokens.size > 500) okTokens.clear();
    okTokens.set(token, { id: u.id, until: now + 60_000 });
    return u.id;
  } catch { return null; }
}

// Procura um link de vídeo em qualquer lugar da resposta do Kafox.
function findVideoUrl(x) {
  if (!x) return null;
  const s = typeof x === 'string' ? x : JSON.stringify(x);
  const m = s.match(/https?:\/\/[^\s"'\\)\]]+?\.(?:mp4|webm|mov)(?:\?[^\s"'\\)\]]*)?/i);
  if (m) return m[0];
  const any = s.match(/https?:\/\/[^\s"'\\)\]]+/i);
  return any ? any[0] : null;
}

async function kafox(path, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 55_000);
  try {
    const r = await fetch(API + path, {
      ...opts,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + process.env.KAFOX_API_KEY,
      },
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { ok: r.ok, status: r.status, json, text };
  } finally { clearTimeout(t); }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  if (!process.env.KAFOX_API_KEY) return res.status(500).json({ error: 'Chave de vídeo não configurada no servidor' });
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Entre na sua conta para gerar vídeo' });
  const uid = await checkUser(token);
  if (!uid) return res.status(401).json({ error: 'Sessão expirou. Entre de novo.' });
  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const action = String(body.action || '');
  try {
    if (action === 'create') {
      if (limited('c:' + uid, MAX_CREATE_PER_HOUR, 3_600_000)) return res.status(429).json({ error: 'Limite de vídeos por hora atingido. Tente mais tarde.' });
      const prompt = String(body.prompt || '').trim().slice(0, 2000);
      if (prompt.length < 3) return res.status(400).json({ error: 'Escreva o que você quer no vídeo' });
      let duration = parseInt(body.duration, 10);
      if (!(duration >= 2)) duration = 5;
      if (duration > MAX_DURATION) duration = MAX_DURATION;
      const resolution = RESOLUTIONS.includes(String(body.resolution)) ? String(body.resolution) : '480p';
      const imageUrl = String(body.imageUrl || '').trim();
      let content = prompt;
      if (imageUrl) {
        if (!/^(https:\/\/|data:image\/)/i.test(imageUrl)) return res.status(400).json({ error: 'A imagem precisa ser um link https' });
        content = [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageUrl } }];
      }
      const r = await kafox('/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'user', content }],
          duration,
          resolution,
          aspect_ratio: '9:16',
          generate_audio: false,
          ...(imageUrl ? { image: imageUrl } : {}),
        }),
      });
      const debug = body.debug ? { debug: String(r.text || '').slice(0, 1500), httpStatus: r.status } : {};
      if (!r.ok) return res.status(502).json({ error: 'O gerador de vídeo recusou o pedido', ...debug });
      const videoUrl = findVideoUrl(r.json || r.text);
      if (videoUrl) return res.status(200).json({ done: true, videoUrl, ...debug });
      const id = r.json && (r.json.id || (r.json.data && r.json.data.id));
      if (id) return res.status(200).json({ done: false, id: String(id), ...debug });
      return res.status(502).json({ error: 'O gerador não devolveu um vídeo. Rode de novo com debug.', ...debug });
    }
    return res.status(400).json({ error: 'Ação inválida' });
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? 'O vídeo demorou demais. Tente de novo.' : 'Erro no servidor de vídeo';
    return res.status(500).json({ error: msg });
  }
};
