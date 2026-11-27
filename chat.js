// Zona Hot · servidor do Chat Hot (Vercel). A chave da IA fica só aqui, nunca no HTML.
// Variáveis de ambiente (painel da Vercel): OPENROUTER_API_KEY  (obrigatória)
// Opcionais: CHAT_MODEL (modelo padrão), CHAT_MODEL_PRO, CHAT_MODEL_RAPIDO, CHAT_MODEL_CRIATIVO

const DEFAULT_MODEL = 'cognitivecomputations/dolphin-mistral-24b-venice-edition';

const MODELS = {
  livre: process.env.CHAT_MODEL || DEFAULT_MODEL,
  pro: process.env.CHAT_MODEL_PRO || process.env.CHAT_MODEL || DEFAULT_MODEL,
  rapido: process.env.CHAT_MODEL_RAPIDO || process.env.CHAT_MODEL || DEFAULT_MODEL,
  criativo: process.env.CHAT_MODEL_CRIATIVO || process.env.CHAT_MODEL || DEFAULT_MODEL,
};

const BASE = `Você é o Chat Hot, assistente de criação de conteúdo da plataforma Zona Hot, para criadores do nicho adulto (+18).
Regras fixas:
- Responda sempre em português do Brasil, em tom direto, ousado e prático, sem sermão e sem avisos desnecessários.
- Todos os personagens, modelos e situações são fictícios e maiores de 18 anos. Nunca escreva nada com menores de idade, nem sobre pessoas reais identificáveis.
- Entregue o material pronto para usar (roteiro, legenda, prompt, gancho), bem formatado e sem enrolação.`;

const AGENTS = {
  rot: 'Agente Clonagem de Vídeos: analise a referência que o usuário descrever e entregue roteiro, ritmo de cortes e prompts para recriar o estilo com a persona dele.',
  gan: 'Agente Gancho para Hot: entregue ganchos curtos (até 3 segundos de fala) que prendem o público logo no início, em lista numerada.',
  cop: 'Agente Legendas e Bios de Sedução: escreva legendas, bios e textos de perfil que seduzem e fazem o seguidor querer mais.',
  per: 'Agente Sub nicho da modelo: sugira sub nichos novos com chance de validar, explicando público, fantasia e concorrência.',
  img: 'Agente Clonagem de Imagem: a partir da descrição da referência, entregue um prompt de imagem completo (luz, pose, enquadramento, clima) para a persona do usuário.',
  voz: 'Agente Prompt do Voice: entregue prompts de voz prontos com timbre, tom e ritmo para a persona falar do jeito certo.',
};

const hits = new Map(); // limite simples por IP (reinicia quando o servidor reinicia)
function limited(ip) {
  const now = Date.now(), win = 60_000, max = 20;
  const a = (hits.get(ip) || []).filter(t => now - t < win);
  a.push(now); hits.set(ip, a);
  return a.length > max;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  if (!process.env.OPENROUTER_API_KEY) return res.status(500).json({ error: 'Chave da IA não configurada no servidor' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  if (limited(ip)) return res.status(429).json({ error: 'Muitas mensagens em pouco tempo. Espere um minuto.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { model = 'livre', agent = null, messages = [] } = body || {};

  const msgs = (Array.isArray(messages) ? messages : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-16)
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return res.status(400).json({ error: 'Mensagem vazia' });

  const system = BASE + (AGENTS[agent] ? '\n\n' + AGENTS[agent] : '');

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
