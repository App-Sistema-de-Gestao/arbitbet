// Interface experimental da nuvem: somente branch feature/firebase-sync-testes.
import { configurarFirebase, entrar, sair, consultarNuvem, gravarComConfirmacao, mesclarSemPerdas, observarUsuario } from './firebase-sync.js';

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
function start(){
 if(!window.arbitbetCloudBridge)return;
 modal();
 const btn=button('☁ Nuvem (teste)',()=>{const overlay=$('cloudOverlay');overlay.classList.remove('hidden');overlay.classList.add('flex');$('cloudLocal').textContent=resumo(window.arbitbetCloudBridge.get());});
 btn.id='btnCloud';document.querySelector('.header-actions')?.prepend(btn);
 try{configurarFirebase(config);observarUsuario(user=>{email=user?.email||'';$('cloudLogin').classList.toggle('hidden',!!user);$('cloudLogged').classList.toggle('hidden',!user);$('cloudUser').textContent=user?'Conectado: '+email:'';remote=null;setActions(false);$('cloudRemote').textContent=user?'Clique em Consultar nuvem.':'Entre para consultar.';if(user)refresh();});}
 catch(e){info('Firebase indisponível: '+e.message);}
 $('cloudLogin').onsubmit=async e=>{e.preventDefault();try{info('Autenticando...');await entrar($('cloudEmail').value,$('cloudPassword').value);$('cloudPassword').value='';info('Login realizado.');}catch(err){info('Login não realizado: '+err.message);}};
 $('cloudLogout').onclick=async()=>{await sair();info('Saiu da nuvem. Os dados locais permanecem.');};
}
start();
