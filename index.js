// ============================================================
// Robô de Aniversários — Pastoral dos Coroinhas
// Roda 1x por dia (Railway Cron): lê aniversariantes do Supabase
// e envia "parabéns" pelo WhatsApp via Evolution API.
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const EVOLUTION_URL = (process.env.EVOLUTION_URL || "").replace(/\/+$/, "");
const EVOLUTION_KEY = process.env.EVOLUTION_KEY;
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE;
const ENVIAR_PARA = (process.env.ENVIAR_PARA || "ambos").toLowerCase(); // ambos | coordenadores | coroinhas
const TESTE_NUMERO = process.env.TESTE_NUMERO || "";
const MENSAGEM = process.env.MENSAGEM ||
  "🎉 Feliz aniversário, {nome}! A Pastoral dos Coroinhas do Santuário do Santíssimo Sacramento deseja um dia muito abençoado! 🙏🎂";

const log = (...a) => console.log(new Date().toISOString(), ...a);

function soDigitos(t) {
  let d = String(t || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length <= 11) d = "55" + d; // sem código do país -> adiciona 55 (Brasil)
  return d;
}

async function supaGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase GET ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}
async function supaInsert(path, obj) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates" },
    body: JSON.stringify(obj),
  });
  if (!r.ok && r.status !== 409) log("Aviso: nao registrou envio:", r.status, await r.text());
}
async function enviarWhats(numero, texto) {
  const r = await fetch(`${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: EVOLUTION_KEY },
    body: JSON.stringify({ number: numero, text: texto }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`Evolution ${r.status} ${body}`);
  return body;
}

(async () => {
  try {
    for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_KEY, EVOLUTION_URL, EVOLUTION_KEY, EVOLUTION_INSTANCE }))
      if (!v) throw new Error(`Falta a variavel de ambiente ${k}`);

    if (TESTE_NUMERO) {
      log("Enviando mensagem de TESTE para", TESTE_NUMERO);
      await enviarWhats(soDigitos(TESTE_NUMERO), "✅ Teste do robô de aniversários — está funcionando!");
      log("Teste enviado com sucesso.");
    }

    const hoje = new Date();
    const mmdd = String(hoje.getMonth() + 1).padStart(2, "0") + "-" + String(hoje.getDate()).padStart(2, "0");
    const hojeISO = hoje.getFullYear() + "-" + mmdd;
    log("Verificando aniversariantes de", mmdd, "(envio para:", ENVIAR_PARA + ")");

    const pessoas = [];
    if (ENVIAR_PARA === "ambos" || ENVIAR_PARA === "coroinhas") {
      const coro = await supaGet("coroinhas?select=id,nome,telefone,nascimento");
      coro.forEach(c => pessoas.push({ chave: "coroinha:" + c.id, nome: c.nome, telefone: c.telefone, nascimento: c.nascimento }));
    }
    if (ENVIAR_PARA === "ambos" || ENVIAR_PARA === "coordenadores") {
      const coord = await supaGet("coordenadores?select=id,nome,telefone,nascimento");
      coord.forEach(c => pessoas.push({ chave: "coord:" + c.id, nome: c.nome, telefone: c.telefone, nascimento: c.nascimento }));
    }

    const aniversariantes = pessoas.filter(p => p.nascimento && String(p.nascimento).slice(5, 10) === mmdd);
    log("Aniversariantes hoje:", aniversariantes.length);

    let jaHoje = [];
    try { jaHoje = await supaGet(`avisos_aniversario?select=pessoa&data=eq.${hojeISO}`); } catch (e) { log("Aviso: sem tabela avisos_aniversario ainda?", e.message); }
    const enviados = new Set(jaHoje.map(x => x.pessoa));

    for (const p of aniversariantes) {
      if (enviados.has(p.chave)) { log("Ja enviado hoje:", p.nome); continue; }
      const num = soDigitos(p.telefone);
      if (!num) { log("Sem telefone, pulando:", p.nome); continue; }
      const texto = MENSAGEM.replace(/\{nome\}/g, p.nome);
      try {
        await enviarWhats(num, texto);
        await supaInsert("avisos_aniversario", { data: hojeISO, pessoa: p.chave });
        log("Parabens enviado:", p.nome, "->", num);
      } catch (e) {
        log("ERRO ao enviar para", p.nome, num, "->", e.message);
      }
    }
    log("Concluido.");
    process.exit(0);
  } catch (e) {
    log("FALHA GERAL:", e.message);
    process.exit(1);
  }
})();
