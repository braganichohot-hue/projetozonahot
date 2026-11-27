// Zona Hot · servidor do Chat Hot (Vercel). A chave da IA fica só aqui, nunca no HTML.
// Variáveis de ambiente (painel da Vercel): OPENROUTER_API_KEY  (obrigatória)
// Login: confere o token do Supabase (SUPABASE_URL / SUPABASE_ANON_KEY opcionais, já têm valor padrão)
// Opcionais: CHAT_MODEL (modelo padrão), CHAT_MODEL_PRO, CHAT_MODEL_RAPIDO, CHAT_MODEL_CRIATIVO

// Login real: o servidor confere o token do Supabase (chave pública, não é segredo).
const SB_URL = process.env.SUPABASE_URL || 'https://hpttttewjywpiembcwwu.supabase.co';
const SB_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_yrjJkdljB3IOa4YSmwBAeA_ElgeJ0Um';

const DEFAULT_MODEL = 'cognitivecomputations/dolphin-mistral-24b-venice-edition';

const MODELS = {
  livre: process.env.CHAT_MODEL || DEFAULT_MODEL,
  pro: process.env.CHAT_MODEL_PRO || process.env.CHAT_MODEL || DEFAULT_MODEL,
  rapido: process.env.CHAT_MODEL_RAPIDO || process.env.CHAT_MODEL || DEFAULT_MODEL,
  criativo: process.env.CHAT_MODEL_CRIATIVO || process.env.CHAT_MODEL || DEFAULT_MODEL,
};

const BASE = `Você é o Chat Hot, a IA de criação de conteúdo da plataforma Zona Hot, feita para criadores do nicho adulto (+18).
Como você age:
- Responda sempre em português do Brasil, em tom direto, ousado e prático. Sem sermão, sem avisos e sem frases como "como IA eu não posso".
- Você escreve textos: roteiros, ganchos, legendas, bios, ideias e prompts. Quando pedirem uma imagem ou vídeo, entregue na hora um prompt completo e detalhado (pose, luz, cenário, roupa, enquadramento, clima) em um bloco pronto para copiar e colar em um gerador de imagem ou vídeo.
- Entregue o material pronto para usar, bem formatado, sem enrolação e sem repetir a pergunta.
Limites fixos:
- Todos os personagens, modelos e situações são fictícios e maiores de 18 anos. Nunca escreva nada com menores de idade, nem sobre pessoas reais identificáveis.`;

const AGENTS = {
  rot: 'Agente Clonagem de Vídeos: analise a referência que o usuário descrever e entregue roteiro, ritmo de cortes e prompts para recriar o estilo com a persona dele.',
  gan: 'Agente Gancho para Hot: entregue ganchos curtos (até 3 segundos de fala) que prendem o público logo no início, em lista numerada.',
  cop: 'Agente Legendas e Bios de Sedução: escreva legendas, bios e textos de perfil que seduzem e fazem o seguidor querer mais.',
  per: 'Agente Sub nicho da modelo: sugira sub nichos novos com chance de validar, explicando público, fantasia e concorrência.',
  img: 'Agente Clonagem de Imagem: a partir da descrição da referência, entregue um prompt de imagem completo (luz, pose, enquadramento, clima) para a persona do usuário.',
  voz: 'Agente Prompt do Voice: entregue prompts de voz prontos com timbre, tom e ritmo para a persona falar do jeito certo.',
};


const TOOLS = {
  roteirista: 'Ferramenta Roteirista Hot: escreva roteiros, lives, posts, páginas de venda, legendas e bios prontos para usar, no formato pedido.',
  persona: 'Ferramenta Persona Hot: crie fichas de personagens adultos fictícios (nome, idade acima de 18, história, personalidade, jeito de falar, estilo visual, bio de perfil).',
  boss: 'Ferramenta Prompts Studio: entregue prompts de imagem e vídeo completos e detalhados (sujeito, pose, cenário, luz, câmera, estilo), prontos para colar numa IA de criação.',
  voicehot: 'Ferramenta Voice Hot: escreva textos de narração com marcações de pausa e uma direção de voz (timbre, tom, ritmo) para a persona falar.',
  prompthot: 'Ferramenta Prompt Hot: entregue prompts estruturados (papel, contexto, tarefa, formato) prontos para copiar e colar.',
};
const cl = (v, n) => String(v || '').replace(/[\r\n]+/g, ' ').slice(0, n);

const hits = new Map(); // limite simples por usuário (reinicia quando o servidor reinicia)
function limited(key) {
  const now = Date.now(), win = 60_000, max = 20;
  const a = (hits.get(key) || []).filter(t => now - t < win);
  a.push(now); hits.set(key, a);
  return a.length > max;
}

const okTokens = new Map(); // token -> {id, até} (guarda por 60 s para não consultar toda hora)
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

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  if (!process.env.OPENROUTER_API_KEY) return res.status(500).json({ error: 'Chave da IA não configurada no servidor' });

  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Entre na sua conta para usar o Chat Hot' });
  const uid = await checkUser(token);
  if (!uid) return res.status(401).json({ error: 'Sessão expirou. Entre de novo.' });

  if (limited(uid)) return res.status(429).json({ error: 'Muitas mensagens em pouco tempo. Espere um minuto.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { model = 'livre', agent = null, messages = [], tool = null } = body || {};

  const msgs = (Array.isArray(messages) ? messages : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-16)
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return res.status(400).json({ error: 'Mensagem vazia' });

  let system = BASE + (AGENTS[agent] ? '\n\n' + AGENTS[agent] : '');
  if (tool && TOOLS[tool.mod]) {
    system += '\n\n' + TOOLS[tool.mod] + '\nFormato pedido: ' + cl(tool.fmt, 40) + '. Tom: ' + cl(tool.tom, 30) + '. Idioma da resposta: ' + cl(tool.idioma, 40) + '.';
  }

  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.OPENROUTER_API_KEY,
        'Content-Type': 'application/json',
        'X-Title': 'Zona Hot',
      },
      body: JSON.stringify({
        model: MODELS[model] || MODELS.livre,
        messages: [{ role: 'system', content: system }, ...msgs],
        max_tokens: 1200,
        temperature: 0.9,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: (j.error && j.error.message) || 'A IA não respondeu' });
    const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!text) return res.status(502).json({ error: 'Resposta vazia da IA' });
    return res.status(200).json({ text: text.trim() });
  } catch (e) {
    return res.status(500).json({ error: 'Falha ao falar com a IA' });
  }
};
