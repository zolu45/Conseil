const U = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const T = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const r = async (c) => (await (await fetch(U, { method: 'POST', headers: { Authorization: 'Bearer ' + T }, body: JSON.stringify(c) })).json()).result;
const DEF = { open: true, session: 'Trimestre 1', questions: [
  { id: 'q1', text: "Que pensez-vous de l'ambiance de classe ?", type: 'text', ask: '' },
  { id: 'q2', text: 'Vous trouvez-vous correctement intégré(e) dans le groupe classe ?', type: 'yesno', ask: 'non' },
  { id: 'q3', text: 'Avez-vous des difficultés dans certaines matières ?', type: 'yesno', ask: 'oui' },
  { id: 'q4', text: 'Ressentez-vous des difficultés avec un professeur ?', type: 'yesno', ask: 'oui' },
  { id: 'q5', text: 'Savez-vous déjà quelles spécialités vous voulez faire ?', type: 'yesno', ask: 'oui' },
  { id: 'q6', text: 'Que pensez-vous des devoirs ?', type: 'text', ask: '' },
  { id: 'q7', text: 'Avez-vous autre chose à faire remonter ?', type: 'yesno', ask: 'oui' }] };

async function rows(session) {
  const f = (await r(['HGETALL', 'resp:' + session])) || [];
  const out = [];
  for (let i = 1; i < f.length; i += 2) out.push(JSON.parse(f[i]));
  return out.sort((a, b) => a.date - b.date);
}

module.exports = async (q, s) => {
  if (q.method !== 'POST') return s.status(405).end();
  const b = typeof q.body === 'string' ? JSON.parse(q.body) : q.body || {};
  try {
    const cfg = JSON.parse((await r(['GET', 'config'])) || 'null') || DEF;
    if (b.a === 'config') return s.json(cfg);
    if (b.a === 'submit') {
      if (!cfg.open) return s.status(403).json({ e: 'Le questionnaire est fermé.' });
      const nom = String(b.nom || '').trim().slice(0, 80);
      if (!nom || !Array.isArray(b.answers)) return s.status(400).json({ e: 'Données invalides.' });
      const answers = b.answers.slice(0, 40).map((a) => ({ q: String(a.q).slice(0, 300), v: String(a.v || '').slice(0, 5), t: String(a.t || '').slice(0, 3000) }));
      await r(['HSET', 'resp:' + cfg.session, nom.toLowerCase(), JSON.stringify({ nom, date: Date.now(), answers })]);
      return s.json({ ok: 1 });
    }
    if ((process.env.ADMIN_CODE || 'MRZL') !== b.code) return s.status(401).json({ e: 'Code invalide' });
    if (b.a === 'login') return s.json({ cfg });
    if (b.a === 'list') return s.json({ rows: await rows(b.session || cfg.session) });
    if (b.a === 'save') {
      const n = { open: !!b.cfg.open, session: String(b.cfg.session).slice(0, 40), questions: b.cfg.questions.slice(0, 40).map((x, i) => ({ id: x.id || 'q' + i, text: String(x.text).slice(0, 300), type: x.type === 'yesno' ? 'yesno' : 'text', ask: x.type === 'yesno' && ['oui', 'non'].includes(x.ask) ? x.ask : '' })) };
      await r(['SET', 'config', JSON.stringify(n)]);
      return s.json({ cfg: n });
    }
    if (b.a === 'summary') {
      const rs = await rows(b.session || cfg.session);
      if (!rs.length) return s.json({ text: 'Aucune réponse pour le moment.' });
      const txt = rs.map((x, i) => `Élève ${i + 1} :\n` + x.answers.map((a) => `- ${a.q} → ${a.v} ${a.t}`).join('\n')).join('\n\n');
      const prompt = "Voici les réponses anonymisées d'élèves d'une classe à un questionnaire préparatoire au conseil de classe. Rédige en français un résumé clair pour les délégués : une section par question (titre commençant par '## '), les tendances (nombre d'élèves concernés quand c'est pertinent), les points positifs, les problèmes récurrents, puis une section '## Points à porter au conseil'. Reste factuel, bienveillant, sans citer de noms ni de propos permettant d'identifier un élève. Pas de gras, pas de tableaux.\n\n" + txt;
      const a = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1800, messages: [{ role: 'user', content: prompt }] }) });
      const j = await a.json();
      if (!a.ok) return s.status(500).json({ e: 'Erreur IA : ' + (j.error?.message || a.status) });
      return s.json({ text: j.content[0].text });
    }
    return s.status(400).json({ e: 'Action inconnue' });
  } catch (e) { return s.status(500).json({ e: 'Erreur serveur' }); }
};
