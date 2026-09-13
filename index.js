// ============================================================
// Robô de Aniversários — Pastoral dos Coroinhas (múltiplos grupos)
// Roda 1x/dia (GitHub Actions): lê aniversariantes do Supabase e
// anuncia nos GRUPOS do WhatsApp via Evolution API.
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const EVOLUTION_URL = (process.env.EVOLUTION_URL || "").replace(/\/+$/, "");
const EVOLUTION_KEY = process.env.EVOLUTION_KEY;
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE;

// Aceita 1 ou vários grupos: em GRUPO_ID e GRUPO_ID2 (cada um pode ter vários, separados por vírgula)
const GRUPOS = [...new Set(
  [process.env.GRUPO_ID, process.env.GRUPO_ID2]
    .flatMap(x => String(x || "").split(/[,\s;]+/))
    .map(s => s.trim())
    .filter(Boolean)
)];

const MODO = (process.env.MODO || (GRUPOS.length ? "grupo" : "privado")).toLowerCase(); // grupo | privado | ambos
const ENVIAR_PARA = (process.env.ENVIAR_PARA || "ambos").toLowerCase();                  // ambos | coordenadores | coroinhas
const TESTE_NUMERO = process.env.TESTE_NUMERO || "";
const TESTE_GRUPO = process.env.TESTE_GRUPO || "";
const LISTAR_GRUPOS = process.env.LISTAR_GRUPOS || "";
const MENSAGEM = process.env.MENSAGEM ||
  "🎉 Feliz aniversário, {nome}! A Pastoral dos Coroinhas do Santuário do Santíssimo Sacramento deseja um dia muito abençoado! 🙏🎂";

const log = (...a) => console.log(new Date().toISOString(), ...a);
function soDigitos(t){ let d=String(t||"").replace(/\D/g,""); if(!d) return ""; if(d.length<=11) d="55"+d; return d; }

async function supaGet(path){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`}});
  if(!r.ok) throw new Error(`Supabase GET ${path} -> ${r.status} ${await r.text()}`); return r.json();
}
async function supaInsert(path,obj){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/${path}`,{method:"POST",headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`,"Content-Type":"application/json",Prefer:"resolution=ignore-duplicates"},body:JSON.stringify(obj)});
  if(!r.ok&&r.status!==409) log("Aviso: nao registrou:",r.status,await r.text());
}
async function enviar(destino,texto){
  const r=await fetch(`${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`,{method:"POST",headers:{"Content-Type":"application/json",apikey:EVOLUTION_KEY},body:JSON.stringify({number:destino,text:texto})});
  const b=await r.text(); if(!r.ok) throw new Error(`Evolution ${r.status} ${b}`); return b;
}
async function listarGrupos(){
  const r=await fetch(`${EVOLUTION_URL}/group/fetchAllGroups/${EVOLUTION_INSTANCE}?getParticipants=false`,{headers:{apikey:EVOLUTION_KEY}});
  const b=await r.text(); if(!r.ok) throw new Error(`Evolution grupos ${r.status} ${b}`);
  let arr; try{arr=JSON.parse(b);}catch(e){arr=[];} return Array.isArray(arr)?arr:(arr.groups||[]);
}

(async()=>{
  try{
    for(const [k,v] of Object.entries({SUPABASE_URL,SUPABASE_KEY,EVOLUTION_URL,EVOLUTION_KEY,EVOLUTION_INSTANCE})) if(!v) throw new Error(`Falta variavel ${k}`);

    if(LISTAR_GRUPOS){
      log("Listando grupos da instancia...");
      const gs=await listarGrupos(); log("Total de grupos:",gs.length);
      gs.forEach(g=>log("GRUPO -> nome:",(g.subject||g.name||"?"),"| id:",(g.id||g.jid||"?")));
      process.exit(0);
    }
    if(TESTE_NUMERO){ log("Teste PRIVADO ->",TESTE_NUMERO); await enviar(soDigitos(TESTE_NUMERO),"✅ Teste do robô (privado) — funcionando!"); log("ok"); }
    if(TESTE_GRUPO){
      if(!GRUPOS.length) throw new Error("TESTE_GRUPO pedido, mas nenhum GRUPO_ID/GRUPO_ID2");
      for(const g of GRUPOS){ log("Teste GRUPO ->",g); await enviar(g,"✅ Teste do robô no grupo — funcionando!"); }
      log("ok");
    }

    const hoje=new Date();
    const mmdd=String(hoje.getMonth()+1).padStart(2,"0")+"-"+String(hoje.getDate()).padStart(2,"0");
    const hojeISO=hoje.getFullYear()+"-"+mmdd;
    log("Aniversariantes de",mmdd,"| modo:",MODO,"| para:",ENVIAR_PARA,"| grupos:",GRUPOS.length);

    const pessoas=[];
    if(ENVIAR_PARA==="ambos"||ENVIAR_PARA==="coroinhas"){ const c=await supaGet("coroinhas?select=id,nome,telefone,nascimento"); c.forEach(x=>pessoas.push({chave:"coroinha:"+x.id,nome:x.nome,telefone:x.telefone,nascimento:x.nascimento})); }
    if(ENVIAR_PARA==="ambos"||ENVIAR_PARA==="coordenadores"){ const c=await supaGet("coordenadores?select=id,nome,telefone,nascimento"); c.forEach(x=>pessoas.push({chave:"coord:"+x.id,nome:x.nome,telefone:x.telefone,nascimento:x.nascimento})); }
    const aniv=pessoas.filter(p=>p.nascimento&&String(p.nascimento).slice(5,10)===mmdd);
    log("Aniversariantes hoje:",aniv.length);

    let jaHoje=[]; try{ jaHoje=await supaGet(`avisos_aniversario?select=pessoa&data=eq.${hojeISO}`);}catch(e){ log("aviso:",e.message); }
    const enviados=new Set(jaHoje.map(x=>x.pessoa));

    if((MODO==="grupo"||MODO==="ambos") && aniv.length>0){
      if(!GRUPOS.length){ log("MODO grupo mas nenhum grupo configurado."); }
      else{
        const nomes=aniv.map(p=>p.nome);
        const texto = nomes.length===1
          ? `🎉 Hoje é aniversário de *${nomes[0]}*! Parabéns e um dia muito abençoado! 🙏🎂\n— Pastoral dos Coroinhas`
          : `🎉 *Aniversariantes de hoje* na Pastoral dos Coroinhas:\n\n`+nomes.map(n=>"• "+n).join("\n")+`\n\nParabéns e um dia muito abençoado! 🙏🎂`;
        for(const g of GRUPOS){
          if(enviados.has("grupo:"+g)){ log("Ja enviado hoje ao grupo",g); continue; }
          try{ await enviar(g,texto); await supaInsert("avisos_aniversario",{data:hojeISO,pessoa:"grupo:"+g}); log("Anuncio enviado ao grupo",g,"-",nomes.length,"nome(s)."); }
          catch(e){ log("ERRO grupo",g,":",e.message); }
        }
      }
    }

    if(MODO==="privado"||MODO==="ambos"){
      for(const p of aniv){
        if(enviados.has(p.chave)){ log("Ja enviado (privado):",p.nome); continue; }
        const num=soDigitos(p.telefone); if(!num){ log("Sem telefone:",p.nome); continue; }
        try{ await enviar(num,MENSAGEM.replace(/\{nome\}/g,p.nome)); await supaInsert("avisos_aniversario",{data:hojeISO,pessoa:p.chave}); log("Privado enviado:",p.nome); }
        catch(e){ log("ERRO privado",p.nome,e.message); }
      }
    }
    log("Concluido.");
    process.exit(0);
  }catch(e){ log("FALHA GERAL:",e.message); process.exit(1); }
})();
