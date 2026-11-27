// Interface experimental da nuvem: somente branch feature/firebase-sync-testes.
import { configurarFirebase, entrar, sair, recuperarSenha, excluirEntradaConfirmada, consultarNuvem, gravarComConfirmacao, mesclarSemPerdas, sincronizarTresVias, testarConciliacaoEmMemoria, consultarLaboratorio, executarLaboratorio, enviarEventosLaboratorio, conciliar99play, observarUsuario, testeFinanceiroIsolado, homologarFinanceiroIsolado, testarConcorrenciaHomologacao, capturarBaseConcorrenciaReal, enviarConcorrenciaReal } from './firebase-sync.js';

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
let authEpoch=0;
let currentUid=null;
let autoTimer=null;
let lastAutoNotice='';
let autoUploadEnabled=false;
let uploadBusy=false;
let autoWriteTimer=null;
let autoError='';
let syncBaseline=null;
let syncRevision=0;
let syncBusy=false;
let syncRunToken=0;
let syncTimer=null;
let maintenanceBusy=false;
const maintenanceKey=()=> 'arbitbet_maintenance_v1_'+currentUid;
function maintenance(){return !!currentUid && localStorage.getItem(maintenanceKey())==='1';}
function showMaintenance(){
 const paused=maintenance();
 for(const el of document.querySelectorAll('main, #modalMov, #modalEntrada, #modalCasa, #modalLiquidar'))el.inert=paused;
 const banner=$('maintenanceBanner');if(banner)banner.hidden=!paused;
const b=$('cloudMaintenance');if(b)b.textContent=maintenance()?'Retomar sincronização':'Pausar sincronização (manutenção)';const p=$('cloudMaintenanceStatus');if(p)p.textContent=maintenance()?'MANUTENÇÃO ATIVA NESTE NAVEGADOR — login mantido; não faça lançamentos.':'Modo de manutenção desativado.';}
async function toggleMaintenance(){
 if(!currentUid||maintenanceBusy||syncBusy||uploadBusy)return info('Aguarde a operação atual e tente novamente.');
 maintenanceBusy=true;
 try{
 if(!maintenance()){
  if(!confirm('Pausar a sincronização neste navegador, mantendo o login? Não faça lançamentos durante a manutenção.'))return;
  localStorage.setItem(maintenanceKey(),'1');stopSafeSync();stopAuto();showMaintenance();info('Sincronização pausada neste navegador.');
 }else{
  const uid=currentUid,epoch=authEpoch;const cloud=await consultarNuvem();
  if(uid!==currentUid||epoch!==authEpoch)return;
  if(!cloud.existe||!valid(cloud)||!sameState(window.arbitbetCloudBridge.get(),cloud))throw Error('Dados locais e remotos diferentes. A pausa foi mantida.');
  localStorage.removeItem(maintenanceKey());remote=cloud;showMaintenance();startSafeSync(cloud);startAuto();
 }
 }catch(e){info('Manutenção: '+e.message);}finally{maintenanceBusy=false;}
}
let labTimer=null,labLastRevision=null,labPolling=false;
let labFinanceCount=null;
function stopLabWatch(){if(labTimer)clearInterval(labTimer);labTimer=null;labLastRevision=null;labFinanceCount=null;}
async function checkLabWatch(){
 if(!email||document.hidden||labPolling)return;
 labPolling=true;
 try{
  const s=await consultarLaboratorio();
  const el=$('labWatchStatus');
  if(!el)return;
  if(!s.existe){el.textContent='Laboratório ainda não criado.';return;}
  if(labLastRevision!==null && s.revisao>labLastRevision)el.textContent='ATUALIZAÇÃO AUTOMÁTICA RECEBIDA: revisão '+s.revisao+' · '+s.eventos.length+' eventos fictícios · última origem: '+(s.eventos.at(-1)?.origem||'nenhuma');
  else if(labLastRevision===null)el.textContent='Monitor automático ativo · revisão '+s.revisao+' · '+s.eventos.length+' eventos fictícios.';
  const financial=s.financeiroFicticio||[];
  const f=$('labFinanceWatchStatus');
  if(f){
   if(!Array.isArray(financial)){f.textContent='Laboratório financeiro: dados fictícios inválidos.';}
   else if(labFinanceCount!==null && financial.length>labFinanceCount){
    const ultimo=financial.at(-1);
    f.textContent='FINANCEIRO FICTÍCIO RECEBIDO AUTOMATICAMENTE · '+financial.length+' registros · última origem: '+(ultimo?.origem||'desconhecida')+' · revisão '+s.revisao+'. Nenhuma aposta real alterada.';
   }else if(labFinanceCount===null){f.textContent='Monitor financeiro fictício ativo · '+financial.length+' registros · revisão '+s.revisao+'.';}
   labFinanceCount=financial.length;
  }
  labLastRevision=s.revisao;
 }catch(e){const el=$('labWatchStatus');if(el)el.textContent='Monitor do laboratório: '+e.message;}
 finally{labPolling=false;}
}
function startLabWatch(){stopLabWatch();labTimer=setInterval(()=>{void checkLabWatch();},5000);void checkLabWatch();}

function setBaseline(data){
 if(!valid(data)||!Number.isInteger(data.revisao))return;
 syncBaseline=clone({casas:data.casas,entradas:data.entradas,movimentacoes:data.movimentacoes});
 syncRevision=data.revisao;
}
function pauseSync(message){
 stopSafeSync();
 info('Sincronização pausada por segurança: '+message);
}
function stopSafeSync(){
 syncRunToken++;
 if(syncTimer){clearInterval(syncTimer);syncTimer=null;}
 syncBaseline=null;syncRevision=0;
}
async function safeSync(){
 if(maintenance()||maintenanceBusy||uploadBusy||syncBusy||!email||!syncBaseline||autoUploadEnabled)return;
 syncBusy=true;
 const token=syncRunToken,uid=currentUid;
 try{
  const local=window.arbitbetCloudBridge.get();
  if(!valid(local))throw Error('Estado local inválido.');
  const result=await sincronizarTresVias(syncBaseline,local,syncRevision);
  if(token!==syncRunToken||uid!==currentUid)return;
  const latest=window.arbitbetCloudBridge.get();
  if(!sameState(local,latest)){
   // Alteração local durante a transação: nunca avançar a base sem conciliar.
   pauseSync('Houve alteração local durante a gravação. Dados preservados; confira diferenças antes de retomar.');
   return;
  }
  if(!sameState(latest,result.estado))window.arbitbetCloudBridge.replace(result.estado);
  setBaseline({...result.estado,revisao:result.revisao});
  $('cloudLocal').textContent=resumo(result.estado);
  $('cloudRemote').textContent=resumo(result.estado)+' · Revisão '+result.revisao;
 }catch(e){if(token===syncRunToken&&uid===currentUid)pauseSync(e.message);}
 finally{syncBusy=false;}
}
function startSafeSync(data){
 stopSafeSync();
 if(maintenance()||!data?.existe||!valid(data))return;
 const local=window.arbitbetCloudBridge.get();
 if(!sameState(local,data)){
  info('Sincronização automática aguardando conciliação inicial. Use Diagnosticar diferenças; nenhum dado foi enviado.');
  return;
 }
 setBaseline(data);
 syncTimer=setInterval(()=>{if(!document.hidden)void safeSync();},10000);
 info('Sincronização segura ativa: alterações locais e remotas serão conciliadas automaticamente.');
}
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
function stopAuto(){if(autoTimer){clearInterval(autoTimer);autoTimer=null;}if(autoWriteTimer){clearTimeout(autoWriteTimer);autoWriteTimer=null;}autoUploadEnabled=false;}
// O envio automático legado foi desativado: somente conciliação de três vias.
function scheduleAutoWrite(){}
async function autoCheck(){
 const epoch=authEpoch,uid=currentUid;
 if(!maintenance()&&!maintenanceBusy&&!uploadBusy&&!document.hidden && email){
  try{
   const data=await consultarNuvem();
   if(epoch!==authEpoch||uid!==currentUid||maintenance()||maintenanceBusy||uploadBusy)return;
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
    startSafeSync(data);
   }else if(!sameState(local,data)&&lastAutoNotice!==String(data.revisao)){
    lastAutoNotice=String(data.revisao);
    info('Diferenças detectadas (revisão '+data.revisao+'). '+diagnosticText(differences(local,data))+'. Nada foi alterado.');
   }else if(sameState(local,data)){
    // Reiniciar após conciliação segura, mesmo quando o login começou divergente.
    if(!syncBaseline && !syncBusy && !autoUploadEnabled)startSafeSync(data);
    else if(previous!==data.revisao){
     info('Dados locais e nuvem conferidos automaticamente (revisão '+data.revisao+').');
    }
   }
  }catch(e){info('Consulta automática indisponível: '+e.message);}
 }
}
function startAuto(){stopAuto();if(maintenance())return;autoTimer=setInterval(autoCheck,30000);autoCheck();}

function info(t){$('cloudInfo').textContent=t;}
function setActions(enabled){['cloudDownload','cloudMerge'].forEach(id=>{const el=$(id);if(el)el.disabled=!enabled;});}
function downloadJson(s, prefix){const a=document.createElement('a');const url=URL.createObjectURL(new Blob([JSON.stringify({...s,exportadoEm:new Date().toISOString()},null,2)],{type:'application/json'}));a.href=url;a.download=prefix+'-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);}
function resumo(s){const dep=(s.movimentacoes||[]).filter(m=>m.tipo==='DEPOSITO').reduce((a,m)=>a+Number(m.valor||0),0);return counts(s)+' · Depósitos R$ '+dep.toFixed(2).replace('.',',');}
function migrationBalances(s){
 const cents=n=>{const v=Number(n);if(!Number.isFinite(v))throw Error('Valor financeiro inválido.');return Math.round(v*100);};
 const ids=new Set(s.casas.map(c=>c.id));
 if([...s.entradas,...s.movimentacoes].some(x=>!ids.has(x.casaId)))throw Error('Registro sem casa válida.');
 return s.casas.map(c=>{
 let total=cents(c.bancaInicial||0),reserved=0,dep=0,pnl=0;
 for(const e of s.entradas.filter(x=>x.casaId===c.id)){
 const stake=cents(e.stake||0);let p=0;
 if(e.resultado==='PENDENTE')reserved+=stake;
 else if(e.resultado==='CASHOUT')p=cents(e.retornoRecebido||0)-stake;
 else if(e.resultado==='GREEN')p=Number.isFinite(Number(e.retornoRecebido))?cents(e.retornoRecebido)-stake:cents(Number(e.stake||0)*((Number(e.odd)||1)-1));
 else if(!['ANULADA','REEMBOLSO'].includes(e.resultado))p=-stake;
 pnl+=p;
 }
 for(const m of s.movimentacoes.filter(x=>x.casaId===c.id)){const v=cents(m.valor);total+=m.tipo==='SAQUE'?-v:v;if(m.tipo==='DEPOSITO')dep+=v;}
 total+=pnl;return {id:c.id,total,reserved,available:total-reserved,dep,pnl};
 });
}
function validateMigrationBalances(before,after){
 const a=migrationBalances(before),b=migrationBalances(after);
 if(a.length!==6||b.length!==6||after.entradas.length!==50||after.movimentacoes.length!==11)throw Error('Contagens inesperadas.');
 for(const x of a){const y=b.find(z=>z.id===x.id);if(!y||['total','reserved','available'].some(k=>x[k]!==y[k]))throw Error('Saldo individual divergente: '+x.id);}
 const sum=(rows,k)=>rows.reduce((n,x)=>n+x[k],0);
 if(sum(a,'dep')!==13000||sum(b,'dep')!==14000||sum(b,'total')!==3680||sum(b,'reserved')!==1000||sum(b,'available')!==2680||sum(b,'pnl')!==-10517)throw Error('Totais financeiros inesperados.');
 return b;
}
function validateMigrationContent(before,after){
 const fields=['casas','entradas','movimentacoes'];
 if(!valid(before)||!valid(after))throw Error('Estrutura inválida.');
 for(const s of [before,after])for(const k of fields){
  if(s[k].some(x=>!x||typeof x.id!=='string'||!x.id.trim())||new Set(s[k].map(x=>x.id)).size!==s[k].length)throw Error('ID inválido ou duplicado.');
 }
 if(before.casas.length!==6||before.entradas.length!==48||before.movimentacoes.length!==12)throw Error('Base inesperada.');
 const d=differences(after,before);
 const shape=(k,a,b,c)=>d[k].apenasLocal.length===a&&d[k].apenasNuvem.length===b&&d[k].divergentes.length===c;
 if(!shape('casas',0,0,1)||!shape('entradas',2,0,1)||!shape('movimentacoes',1,2,0))throw Error('Alterações extras ou ausentes.');
 const get=(s,k,id)=>s[k].find(x=>x.id===id);
 const eq=(a,b)=>{if(stable(a)!==stable(b))throw Error('Conteúdo não autorizado.');};
 const id=d.casas.divergentes[0],c=get(before,'casas',id);
 if(c.bancaInicial!==10)throw Error('Banca inicial inesperada.');
 eq(get(after,'casas',id),{...c,bancaInicial:0});
 const dep=get(after,'movimentacoes',d.movimentacoes.apenasLocal[0]);
 eq(dep,{id:'dep-inicial-'+id,casaId:id,data:'2026-11-26',tipo:'DEPOSITO',valor:10,obs:'Reclassificação da banca inicial'});
 const removed=d.movimentacoes.apenasNuvem.map(id=>get(before,'movimentacoes',id));
 eq(removed.map(m=>m.valor).sort((a,b)=>a-b),[0.16,2.73]);
 for(const m of removed){
  if(m.tipo!=='RODADAS_GRATIS'||typeof m.obs!=='string'||/ajuste|não comprovado/i.test(m.obs))throw Error('Movimento não elegível.');
  eq(get(after,'entradas',m.id),{id:m.id,casaId:m.casaId,data:m.data,mercado:m.obs,categoria:'RODADAS_GRATIS',resultado:'GREEN',stake:0,odd:null,retornoRecebido:m.valor,finalizadaEm:m.data});
 }
 const e=get(before,'entradas',d.entradas.divergentes[0]);
 if(e.casaId!==id||e.categoria!=='AVULSA'||e.resultado!=='GREEN'||e.stake!==2||e.odd!==2||e.retornoRecebido!==2.8||e.mercado!=='Bônus rodadas grátis')throw Error('Bônus inesperado.');
 eq(get(after,'entradas',e.id),{...e,categoria:'RODADAS_GRATIS',stake:0,odd:null,retornoRecebido:0.8});
 return true;
}
function modal(){
 const box=document.createElement('div');box.id='cloudOverlay';box.className='fixed inset-0 z-[100] hidden items-center justify-center bg-black/85 p-4';
 box.innerHTML=`<div class="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-emerald-500/50 bg-[#12161f] p-5 space-y-4 text-white">
 <div class="flex justify-between items-center"><h2 class="font-bold text-lg text-emerald-400">Firebase · sincronização de testes</h2><button type="button" id="cloudClose" aria-label="Fechar">✕</button></div>
 <p class="text-xs text-amber-300">Experimental. A sincronização segura pode enviar alterações automaticamente quando os dados coincidem. Faça backup antes de gravar ou restaurar.</p>
 <form id="cloudLogin" class="space-y-2"><input id="cloudEmail" type="email" required autocomplete="username" placeholder="E-mail do Firebase" class="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-white">
 <input id="cloudPassword" type="password" required autocomplete="current-password" placeholder="Senha do Firebase" class="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-white">
 <button class="rounded-lg bg-emerald-500 text-black font-bold p-3 w-full">Entrar na nuvem</button></form>
 <div id="cloudLogged" class="hidden space-y-2"><div id="cloudUser" class="text-sm"></div><button id="cloudLogout" type="button" class="text-sm text-amber-300 underline">Sair da nuvem</button></div>
 <div class="border-t border-slate-700 pt-3 text-sm"><strong>Dados deste navegador:</strong><p id="cloudLocal" class="mt-1 text-slate-300"></p></div>
 <div class="text-sm"><strong>Dados da nuvem:</strong><p id="cloudRemote" class="mt-1 text-slate-300">Entre para consultar.</p></div>
 <p id="cloudInfo" role="status" class="text-xs text-sky-300"></p>\n <p id="labWatchStatus" role="status" class="text-xs text-emerald-300">Monitor do laboratório aguardando login.</p>
 <p id="labFinanceWatchStatus" role="status" class="text-xs text-emerald-300">Monitor financeiro fictício aguardando login.</p>
 <div class="flex flex-wrap gap-2" id="cloudActions"></div></div>`;
 document.body.appendChild(box);
 $('cloudClose').onclick=()=>box.classList.add('hidden');
 box.onclick=e=>{if(e.target===box)box.classList.add('hidden');};
 const actions=$('cloudActions');
 const maintenanceButton=button('Pausar sincronização (manutenção)',toggleMaintenance);maintenanceButton.id='cloudMaintenance';actions.append(maintenanceButton);
 const maintenanceStatus=document.createElement('p');maintenanceStatus.id='cloudMaintenanceStatus';maintenanceStatus.className='w-full text-xs text-amber-300';actions.append(maintenanceStatus);
 actions.append(button('Consultar nuvem', refresh));
 const restore=button('Restaurar da nuvem', restoreCloud);restore.id='cloudDownload';actions.append(restore);
 // Substituição integral da nuvem retirada da interface para evitar sobrescrita acidental.
 // A sincronização transacional segura continua ativa; o legado não é exposto.
 const merge=button('Mesclar sem excluir',mergeCloud);merge.id='cloudMerge';actions.append(merge);
 actions.append(button('Diagnosticar diferenças (somente leitura)',diagnose));
 actions.append(button('Verificar este dispositivo (somente leitura)',async()=>{try{const data=await consultarNuvem();if(!data.existe||!valid(data))throw Error('Nuvem indisponível');const local=window.arbitbetCloudBridge.get();const d=differences(local,data);const iguais=sameState(local,data);remote=data;$('cloudLocal').textContent=resumo(local);$('cloudRemote').textContent=resumo(data)+' · Revisão '+data.revisao;info((iguais?'DISPOSITIVO CONFERIDO: dados idênticos. ':'ATENÇÃO: existem diferenças. ')+diagnosticText(d)+'. Nenhum dado foi gravado ou restaurado.');}catch(e){info('Verificação interrompida: '+e.message);}}));
 actions.append(button('Pré-voo financeiro (somente leitura + backup)',async()=>{try{
  if(!email)throw Error('Entre no Firebase.');
  const local=window.arbitbetCloudBridge.get(),cloud=await consultarNuvem();
  if(!valid(local)||!cloud.existe||!valid(cloud))throw Error('Dados locais ou nuvem indisponíveis.');
  const d=differences(local,cloud),iguais=sameState(local,cloud);
  const expected=iguais;
  downloadJson(local,'arbitbet-prevoo-financeiro-local');
  info((iguais&&expected?'PRÉ-VOO APROVADO':'PRÉ-VOO REQUER CONFERÊNCIA')+' · navegador: '+resumo(local)+' · nuvem: '+resumo(cloud)+' · revisão '+cloud.revisao+' · '+diagnosticText(d)+'. Backup local baixado; nenhuma gravação efetuada.');
 }catch(e){info('Pré-voo interrompido: '+e.message+'. Nenhum dado gravado.');}}));
 actions.append(button('Simular recuperação do backup (sem alterar dados)',async()=>{try{
  if(!email)throw Error('Entre no Firebase.');
  const localAntes=window.arbitbetCloudBridge.get(),cloud=await consultarNuvem();
  if(!valid(localAntes)||!cloud.existe||!valid(cloud))throw Error('Estado indisponível.');
  const copia=clone({casas:cloud.casas,entradas:cloud.entradas,movimentacoes:cloud.movimentacoes});
  const serializado=JSON.stringify(copia),restaurado=JSON.parse(serializado);
  if(!valid(restaurado)||!sameState(copia,restaurado))throw Error('Falha no teste de reconstrução.');
  const localDepois=window.arbitbetCloudBridge.get();
  if(!sameState(localAntes,localDepois))throw Error('Dados locais mudaram durante a simulação. Teste interrompido.');
  const iguais=sameState(localDepois,restaurado);
  info('RECUPERAÇÃO SIMULADA APROVADA · revisão '+cloud.revisao+' · backup reconstruído: '+resumo(restaurado)+' · '+(iguais?'navegador e nuvem idênticos':'ATENÇÃO: navegador e nuvem divergentes')+'. Nenhum registro local ou remoto foi modificado.');
 }catch(e){info('RECUPERAÇÃO SIMULADA NÃO APROVADA: '+e.message+'. Nenhuma restauração executada.');}}));
 actions.append(button('Testar restauração isolada (sem alterar aplicativo)',async()=>{let key='arbitbet_restore_drill_'+Date.now();try{
  if(!email)throw Error('Entre no Firebase.');
  const antes=window.arbitbetCloudBridge.get(),cloud=await consultarNuvem();
  if(!valid(antes)||!cloud.existe||!valid(cloud))throw Error('Dados indisponíveis.');
  const origem={casas:cloud.casas,entradas:cloud.entradas,movimentacoes:cloud.movimentacoes};
  const copia=clone(origem);
  localStorage.setItem(key,JSON.stringify(copia));
  const recuperado=JSON.parse(localStorage.getItem(key)||'null');
  if(!valid(recuperado)||!sameState(origem,recuperado))throw Error('Cópia restaurada não corresponde à nuvem.');
  if(!sameState(antes,window.arbitbetCloudBridge.get()))throw Error('O estado do aplicativo mudou durante o teste.');
  info('RESTAURAÇÃO ISOLADA APROVADA · revisão '+cloud.revisao+' · '+resumo(recuperado)+' · '+(sameState(antes,recuperado)?'navegador e nuvem idênticos':'ATENÇÃO: navegador divergente')+'. Cópia temporária excluída; dados reais não substituídos.');
 }catch(e){info('RESTAURAÇÃO ISOLADA NÃO APROVADA: '+e.message+'. Estado principal não substituído.');}
 finally{localStorage.removeItem(key);}
 }));
 actions.append(button('Simular migração financeira por JSON (somente leitura)',async()=>{
  if(!maintenance()||maintenanceBusy||uploadBusy||syncBusy)return info('Ative a manutenção e aguarde operações pendentes.');
  const picker=document.createElement('input');picker.type='file';picker.accept='.json,application/json';
  picker.onchange=async()=>{try{
   const file=picker.files?.[0];if(!file)return;
   const uid=currentUid,epoch=authEpoch;
   const candidate=JSON.parse(await file.text());
   const cloud=await consultarNuvem();
   if(uid!==currentUid||epoch!==authEpoch||!maintenance())throw Error('Sessão ou manutenção alterada.');
   if(!cloud.existe||cloud.revisao!==47||!sameState(window.arbitbetCloudBridge.get(),cloud))throw Error('Base original divergente ou revisão diferente de 47.');
   if(!valid(candidate))throw Error('JSON inválido.');
   const d=differences(candidate,cloud);
   validateMigrationContent(cloud,candidate);
   validateMigrationBalances(cloud,candidate);
   info('SIMULAÇÃO FINANCEIRA VALIDADA (sem gravação) · '+resumo(candidate)+' · '+diagnosticText(d)+'. Saldos e estrutura das alterações conferidos; autorização específica ainda necessária.');
  }catch(e){info('SIMULAÇÃO BLOQUEADA: '+e.message);}};
  picker.click();
 }));
 actions.append(button('Laboratório Firebase — consultar (isolado)',async()=>{try{const s=await consultarLaboratorio();info(s.existe?'LABORATÓRIO: revisão '+s.revisao+' · '+s.eventos.length+' eventos fictícios. Última origem: '+(s.eventos.at(-1)?.origem||'nenhuma'):'LABORATÓRIO ainda não criado. Nenhum registro financeiro foi consultado ou alterado.');}catch(e){info('Laboratório indisponível: '+e.message+' (possível regra de acesso Firestore).');}}));
 actions.append(button('Laboratório Firebase — iniciar (isolado)',async()=>{if(!confirm('Criar laboratório separado no Firebase? NÃO altera apostas, casas, movimentações nem o documento financeiro. Confirma?'))return;try{const s=await executarLaboratorio('iniciar');info('Laboratório criado. Revisão '+s.revisao+'. Nenhuma aposta real alterada.');}catch(e){info('Laboratório não iniciado: '+e.message+'. Não altere regras de segurança sem revisão.');}}));
 actions.append(button('Laboratório — evento fictício neste aparelho',async()=>{if(!confirm('Registrar evento FICTÍCIO no documento isolado do laboratório? Nenhuma aposta ou saldo será alterado.'))return;try{const origem=/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)?'celular':'computador';const s=await executarLaboratorio(origem);info('Evento fictício salvo no laboratório ('+origem+'). Revisão '+s.revisao+'. Verifique no outro aparelho pelo botão consultar.');}catch(e){info('Evento de laboratório não salvo: '+e.message);}}));
 actions.append(button('Laboratório — criar evento offline (fila fictícia)',()=>{try{const key='arbitbet_sync_lab_offline_queue_v1';const list=JSON.parse(localStorage.getItem(key)||'[]');if(!Array.isArray(list)||list.length>=20)throw Error('Fila inválida ou cheia');const origem=/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)?'celular':'computador';list.push({id:'offline-'+crypto.randomUUID(),origem,data:new Date().toISOString()});localStorage.setItem(key,JSON.stringify(list));info('Evento fictício salvo SOMENTE neste aparelho. Fila offline: '+list.length+'. Nenhum dado enviado ao Firebase.');}catch(e){info('Falha ao criar evento offline: '+e.message);}}));
 actions.append(button('Laboratório — enviar fila offline (isolado)',async()=>{try{const key='arbitbet_sync_lab_offline_queue_v1';const list=JSON.parse(localStorage.getItem(key)||'[]');if(!Array.isArray(list)||!list.length)return info('Fila offline vazia neste aparelho.');if(!confirm('Enviar '+list.length+' eventos fictícios da fila offline ao laboratório? NÃO altera apostas reais.'))return;const s=await enviarEventosLaboratorio(list);localStorage.removeItem(key);info('Fila fictícia conciliada: revisão '+s.revisao+' · '+s.eventos.length+' eventos no laboratório. Fila local limpa.');}catch(e){info('Fila offline PRESERVADA: '+e.message);}}));
 actions.append(button('Concorrência REAL — 1. Capturar base neste aparelho',async()=>{
  try{const r=await capturarBaseConcorrenciaReal();info('BASE CAPTURADA NESTE APARELHO · '+r.quantidade+' apostas fictícias · revisão '+r.revisao+'. NÃO atualize a página antes de enviar. Nenhum dado real alterado.');}
  catch(e){info('Captura bloqueada: '+e.message);}
 }));
 actions.append(button('Concorrência REAL — 2. Enviar aposta da base capturada',async()=>{
  if(!confirm('Enviar uma aposta fictícia a partir da base capturada neste aparelho? Somente laboratório isolado.'))return;
  try{
   const origem=/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)?'celular':'computador';
   const r=await enviarConcorrenciaReal(origem);
   info('CONCORRÊNCIA REAL GRAVADA · '+r.quantidade+' apostas fictícias preservadas · base capturada na revisão '+r.baseRevisao+' · revisão atual '+r.revisao+' · base desatualizada: '+(r.baseDesatualizada?'SIM':'NÃO')+'. Nenhum dado real alterado.');
  }catch(e){info('Concorrência real BLOQUEADA: '+e.message+'. Nenhum dado real alterado.');}
 }));
 actions.append(button('Homologação — simular concorrência (somente laboratório)',async()=>{
  if(!confirm('Simular duas apostas simultâneas e um conflito RED/GREEN em memória, gravando apenas o relatório no laboratório isolado?'))return;
  try{
   const r=await testarConcorrenciaHomologacao();
   info('CONCORRÊNCIA SIMULADA APROVADA · 2 inclusões independentes preservadas · conflito RED/GREEN bloqueado · revisão do laboratório '+r.revisao+'. Apenas relatório de teste gravado; nenhum dado real alterado.');
  }catch(e){info('CONCORRÊNCIA SIMULADA NÃO APROVADA: '+e.message+'. Nenhum dado real alterado.');}
 }));
 actions.append(button('Homologação financeira — iniciar ambiente isolado',async()=>{
  if(!confirm('Inicializar o ambiente de HOMOLOGAÇÃO com uma casa fictícia, sem alterar as 38 apostas reais?'))return;
  try{const s=await homologarFinanceiroIsolado('iniciar');info('HOMOLOGAÇÃO ISOLADA INICIADA · '+s.estado.casas.length+' casa fictícia · '+s.estado.entradas.length+' apostas fictícias · revisão do laboratório '+s.revisao+'. Nenhum dado real alterado.');}
  catch(e){info('Homologação não iniciada: '+e.message);}
 }));
 actions.append(button('Homologação financeira — adicionar aposta fictícia',async()=>{
  if(!confirm('Adicionar aposta fictícia de R$ 1,00 SOMENTE à homologação isolada?'))return;
  try{
   const origem=/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)?'celular':'computador';
   const s=await homologarFinanceiroIsolado('adicionar',origem);
   info('HOMOLOGAÇÃO GRAVADA · '+s.estado.entradas.length+' apostas fictícias · última origem: '+origem+' · revisão do laboratório '+s.revisao+'. Nenhum dado real alterado.');
  }catch(e){info('Homologação bloqueada: '+e.message+'. Nenhum dado real alterado.');}
 }));
 actions.append(button('Homologação financeira — conferir no Firebase (somente leitura)',async()=>{
  try{const s=await homologarFinanceiroIsolado('consultar');const e=s.estado?.entradas||[];info('HOMOLOGAÇÃO CONSULTADA · '+e.length+' apostas fictícias · última origem: '+(e.at(-1)?.origem||'nenhuma')+' · revisão do laboratório '+s.revisao+'. Nenhum dado real alterado.');}
  catch(e){info('Consulta de homologação indisponível: '+e.message);}
 }));
 actions.append(button('Auditoria final da sincronização financeira (somente leitura)',async()=>{
  try{
   if(!email)throw Error('Entre no Firebase.');
   if(syncBusy)throw Error('Sincronização em andamento; aguarde e repita a auditoria.');
   const localAntes=window.arbitbetCloudBridge.get();
   if(!valid(localAntes))throw Error('Dados locais inválidos.');
   const cloud=await consultarNuvem();
   if(!cloud.existe||!valid(cloud))throw Error('Dados da nuvem indisponíveis.');
   const localDepois=window.arbitbetCloudBridge.get();
   if(!sameState(localAntes,localDepois))throw Error('Dados locais mudaram durante a auditoria; repita depois.');
   const d=differences(localDepois,cloud);
   const iguais=sameState(localDepois,cloud);
   const baseAtiva=!!syncBaseline&&syncTimer!==null&&!autoUploadEnabled;
   const baseIgual=baseAtiva&&sameState(syncBaseline,cloud);
   const revisaoIgual=baseAtiva&&syncRevision===cloud.revisao;
   const aprovado=iguais&&baseIgual&&revisaoIgual;
   info((aprovado?'AUDITORIA FINANCEIRA APROVADA':'AUDITORIA FINANCEIRA REQUER CONFERÊNCIA')+' · navegador: '+resumo(localDepois)+' · nuvem: '+resumo(cloud)+' · revisão '+cloud.revisao+' · rotina ativa: '+(baseAtiva?'sim':'não')+' · base igual: '+(baseIgual?'sim':'não')+' · revisão da base igual: '+(revisaoIgual?'sim':'não')+' · '+diagnosticText(d)+'. Somente leitura; nenhum dado gravado.');
  }catch(e){info('AUDITORIA INTERROMPIDA: '+e.message+'. Nenhum dado gravado.');}
 }));
 actions.append(button('Financeiro fictício — registrar neste aparelho (isolado)',async()=>{
  if(!email)return info('Entre no Firebase primeiro.');
  if(!confirm('Criar uma aposta FICTÍCIA de R$ 1,00 SOMENTE no laboratório separado? Não altera suas apostas ou saldos reais.'))return;
  try{
   const origem=/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)?'celular':'computador';
   const s=await testeFinanceiroIsolado('registrar',origem);
   info('FINANCEIRO FICTÍCIO SALVO NO LABORATÓRIO · '+s.entradas.length+' registros · revisão '+s.revisao+'. Consulte no outro aparelho. Nenhuma aposta real alterada.');
  }catch(e){info('Teste financeiro fictício interrompido: '+e.message+'. Nenhum dado real alterado.');}
 }));
 actions.append(button('Financeiro fictício — conferir no outro aparelho (isolado)',async()=>{
  try{
   const s=await testeFinanceiroIsolado('consultar');
   const ultimo=s.entradas.at(-1);
   info('FINANCEIRO FICTÍCIO ISOLADO · '+s.entradas.length+' registros · revisão '+s.revisao+(ultimo?' · último: '+ultimo.origem+' · '+ultimo.resultado+' · R$ '+ultimo.stake.toFixed(2):' · nenhum registro fictício')+'. Dados financeiros reais não consultados nem modificados.');
  }catch(e){info('Consulta fictícia interrompida: '+e.message+'. Nenhum dado real alterado.');}
 }));
 actions.append(button('Testar sincronização em memória (sem gravar)',()=>{const t=testarConciliacaoEmMemoria();info('Teste sem gravar: '+t.aprovados+'/'+t.total+' cenários aprovados. '+t.cenarios.filter(x=>!x.ok).map(x=>x.nome+': '+x.erro).join(' | '));}));
 actions.append(button('Conciliar 99play — 2 apostas + 1 RED (teste)',conciliar99playUI));
 actions.append(button('Preparar Bets365 — Neudson',prepararBets365));
 actions.append(button('Backup local JSON',()=>downloadJson(window.arbitbetCloudBridge.get(),'arbitbet-antes-sync')));
 // Controles de laboratório e manutenção ficam recolhidos no uso diário.
 const advanced=document.createElement('details');
 advanced.className='w-full border-t border-slate-700 pt-2';
 const summary=document.createElement('summary');
 summary.textContent='Ferramentas avançadas de testes e manutenção';
 summary.className='cursor-pointer text-sm text-amber-300';
 const advancedActions=document.createElement('div');
 advancedActions.className='flex flex-wrap gap-2 mt-3';
 advanced.append(summary,advancedActions);
 actions.append(advanced);
 for(const el of [...actions.children]){
  if(el===advanced)continue;
  const t=el.textContent||'';
  if(/Laboratório|Homologação financeira|Auditoria final|Financeiro fictício|Teste sem gravar|Testar sincronização|Simular recuperação|Testar restauração|Conciliar 99play|Preparar Bets365|Ativar envio automático|Mesclar sem excluir|Restaurar da nuvem/.test(t))advancedActions.append(el);
 }
 setActions(false);
}
async function refresh(){
 const epoch=authEpoch,uid=currentUid;
 try{info('Consultando...');const data=await consultarNuvem();if(epoch!==authEpoch||uid!==currentUid)return;remote=data.existe?data:null;
 $('cloudRemote').textContent=remote?resumo(remote)+' · Revisão '+remote.revisao:'Sem registros na nuvem';
 $('cloudLocal').textContent=resumo(window.arbitbetCloudBridge.get());
 setActions(true);if(!remote)$('cloudDownload').disabled=true;
 info('Consulta concluída. Nenhum dado foi modificado.');
 }catch(e){remote=null;setActions(false);info('Falha na consulta: '+e.message);}
}

// Recuperação estrita: somente os 3 registros novos e os 2 RED confirmados.
// Não permite nenhuma outra diferença, nem alteração de casas ou movimentações.
function verificarRecuperacao38(local,cloud){
 const idsNovos=['e_1795296124225','e_1795296211277','e_1795296312501'];
 const idsRed=['npt-3','nbr-5672688958'];
 const d=differences(local,cloud);
 const vazias=x=>!x.apenasLocal.length&&!x.apenasNuvem.length&&!x.divergentes.length;
 if(local.casas.length!==5||cloud.casas.length!==5||local.entradas.length!==35||cloud.entradas.length!==38||
    local.movimentacoes.length!==12||cloud.movimentacoes.length!==12||
    !vazias(d.casas)||!vazias(d.movimentacoes)||
    d.entradas.apenasLocal.length||d.entradas.apenasNuvem.length!==3||
    d.entradas.divergentes.length!==2||
    idsNovos.some(id=>!d.entradas.apenasNuvem.includes(id))||
    idsRed.some(id=>!d.entradas.divergentes.includes(id)))throw Error('Diferenças fora do cenário validado. '+diagnosticText(d));
 const l=new Map(local.entradas.map(x=>[x.id,x]));
 const c=new Map(cloud.entradas.map(x=>[x.id,x]));
 for(const id of idsRed){
  const before=l.get(id),after=c.get(id);
  if(before?.resultado!=='PENDENTE'||after?.resultado!=='RED')throw Error('Resultado inesperado: '+id);
  const {resultado:a,finalizadaEm:b,...baseLocal}=before;
  const {resultado:z,finalizadaEm:y,...baseCloud}=after;
  if(stable(baseLocal)!==stable(baseCloud))throw Error('Outros campos alterados: '+id);
 }
 for(const id of idsNovos){
  const x=c.get(id);
  if(!x||x.resultado!=='RED'||x.casaId!=='nbr')throw Error('Nova entrada inesperada: '+id);
 }
 return d;
}
async function recuperar38ComSeguranca(){
 if(maintenance()||maintenanceBusy||uploadBusy||syncBusy)return info('Operação indisponível durante manutenção ou outra gravação.');
 uploadBusy=true;
 try{return await recuperar38ComSegurancaImpl();}finally{uploadBusy=false;}
}
async function recuperar38ComSegurancaImpl(){
 if(maintenance()||maintenanceBusy)return info('Operação bloqueada durante manutenção.');
 if(!email)return info('Entre no Firebase antes da recuperação.');
 if(syncBusy||autoUploadEnabled)return info('Sincronização ou envio em andamento. Aguarde.');
 const local=window.arbitbetCloudBridge.get();
 try{
  const cloud=await consultarNuvem();
  if(!cloud.existe||!valid(cloud))throw Error('Nuvem indisponível.');
  verificarRecuperacao38(local,cloud);
  if(!sameState(local,window.arbitbetCloudBridge.get()))throw Error('Dados locais mudaram durante a verificação.');
  const msg='RECUPERAÇÃO CONTROLADA NO CELULAR?\\n\\nA nuvem contém 38 entradas e o aparelho 35.\\nSerão acrescentadas 3 entradas e atualizados 2 resultados PENDENTE para RED.\\nNenhuma alteração será enviada à nuvem.\\nDois backups JSON serão baixados antes da recuperação.\\n\\nConfirma?';
  if(!confirm(msg))return info('Recuperação cancelada; nada alterado.');
  // Nova leitura evita usar uma cópia remota desatualizada após a confirmação.
  const atual=await consultarNuvem();
  if(!atual.existe||atual.revisao!==cloud.revisao||!sameState(cloud,atual))throw Error('A nuvem mudou; recomece a conferência.');
  if(!sameState(local,window.arbitbetCloudBridge.get()))throw Error('O aparelho mudou; recomece a conferência.');
  verificarRecuperacao38(local,atual);
  downloadJson(local,'arbitbet-recuperacao38-celular-antes');
  downloadJson(atual,'arbitbet-recuperacao38-nuvem-antes');
  stopSafeSync();
  window.arbitbetCloudBridge.replace({casas:clone(atual.casas),entradas:clone(atual.entradas),movimentacoes:clone(atual.movimentacoes)});
  const depois=window.arbitbetCloudBridge.get();
  if(!sameState(depois,atual))throw Error('A verificação posterior falhou. Guarde os backups.');
  remote=atual;
  $('cloudLocal').textContent=resumo(depois);
  startSafeSync(atual);
  info('RECUPERAÇÃO VALIDADA: 5 casas, 38 entradas, 12 movimentações; revisão '+atual.revisao+'. Nuvem não modificada.');
 }catch(e){info('RECUPERAÇÃO BLOQUEADA: '+e.message+' Não execute restauração manual.');}
}

async function restoreCloud(){
 if(maintenance()||maintenanceBusy||uploadBusy||syncBusy)return info('Operação indisponível durante manutenção ou outra gravação.');
 uploadBusy=true;
 try{return await restoreCloudImpl();}finally{uploadBusy=false;}
}
async function restoreCloudImpl(){
 if(maintenance()||maintenanceBusy)return info('Operação bloqueada durante manutenção.');
 stopSafeSync();
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
 if(maintenance()||maintenanceBusy||uploadBusy||syncBusy)return info('Operação indisponível durante manutenção ou outra gravação.');
 uploadBusy=true;
 try{return await conciliar99playUIImpl();}finally{uploadBusy=false;}
}
async function conciliar99playUIImpl(){
 if(maintenance()||maintenanceBusy)return info('Operação bloqueada durante manutenção.');
 stopSafeSync();
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
 if(maintenance()||maintenanceBusy||uploadBusy||syncBusy)return info('Operação indisponível durante manutenção ou outra gravação.');
 uploadBusy=true;
 try{return await prepararBets365Impl();}finally{uploadBusy=false;}
}
async function prepararBets365Impl(){
 if(maintenance()||maintenanceBusy)return info('Operação bloqueada durante manutenção.');
 stopSafeSync();
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
 if(maintenance()||maintenanceBusy||uploadBusy||syncBusy)return info('Operação indisponível durante manutenção ou outra gravação.');
 uploadBusy=true;
 try{return await mergeCloudImpl();}finally{uploadBusy=false;}
}
async function mergeCloudImpl(){
 if(maintenance()||maintenanceBusy)return info('Operação bloqueada durante manutenção.');
 stopSafeSync();
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
 if(maintenance()||maintenanceBusy||uploadBusy||syncBusy)return info('Operação indisponível durante manutenção ou outra gravação.');
 uploadBusy=true;
 try{return await uploadCloudImpl();}finally{uploadBusy=false;}
}
async function uploadCloudImpl(){
 if(maintenance()||maintenanceBusy)return info('Operação bloqueada durante manutenção.');
 stopSafeSync();
 const local=window.arbitbetCloudBridge.get();
 if(!valid(local)||!local.casas.length)return info('Sem casas locais. Envio de estado vazio bloqueado.');
 if(remote && !confirm('A nuvem já contém dados ('+resumo(remote)+').\n\nConfira cuidadosamente: esta operação substituirá o estado remoto, não mesclará as alterações. Continuar?'))return;
 const msg='ENVIAR DADOS PARA NUVEM?\n\nLocal: '+resumo(local)+'\nNuvem: '+(remote?resumo(remote):'vazia')+'\n\nUm backup local será baixado. Confirma o envio?';
 if(!confirm(msg))return;
 downloadJson(local,'arbitbet-antes-envio-nuvem');
 try{info('Verificando revisão e gravando...');const revision=await gravarComConfirmacao(local,remote?.revisao??0,true);info('Enviado com sucesso (revisão '+revision+').');await refresh();}
 catch(e){info('Envio NÃO concluído: '+e.message+' Atualize a consulta antes de tentar novamente.');}
}
window.addEventListener('arbitbet:local-change',()=>{
 if(syncBaseline)void safeSync();
});
// Login único: não iniciar sincronização antes de validar a conta e os dados locais.
function start(){
 if(!window.arbitbetCloudBridge)return;
 modal();
 const btn=button('☁ Nuvem',()=>{const overlay=$('cloudOverlay');overlay.classList.remove('hidden');overlay.classList.add('flex');$('cloudLocal').textContent=resumo(window.arbitbetCloudBridge.get());});
 const banner=document.createElement('p');banner.id='maintenanceBanner';banner.hidden=true;banner.textContent='Manutenção financeira ativa. Abra Nuvem para consultar ou retomar.';banner.style.cssText='padding:12px;background:#78350f;color:white;text-align:center';document.body.prepend(banner);
 document.addEventListener('click',e=>{if(maintenance()&&!e.target.closest('#cloudOverlay,#btnCloud,#btnSair,#loginOverlay')){e.preventDefault();e.stopImmediatePropagation();}},true);
 for(const type of ['submit','change','drop'])document.addEventListener(type,e=>{if(maintenance()&&!e.target.closest('#cloudOverlay,#loginOverlay')){e.preventDefault();e.stopImmediatePropagation();}},true);
 btn.id='btnCloud';document.querySelector('.header-actions')?.prepend(btn);
 const gate=$('loginOverlay'), form=$('formLogin'), status=$('loginErro'), ownerKey='arbitbet_financial_owner_v1';
 const lock=()=>{gate.style.display='flex';$('cloudOverlay').classList.add('hidden');$('cloudOverlay').classList.remove('flex');};
 const ready=(yes)=>{$('loginEntrar').disabled=!yes;$('loginRecuperar').disabled=!yes;};
 const restore=button('Conferir e recuperar dados da nuvem',()=>{});restore.classList.add('hidden','w-full');form.append(restore);
 const retry=button('Tentar novamente',()=>{});retry.classList.add('hidden','w-full');form.append(retry);
 $('loginMostrar').onclick=()=>{const p=$('loginSenha');p.type=p.type==='password'?'text':'password';$('loginMostrar').textContent=p.type==='password'?'Mostrar':'Ocultar';};
 $('loginTrocar').onclick=async()=>{try{await sair();}catch(e){status.textContent='Não foi possível sair. Tente novamente.';}};
 $('btnSair').onclick=async()=>{lock();stopSafeSync();stopAuto();stopLabWatch();try{await sair();}catch(e){status.textContent='Não foi possível sair. Tente novamente.';$('loginTrocar').classList.remove('hidden');}};
 form.onsubmit=async e=>{e.preventDefault();ready(false);status.textContent='Autenticando...';try{await entrar($('loginEmail').value.trim(),$('loginSenha').value);$('loginSenha').value='';}catch(e){status.textContent='Não foi possível entrar. Código Firebase: '+(typeof e?.code==='string' && /^[a-z0-9/_-]+$/i.test(e.code)?e.code:'erro-desconhecido');ready(true);}};
 $('loginRecuperar').onclick=async()=>{const field=$('loginEmail');if(!field.reportValidity())return;try{await recuperarSenha(field.value);status.textContent='Se a conta estiver cadastrada, confira seu e-mail para redefinir a senha.';}catch(e){status.textContent='Não foi possível solicitar a recuperação. Confira a conexão e tente novamente.';}};
 async function prepare(user,epoch){
  const active=()=>epoch===authEpoch&&currentUid===user.uid;
  restore.classList.add('hidden');retry.classList.add('hidden');status.textContent='Conferindo seus dados com a nuvem...';
  try{
   const owner=localStorage.getItem(ownerKey);
   if(owner&&owner!==user.uid){status.textContent='Este navegador contém dados vinculados a outra conta. Entre com a conta original. Nenhum dado foi alterado.';return;}
   const data=await consultarNuvem();if(!active())return;
   if(!data.existe||!valid(data))throw Error('Não há dados financeiros válidos na nuvem para esta conta.');
   const local=window.arbitbetCloudBridge.get();
   const empty=!local.casas.length&&!local.entradas.length&&!local.movimentacoes.length;
   function unlock(cloud){
    if(!active())return;
    localStorage.setItem(ownerKey,user.uid);remote=cloud;
    $('cloudLocal').textContent=resumo(window.arbitbetCloudBridge.get());
    $('cloudRemote').textContent=resumo(cloud)+' · Revisão '+cloud.revisao;
    setActions(true);showMaintenance();startSafeSync(cloud);startAuto();startLabWatch();
    gate.style.display='none';status.textContent='';restore.classList.add('hidden');retry.classList.add('hidden');
   }
   if(maintenance()){unlock(data);return;}
    if(empty){window.arbitbetCloudBridge.replace({casas:clone(data.casas),entradas:clone(data.entradas),movimentacoes:clone(data.movimentacoes)});unlock(data);return;}
   if(sameState(local,data)){unlock(data);return;}
   status.textContent='Dados locais diferentes da nuvem. Nenhum dado foi enviado. Local: '+resumo(local)+' | Nuvem: '+resumo(data)+'.';
   restore.classList.remove('hidden');
   restore.onclick=async()=>{
    if(!active())return;
    restore.disabled=true;
    try{
     const fresh=await consultarNuvem();if(!active())return;
     if(!fresh.existe||!valid(fresh))throw Error('Nuvem indisponível.');
     const current=window.arbitbetCloudBridge.get();
     if(!confirm('Substituir apenas os dados deste navegador pelos dados da sua conta na nuvem? Local: '+resumo(current)+' | Nuvem: '+resumo(fresh)+'. Será baixado um backup local. Nenhum dado será enviado à nuvem.'))return;
     downloadJson(current,'arbitbet-antes-login-unico');
     window.arbitbetCloudBridge.replace({casas:clone(fresh.casas),entradas:clone(fresh.entradas),movimentacoes:clone(fresh.movimentacoes)});
     unlock(fresh);
    }catch(e){status.textContent='Recuperação interrompida: '+e.message;}finally{restore.disabled=false;}
   };
  }catch(e){if(active()){status.textContent='Acesso aguardando conferência: '+e.message;retry.classList.remove('hidden');retry.onclick=()=>{if(active())void prepare(user,epoch);};}}
 }
 window.arbitbetExcluirEntrada=async id=>{
  if(maintenance()||maintenanceBusy||uploadBusy||!currentUid||!syncBaseline||syncBusy)throw Error('Sincronização indisponível ou em andamento. Tente novamente.');
  const uid=currentUid,epoch=authEpoch,local=window.arbitbetCloudBridge.get();
  if(!sameState(local,syncBaseline))throw Error('Aguarde a sincronização das alterações pendentes.');
  const entrada=local.entradas.find(x=>x.id===id);if(!entrada)throw Error('Entrada não encontrada.');
  syncBusy=true;
  try{
   downloadJson(local,'arbitbet-antes-exclusao');
   const next=await excluirEntradaConfirmada(entrada,true);
   if(epoch!==authEpoch||uid!==currentUid)return;
   if(!sameState(local,window.arbitbetCloudBridge.get())){pauseSync('Alteração local durante exclusão. Confira diferenças.');throw Error('Exclusão registrada na nuvem; confira alterações locais.');}
   window.arbitbetCloudBridge.replace({casas:next.casas,entradas:next.entradas,movimentacoes:next.movimentacoes});
   remote=next;startSafeSync(next);
  }finally{syncBusy=false;}
 };
 lock();ready(false);
 try{configurarFirebase(config);observarUsuario(user=>{
  const epoch=++authEpoch;
  stopAuto();stopSafeSync();stopLabWatch();lock();
  currentUid=user?.uid||null;email=user?.email||'';remote=null;lastAutoNotice='';showMaintenance();
  $('cloudLogin').classList.toggle('hidden',!!user);$('cloudLogged').classList.toggle('hidden',!user);
  $('cloudUser').textContent=user?'Conectado: '+email:'';setActions(false);
  restore.classList.add('hidden');retry.classList.add('hidden');
  $('loginTrocar').classList.toggle('hidden',!user);
  ready(!user);$('loginEmail').disabled=!!user;$('loginSenha').disabled=!!user;
  if(user){$('loginEmail').value=email;void prepare(user,epoch);}
  else{status.textContent='Entre com sua conta Firebase.';$('cloudRemote').textContent='Entre para consultar.';}
 });}
 catch(e){status.textContent='Firebase indisponível. Reabra o aplicativo quando estiver conectado.';}
 $('cloudLogin').onsubmit=e=>e.preventDefault();
 $('cloudLogout').onclick=()=> $('btnSair').click();
}
start();
