// Interface experimental da nuvem: somente branch feature/firebase-sync-testes.
import { configurarFirebase, entrar, sair, consultarNuvem, gravarComConfirmacao, mesclarSemPerdas, conciliar99play, observarUsuario } from './firebase-sync.js';

const config = {
  apiKey: 'AIzaSyD-PNK3A4AoMhqNaj2yEgz_rjjyFBhhj1I',
  authDomain: 'arbitbet-v2.firebaseapp.com',
  projectId: 'arbitbet-v2',
  storageBucket: 'arbitbet-v2.firebasestorage.app',
  messagingSenderId: '645879580947',
  appId: '1:645879580947:web:4c013c1283d4f5928e72e6'
};
const $ = id => document.getElementById(id);
const clone = x => JSON.parse(JSON.stringify(x));
const counts = s => s ? `${s.casas?.length ?? 0} casas · ${s.entradas?.length ?? 0} entradas · ${s.movimentacoes?.length ?? 0} movimentações` : 'Nenhum dado';
const valid = s => s && Array.isArray(s.casas) && Array.isArray(s.entradas) && Array.isArray(s.movimentacoes);
const button = (text, fn) => { const b = document.createElement('button'); b.type='button'; b.textContent=text; b.className='rounded-lg border border-emerald-500/50 px-3 py-2 text-sm text-white bg-slate-800'; b.onclick=fn; return b; };
let remote=null, email='';
let autoTimer=null;
let lastAutoNotice='';
let autoUploadEnabled=false;
let uploadBusy=false;
let autoWriteTimer=null;
let autoError='';
// Compara por ID e chaves ordenadas, ignorando apenas ordem de arrays e propriedades.
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,canonical(value[k])]));
 return value;
}
const stable=value=>JSON.stringify(canonical(value));
function differences(a,b){
 if(!valid(a)||!valid(b))throw Error('Dados inválidos para comparação.');
 const result={};
 for(const field of ['casas','entradas','movimentacoes']){
  const index=items=>{const m=new Map();for(const item of items){if(!item?.id||m.has(String(item.id)))throw Error('ID ausente ou repetido em '+field);m.set(String(item.id),item);}return m;};
  const local=index(a[field]),cloud=index(b[field]);
  result[field]={apenasLocal:[...local.keys()].filter(id=>!cloud.has(id)),apenasNuvem:[...cloud.keys()].filter(id=>!local.has(id)),divergentes:[...local.keys()].filter(id=>cloud.has(id)&&stable(local.get(id))!==stable(cloud.get(id)))};
 }
 return result;
}
const sameState=(a,b)=>Object.values(differences(a,b)).every(x=>!x.apenasLocal.length&&!x.apenasNuvem.length&&!x.divergentes.length);
function diagnosticText(d){
 const names={casas:'Casas',entradas:'Apostas',movimentacoes:'Movimentações'};
 return Object.entries(d).map(([k,v])=>names[k]+': '+v.apenasLocal.length+' só no navegador, '+v.apenasNuvem.length+' só na nuvem, '+v.divergentes.length+' com conteúdo diferente').join(' | ');
}
function stopAuto(){if(autoTimer){clearInterval(autoTimer);autoTimer=null;}if(autoWriteTimer){clearTimeout(autoWriteTimer);autoWriteTimer=null;}autoUploadEnabled=false;updateAutoButton();}
function updateAutoButton(){const b=$('cloudAutoWrite');if(b)b.textContent=autoUploadEnabled?'Desativar envio automático (teste)':'Ativar envio automático (teste)';}
function scheduleAutoWrite(){
 if(!autoUploadEnabled||!email)return;
 if(autoWriteTimer)clearTimeout(autoWriteTimer);
 autoWriteTimer=setTimeout(()=>{autoWriteTimer=null;void autoWrite();},1500);
}
async function autoWrite(){
 if(!autoUploadEnabled||!email||uploadBusy)return;
 uploadBusy=true;
 try{
  const local=window.arbitbetCloudBridge.get();
  if(!valid(local)||!local.casas.length)throw Error('Estado local vazio ou inválido.');
  const result=await mesclarSemPerdas(local);
  // Nunca substituir alterações locais posteriores ao início da operação.
  const latest=window.arbitbetCloudBridge.get();
  if(!sameState(local,latest)){info('Houve novas alterações durante o envio. Refaça a conferência.');autoUploadEnabled=false;updateAutoButton();return;}
  window.arbitbetCloudBridge.replace(result.estado);
  await refresh();
  info(result.semAlteracoes?'Verificação automática: sem alterações.':'Novos registros enviados automaticamente com segurança (revisão '+result.revisao+').');
 }catch(e){
  autoUploadEnabled=false;updateAutoButton();
  info('Envio automático pausado por segurança: '+e.message+'. Nenhum registro local foi substituído.');
 }finally{uploadBusy=false;}
}
async function toggleAutoWrite(){
 if(autoUploadEnabled){autoUploadEnabled=false;updateAutoButton();info('Envio automático desativado.');return;}
 if(!email)return info('Entre no Firebase antes de ativar.');
 const local=window.arbitbetCloudBridge.get();
 const cloud=await consultarNuvem();
 if(!cloud.existe||!valid(cloud))return info('Nuvem vazia ou indisponível: ativação bloqueada.');
 const d=differences(local,cloud);
 if(Object.values(d).some(x=>x.divergentes.length))return info('Ativação bloqueada: existem registros divergentes. '+diagnosticText(d));
 if(!confirm('ATIVAR ENVIO AUTOMÁTICO NESTA ABA?\\n\\nNovos registros serão mesclados no Firebase após cada alteração. Edições conflitantes serão bloqueadas. Não será permitido apagar registros remotamente. O recurso ficará ativo apenas nesta sessão. Faça backup antes de prosseguir.'))return;
 downloadJson(local,'arbitbet-antes-envio-automatico');
 autoUploadEnabled=true;updateAutoButton();
 info('Envio automático ativado nesta aba. Alterações novas serão mescladas; conflitos bloqueiam o envio.');
}
async function autoCheck(){
 if(!document.hidden && email){
  try{
   const data=await consultarNuvem();
   if(!data.existe||!valid(data))return;
   const previous=remote?.revisao;
   remote=data;
   $('cloudRemote').textContent=resumo(data)+' · Revisão '+data.revisao;
   const local=window.arbitbetCloudBridge.get();
   const isEmpty=!local.casas.length&&!local.entradas.length&&!local.movimentacoes.length;
   if(isEmpty){
    window.arbitbetCloudBridge.replace({casas:clone(data.casas),entradas:clone(data.entradas),movimentacoes:clone(data.movimentacoes)});
    $('cloudLocal').textContent=resumo(window.arbitbetCloudBridge.get());
    info('Dados restaurados automaticamente neste navegador vazio. Nenhuma gravação na nuvem.');
   }else if(!sameState(local,data)&&lastAutoNotice!==String(data.revisao)){
    lastAutoNotice=String(data.revisao);
    info('Diferenças detectadas (revisão '+data.revisao+'). '+diagnosticText(differences(local,data))+'. Nada foi alterado.');
   }else if(previous!==data.revisao&&sameState(local,data)){
    info('Dados locais e nuvem conferidos automaticamente (revisão '+data.revisao+').');
   }
  }catch(e){info('Consulta automática indisponível: '+e.message);}
 }
}
function startAuto(){stopAuto();autoTimer=setInterval(autoCheck,30000);autoCheck();}

function info(t){$('cloudInfo').textContent=t;}
function setActions(enabled){['cloudDownload','cloudUpload','cloudMerge'].forEach(id=>$(id).disabled=!enabled);}
function downloadJson(s, prefix){const a=document.createElement('a');const url=URL.createObjectURL(new Blob([JSON.stringify({...s,exportadoEm:new Date().toISOString()},null,2)],{type:'application/json'}));a.href=url;a.download=prefix+'-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
function resumo(s){const dep=(s.movimentacoes||[]).filter(m=>m.tipo==='DEPOSITO').reduce((a,m)=>a+Number(m.valor||0),0);return counts(s)+' · Depósitos R$ '+dep.toFixed(2).replace('.',',');}
function modal(){
 const box=document.createElement('div');box.id='cloudOverlay';box.className='fixed inset-0 z-[100] hidden items-center justify-center bg-black/85 p-4';
 box.innerHTML=`<div class="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-emerald-500/50 bg-[#12161f] p-5 space-y-4 text-white">
 <div class="flex justify-between items-center"><h2 class="font-bold text-lg text-emerald-400">Firebase · sincronização de testes</h2><button type="button" id="cloudClose" aria-label="Fechar">✕</button></div>
 <p class="text-xs text-amber-300">Experimental. Nenhum dado é enviado automaticamente. Faça backup antes de gravar ou restaurar.</p>
 <form id="cloudLogin" class="space-y-2"><input id="cloudEmail" type="email" required autocomplete="username" placeholder="E-mail do Firebase" class="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-white">
 <input id="cloudPassword" type="password" required autocomplete="current-password" placeholder="Senha do Firebase" class="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-white">
 <button class="rounded-lg bg-emerald-500 text-black font-bold p-3 w-full">Entrar na nuvem</button></form>
 <div id="cloudLogged" class="hidden space-y-2"><div id="cloudUser" class="text-sm"></div><button id="cloudLogout" type="button" class="text-sm text-amber-300 underline">Sair da nuvem</button></div>
 <div class="border-t border-slate-700 pt-3 text-sm"><strong>Dados deste navegador:</strong><p id="cloudLocal" class="mt-1 text-slate-300"></p></div>
 <div class="text-sm"><strong>Dados da nuvem:</strong><p id="cloudRemote" class="mt-1 text-slate-300">Entre para consultar.</p></div>
 <p id="cloudInfo" role="status" class="text-xs text-sky-300"></p>
 <div class="flex flex-wrap gap-2" id="cloudActions"></div></div>`;
 document.body.appendChild(box);
 $('cloudClose').onclick=()=>box.classList.add('hidden');
 box.onclick=e=>{if(e.target===box)box.classList.add('hidden');};
 const actions=$('cloudActions');
 actions.append(button('Consultar nuvem', refresh));
 const restore=button('Restaurar da nuvem', restoreCloud);restore.id='cloudDownload';actions.append(restore);
 const upload=button('Enviar para nuvem', uploadCloud);upload.id='cloudUpload';actions.append(upload);
 const merge=button('Mesclar sem excluir',mergeCloud);merge.id='cloudMerge';actions.append(merge);
 actions.append(button('Diagnosticar diferenças (somente leitura)',diagnose));
 actions.append(button('Conciliar 99play — 2 apostas + 1 RED (teste)',conciliar99playUI));
 const autoButton=button('Ativar envio automático (teste)',()=>{void toggleAutoWrite().catch(e=>info('Não foi possível ativar: '+e.message));});autoButton.id='cloudAutoWrite';actions.append(autoButton);
 actions.append(button('Preparar Bets365 — Neudson',prepararBets365));
 actions.append(button('Backup local JSON',()=>downloadJson(window.arbitbetCloudBridge.get(),'arbitbet-antes-sync')));
 setActions(false);
}
async function refresh(){
 try{info('Consultando...');const data=await consultarNuvem();remote=data.existe?data:null;
 $('cloudRemote').textContent=remote?resumo(remote)+' · Revisão '+remote.revisao:'Sem registros na nuvem';
 $('cloudLocal').textContent=resumo(window.arbitbetCloudBridge.get());
 setActions(true);if(!remote)$('cloudDownload').disabled=true;
 info('Consulta concluída. Nenhum dado foi modificado.');
 }catch(e){remote=null;setActions(false);info('Falha na consulta: '+e.message);}
}
async function restoreCloud(){
 if(!remote||!valid(remote))return info('Nenhum backup válido encontrado na nuvem.');
 const local=window.arbitbetCloudBridge.get();
 const msg='RESTAURAR DADOS DA NUVEM?\n\nNuvem: '+resumo(remote)+'\nNavegador: '+resumo(local)+'\n\nOs dados atuais deste navegador serão substituídos. Um backup JSON será baixado primeiro. Confirma?';
 if(!confirm(msg))return;
 downloadJson(local,'arbitbet-antes-restauracao-nuvem');
 try{window.arbitbetCloudBridge.replace({casas:clone(remote.casas),entradas:clone(remote.entradas),movimentacoes:clone(remote.movimentacoes)});$('cloudLocal').textContent=resumo(window.arbitbetCloudBridge.get());info('Restauração local concluída. Confira os saldos.');}
 catch(e){info('Falha ao restaurar: '+e.message);}
}

async function diagnose(){
 try{
  info('Comparando dados locais e nuvem, sem gravar...');
  const data=await consultarNuvem();
  if(!data.existe)throw Error('Não há dados na nuvem.');
  remote=data;
  $('cloudRemote').textContent=resumo(data)+' · Revisão '+data.revisao;
  const diff=differences(window.arbitbetCloudBridge.get(),data);
  info('Diagnóstico (somente leitura): '+diagnosticText(diff)+'. Nenhum dado foi alterado.');
 }catch(e){info('Diagnóstico interrompido: '+e.message);}
}
async function conciliar99playUI(){
 if(autoUploadEnabled)return info('Desative o envio automático antes da conciliação.');
 const local=window.arbitbetCloudBridge.get();
 try{
  info('Conferindo a nuvem antes da conciliação...');
  const cloud=await consultarNuvem();
  if(!cloud.existe||!valid(cloud))throw Error('Nuvem indisponível.');
  const d=differences(local,cloud);
  if(d.entradas.apenasLocal.length!==2||d.entradas.apenasNuvem.length!==0||d.entradas.divergentes.length!==1||d.entradas.divergentes[0]!=='99play-5674230586'||d.entradas.apenasLocal.some(id=>!['e_1795282405185','e_1795282491842'].includes(id))||d.casas.apenasLocal.length||d.casas.apenasNuvem.length||d.casas.divergentes.length||d.movimentacoes.apenasLocal.length||d.movimentacoes.apenasNuvem.length||d.movimentacoes.divergentes.length)throw Error('Diagnóstico diferente do esperado. '+diagnosticText(d));
  if(!confirm('CONCILIAR 99PLAY NA NUVEM?\\n\\nAdicionar 2 apostas RED (R$ 10 e R$ 14) e atualizar somente a aposta existente de R$ 1,45 de PENDENTE para RED.\\n\\n5 casas, 35 apostas, 12 movimentações após a operação.\\n\\nA operação é atômica e bloqueia qualquer outra divergência. Serão baixados backups do navegador e da nuvem. Confirmar?'))return info('Operação cancelada. Nenhum dado alterado.');
  downloadJson(local,'arbitbet-99play-local-antes-conciliacao');
  downloadJson(cloud,'arbitbet-99play-nuvem-antes-conciliacao');
  info('Validando todos os registros e conciliando...');
  const result=await conciliar99play(local);
  await refresh();
  info('Conciliação concluída na revisão '+result.revisao+'. Confira o diagnóstico: 35 apostas, 5 casas e 12 movimentações.');
 }catch(e){info('Conciliação não concluída: '+e.message);}
}
async function prepararBets365(){
 try{
  info('Conferindo pacote validado...');
  const response=await fetch('./preparacao/bets365-neudson-revisao.json',{cache:'no-store'});
  if(!response.ok)throw new Error('Pacote não encontrado.');
  const p=await response.json();
  if(p.confirmacoes?.saldoDisponivel!==1||p.apostas?.length!==9||p.depositos?.length!==2)throw new Error('Pacote não validado.');
  const local=window.arbitbetCloudBridge.get();
  if(!valid(local))throw new Error('Dados locais inválidos.');
  const existingCasa=local.casas.find(x=>x.id===p.casa.id);
  if(existingCasa && JSON.stringify(existingCasa)!==JSON.stringify(p.casa))throw new Error('Casa com ID divergente. Nenhuma alteração.');
  const additions={casas:[p.casa],entradas:p.apostas,movimentacoes:p.depositos};
  const result={};
  for(const [key,items] of Object.entries(additions)){
   const map=new Map(local[key].map(x=>[String(x.id),x]));
   if(map.size!==local[key].length)throw new Error('Identificadores duplicados em '+key);
   for(const item of items){
    const old=map.get(String(item.id));
    if(old && JSON.stringify(old)!==JSON.stringify(item))throw new Error('Registro divergente em '+key+': '+item.id);
    map.set(String(item.id),item);
   }
   result[key]=[...map.values()];
  }
  const msg='PREPARAR BETS365 — NEUDSON NO NAVEGADOR?\\n\\n1 casa, 9 apostas (R$ 29,00), 2 depósitos (R$ 30,00).\\n\\nNão envia nada ao Firebase. O backup local será baixado. Depois será necessário usar Mesclar sem excluir. Confirma?';
  if(!confirm(msg)){info('Preparação cancelada.');return;}
  downloadJson(local,'arbitbet-antes-bets365');
  window.arbitbetCloudBridge.replace(result);
  $('cloudLocal').textContent=resumo(result);
  info('Bets365 preparada APENAS neste navegador. Confira 5 casas, 33 entradas e 12 movimentações. Depois use Mesclar sem excluir para enviar à nuvem.');
 }catch(e){info('Preparação NÃO concluída: '+e.message);}
}

async function mergeCloud(){
 const local=window.arbitbetCloudBridge.get();
 if(!valid(local))return info('Dados locais inválidos.');
 if(!confirm('MESCLAR SEM EXCLUIR?\\n\\nOs registros com IDs diferentes serão reunidos. Edições divergentes do mesmo registro serão BLOQUEADAS, sem substituir dados. Um backup local será baixado. Deseja continuar?'))return;
 downloadJson(local,'arbitbet-antes-mesclagem');
 try{
  info('Comparando registros e verificando conflitos...');
  const result=await mesclarSemPerdas(local);
  window.arbitbetCloudBridge.replace(result.estado);
  await refresh();
  info(result.semAlteracoes?'Dados já sincronizados. Nenhuma gravação nova foi necessária (revisão '+result.revisao+').':'Mesclagem concluída com segurança (revisão '+result.revisao+'). Confira os saldos.');
 }catch(e){info('MESCLAGEM NÃO CONCLUÍDA: '+e.message+' Nenhum registro local foi substituído.');}
}
async function uploadCloud(){
 const local=window.arbitbetCloudBridge.get();
 if(!valid(local)||!local.casas.length)return info('Sem casas locais. Envio de estado vazio bloqueado.');
 if(remote && !confirm('A nuvem já contém dados ('+resumo(remote)+').\n\nConfira cuidadosamente: esta operação substituirá o estado remoto, não mesclará as alterações. Continuar?'))return;
 const msg='ENVIAR DADOS PARA NUVEM?\n\nLocal: '+resumo(local)+'\nNuvem: '+(remote?resumo(remote):'vazia')+'\n\nUm backup local será baixado. Confirma o envio?';
 if(!confirm(msg))return;
 downloadJson(local,'arbitbet-antes-envio-nuvem');
 try{info('Verificando revisão e gravando...');const revision=await gravarComConfirmacao(local,remote?.revisao??0,true);info('Enviado com sucesso (revisão '+revision+').');await refresh();}
 catch(e){info('Envio NÃO concluído: '+e.message+' Atualize a consulta antes de tentar novamente.');}
}
window.addEventListener('arbitbet:local-change',scheduleAutoWrite);
function start(){
 if(!window.arbitbetCloudBridge)return;
 modal();
 const btn=button('☁ Nuvem (teste)',()=>{const overlay=$('cloudOverlay');overlay.classList.remove('hidden');overlay.classList.add('flex');$('cloudLocal').textContent=resumo(window.arbitbetCloudBridge.get());});
 btn.id='btnCloud';document.querySelector('.header-actions')?.prepend(btn);
 try{configurarFirebase(config);observarUsuario(user=>{email=user?.email||'';$('cloudLogin').classList.toggle('hidden',!!user);$('cloudLogged').classList.toggle('hidden',!user);$('cloudUser').textContent=user?'Conectado: '+email:'';remote=null;setActions(false);$('cloudRemote').textContent=user?'Clique em Consultar nuvem.':'Entre para consultar.';if(user){refresh();startAuto();}else{stopAuto();lastAutoNotice='';}});}
 catch(e){info('Firebase indisponível: '+e.message);}
 $('cloudLogin').onsubmit=async e=>{e.preventDefault();try{info('Autenticando...');await entrar($('cloudEmail').value,$('cloudPassword').value);$('cloudPassword').value='';info('Login realizado.');}catch(err){info('Login não realizado: '+err.message);}};
 $('cloudLogout').onclick=async()=>{await sair();info('Saiu da nuvem. Os dados locais permanecem.');};
}
start();
