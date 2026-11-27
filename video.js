// Zona Hot · servidor de vídeo (Vercel). A chave do makefun.ai fica só aqui, nunca no HTML.
// Variável de ambiente (painel da Vercel): MAKEFUN_API_KEY  (obrigatória)
// Opcional: MAKEFUN_MODEL (padrão wan3.0-video; use wan3.0-video-prime para sair mais rápido, porém mais caro)
// Login: confere o token do Supabase, igual ao chat.js.
//
// Uso (POST, com Authorization: Bearer <token do usuário>):
//   { "action": "create", "prompt": "...", "imageUrl": "https://...", "duration": 5, "resolution": "480P" }
//   -> { "id": "..." }
//   { "action": "status", "id": "..." }
//   -> { "status": "...", "done": true/false, "videoUrl": "..." }

const SB_URL = process.env.SUPABASE_URL || 'https://hpttttewjywpiembcwwu.supabase.co';
const SB_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_yrjJkdljB3IOa4YSmwBAeA_ElgeJ0Um';
const API = 'https://makefun.ai/api/v1/userWan30';
const MODEL = process.env.MAKEFUN_MODEL || 'wan3.0-video';

const RESOLUTIONS = ['480P', '720P', '1080P'];
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

async function mk(path, opts) {
  const r = await fetch(API + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + process.env.MAKEFUN_API_KEY,
    },
  });
  const j = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, json: j };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  if (!process.env.MAKEFUN_API_KEY) return res.status(500).json({ error: 'Chave de vídeo não configurada no servidor' });

  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Entre na sua conta para gerar vídeo' });
  const uid = await checkUser(token);
  if (!uid) return res.status(401).json({ error: 'Sessão expirou. Entre de novo.' });

  const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const action = String(body.action || '');

  try {
    if (action === 'create') {
      if (limited('c:' + uid, MAX_CREATE_PER_HOUR, 3_600_000)) {
        return res.status(429).json({ error: 'Limite de vídeos por hora atingido. Tente mais tarde.' });
      }
      const prompt = String(body.prompt || '').trim().slice(0, 2000);
      if (prompt.length < 3) return res.status(400).json({ error: 'Escreva o que você quer no vídeo' });

      let duration = parseInt(body.duration, 10);
      if (!(duration >= 2)) duration = 5;
      if (duration > 10) duration = 10; // trava de custo
      const resolution = RESOLUTIONS.includes(String(body.resolution)) ? String(body.resolution) : '480P';

      const input = { prompt };
      const imageUrl = String(body.imageUrl || '').trim();
      if (imageUrl) {
        if (!/^https:\/\//i.test(imageUrl)) return res.status(400).json({ error: 'A imagem precisa ser um link https' });
        input.media = [{ type: 'reference_image', url: imageUrl }];
      }

      const r = await mk('/start', {
        method: 'POST',
        body: JSON.stringify({
          model: MODEL,
          mode: 'reference',
          input,
          parameters: { resolution, ratio: 'adaptive', duration, audio: false },
        }),
      });
      const d = r.json && r.json.data;
      if (!r.ok || !d || !d._id) {
        return res.status(502).json({ error: 'O gerador de vídeo recusou o pedido', detalhe: r.json && (r.json.message || r.json.msg || r.json.error) || null });
      }
      return res.status(200).json({ id: d._id });
    }

    if (action === 'status') {
      const id = String(body.id || '');
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return res.status(400).json({ error: 'id inválido' });
      if (limited('s:' + uid, 120, 60_000)) return res.status(429).json({ error: 'Muitas consultas. Aguarde um pouco.' });
      const r = await mk('/' + id, { method: 'GET' });
      const d = r.json && r.json.data;
      if (!r.ok || !d) return res.status(502).json({ error: 'Não consegui consultar o vídeo' });
      const status = String(d.current_status || '');
      const done = status === 'completed';
      return res.status(200).json({ status, done, videoUrl: done ? (d.result_url || null) : null });
    }

    return res.status(400).json({ error: 'Ação inválida' });
  } catch (e) {
    return res.status(500).json({ error: 'Erro no servidor de vídeo' });
  }
};
