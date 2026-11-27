// Arbitbet V2 — infraestrutura isolada para testes. Não é carregada pela produção.
// Não contém credenciais, não executa login ou gravação automaticamente.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore, doc, getDoc, runTransaction } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

let auth, db;
const pathFor = uid => doc(db, 'users', uid, 'state', 'current');

export function configurarFirebase(config) {
  if (!config || !['apiKey','authDomain','projectId','appId'].every(k => typeof config[k] === 'string' && config[k].trim())) {
    throw new Error('Configuração Firebase Web incompleta. Nenhum dado foi enviado.');
  }
  const app = initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);
  return { auth, db };
}
export function observarUsuario(callback) {
  if (!auth) throw new Error('Configure o Firebase primeiro.');
  return onAuthStateChanged(auth, callback);
}
export async function entrar(email, senha) {
  if (!auth) throw new Error('Configure o Firebase primeiro.');
  return (await signInWithEmailAndPassword(auth, email, senha)).user;
}
export async function recuperarSenha(email) {
  if (!auth) throw new Error('Firebase indisponível.');
  await sendPasswordResetEmail(auth, email.trim());
}
export async function sair() {
  if (auth) await signOut(auth);
}
function usuarioAtual() {
  const user = auth?.currentUser;
  if (!user || !db) throw new Error('Faça login no Firebase antes de acessar dados na nuvem.');
  return user;
}
export async function consultarNuvem() {
  const user = usuarioAtual();
  const snapshot = await getDoc(pathFor(user.uid));
  return snapshot.exists() ? { existe: true, ...snapshot.data() } : { existe: false, revisao: 0 };
}
function validarEstado(estado) {
  if (!estado || !Array.isArray(estado.casas) || !Array.isArray(estado.entradas) || !Array.isArray(estado.movimentacoes)) {
    throw new Error('Dados inválidos: operação cancelada.');
  }
}
// Somente após confirmação explícita na interface e backup local prévio.
// A revisão impede sobrescrever alterações realizadas por outro aparelho.
export async function gravarComConfirmacao(estado, revisaoEsperada, confirmado) {
  validarEstado(estado);
  if (confirmado !== true) throw new Error('É necessária confirmação explícita para gravar na nuvem.');
  if (!Number.isInteger(revisaoEsperada) || revisaoEsperada < 0) throw new Error('Revisão inválida.');
  const user = usuarioAtual();
  const referencia = pathFor(user.uid);
  return runTransaction(db, async transaction => {
    const atual = await transaction.get(referencia);
    const revisaoAtual = atual.exists() ? atual.data().revisao : 0;
    if (revisaoAtual !== revisaoEsperada) {
      throw new Error('Há alterações na nuvem. Recarregue e compare os dados antes de salvar.');
    }
    const revisao = revisaoAtual + 1;
    transaction.set(referencia, {
      versaoEsquema: 1, revisao, atualizadoEm: new Date().toISOString(),
      casas: structuredClone(estado.casas),
      entradas: structuredClone(estado.entradas),
      movimentacoes: structuredClone(estado.movimentacoes)
    });
    return revisao;
  });
}


// Mesclagem transacional conservadora: nunca apaga registros e bloqueia IDs divergentes.
export async function mesclarSemPerdas(local) {
  validarEstado(local);
  const ref = pathFor(usuarioAtual().uid);
  return runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    const atual = snap.exists() ? snap.data() : {revisao:0,casas:[],entradas:[],movimentacoes:[]};
    validarEstado(atual);
    const combinado = {};
    let houveInclusao = false;
    for (const campo of ['casas','entradas','movimentacoes']) {
      const mapa = new Map();
      for (const item of atual[campo]) {
        if (!item?.id || mapa.has(String(item.id))) throw new Error('ID inválido ou duplicado na nuvem: '+campo);
        mapa.set(String(item.id), item);
      }
      const idsLocais = new Set();
      for (const item of local[campo]) {
        if (item?.id && idsLocais.has(String(item.id))) throw new Error('ID duplicado no navegador: '+campo);
        if (item?.id) idsLocais.add(String(item.id));
        if (!item?.id) throw new Error('ID inválido no navegador: '+campo);
        const antigo = mapa.get(String(item.id));
        if (antigo && JSON.stringify(antigo)!==JSON.stringify(item)) {
          throw new Error('Conflito em '+campo+' / '+item.id+'. Nenhum dado foi alterado. É preciso conciliar a edição antes de sincronizar.');
        }
        if (!antigo) houveInclusao = true;
        mapa.set(String(item.id), item);
      }
      combinado[campo]=Array.from(mapa.values());
    }
    const ids=new Set(combinado.casas.map(c=>c.id));
    if(combinado.entradas.some(e=>!ids.has(e.casaId))||combinado.movimentacoes.some(m=>!ids.has(m.casaId)))throw new Error('Referências inválidas; sincronização cancelada.');
    if (!houveInclusao && snap.exists()) return {estado:combinado,revisao:atual.revisao||0,semAlteracoes:true};
    const revisao=(atual.revisao||0)+1;
    tx.set(ref,{...combinado,revisao,versaoEsquema:1,atualizadoEm:new Date().toISOString()});
    return {estado:combinado,revisao};
  });
}

 
// Conciliação pontual da 99play: duas inclusões reais e encerramento de uma aposta.
// Não altera outros registros nem permite exclusões. Transação atômica com pré-condições.
export async function conciliar99play(local) {
  validarEstado(local);
  const idsNovos=['e_1795282405185','e_1795282491842'];
  const idAtualizado='99play-5674230586';
  const esperados=[
    {id:idsNovos[0],casaId:'n99',data:'2026-11-21',odd:2.6,stake:10,resultado:'RED'},
    {id:idsNovos[1],casaId:'n99',data:'2026-11-21',odd:2.85,stake:14,resultado:'RED'}
  ];
  const chave=x=>JSON.stringify(ordenar(x));
  function ordenar(x){
    if(Array.isArray(x))return x.map(ordenar);
    if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,ordenar(x[k])]));
    return x;
  }
  const ref=pathFor(usuarioAtual().uid);
  return runTransaction(db,async tx=>{
    const snap=await tx.get(ref);
    if(!snap.exists())throw Error('Nuvem vazia: operação bloqueada.');
    const cloud=snap.data();
    validarEstado(cloud);
    if(cloud.entradas.length!==33||local.entradas.length!==35)throw Error('Quantidades inesperadas: exige 33 apostas na nuvem e 35 no navegador.');
    const resultado={};
    for(const campo of ['casas','entradas','movimentacoes']){
      const map=items=>{
        const m=new Map();
        for(const x of items){if(!x?.id||m.has(String(x.id)))throw Error('ID inválido ou repetido em '+campo);m.set(String(x.id),x);}
        return m;
      };
      const nuvem=map(cloud[campo]),navegador=map(local[campo]);
      if(campo!=='entradas'){
        if(nuvem.size!==navegador.size||[...nuvem].some(([id,x])=>!navegador.has(id)||chave(x)!==chave(navegador.get(id))))throw Error('Diferenças inesperadas em '+campo+'.');
      }else{
        if(navegador.size!==nuvem.size+2)throw Error('Quantidade de apostas novas inesperada.');
        for(const esperado of esperados){
          const x=navegador.get(esperado.id);
          if(!x||nuvem.has(esperado.id)||Object.entries(esperado).some(([k,v])=>x[k]!==v))throw Error('Aposta nova inválida ou já existente: '+esperado.id);
        }
        const novas=[...navegador.keys()].filter(id=>!nuvem.has(id));
        if(novas.length!==2||novas.some(id=>!idsNovos.includes(id)))throw Error('Existem outras apostas novas não previstas.');
        const antiga=nuvem.get(idAtualizado),editada=navegador.get(idAtualizado);
        if(!antiga||!editada||antiga.resultado!=='PENDENTE'||editada.resultado!=='RED'||antiga.casaId!=='n99'||antiga.stake!==1.45)throw Error('Aposta de R$ 1,45 não está no estado esperado.');
        const {resultado:ra,finalizadaEm:fa,...baseAntiga}=antiga;
        const {resultado:rb,finalizadaEm:fb,...baseNova}=editada;
        if(chave(baseAntiga)!==chave(baseNova))throw Error('A aposta antiga possui outras edições não autorizadas.');
        for(const [id,x] of nuvem){
          if(id===idAtualizado)continue;
          if(!navegador.has(id)||chave(x)!==chave(navegador.get(id)))throw Error('Outra aposta divergente: '+id);
        }
      }
      resultado[campo]=local[campo].map(x=>structuredClone(x));
    }
    const casas=new Set(resultado.casas.map(x=>x.id));
    if(resultado.entradas.some(x=>!casas.has(x.casaId))||resultado.movimentacoes.some(x=>!casas.has(x.casaId)))throw Error('Referência de casa inválida.');
    const revisao=cloud.revisao+1;
    if(!Number.isInteger(revisao)||revisao<1)throw Error('Revisão inválida.');
    tx.set(ref,{...resultado,revisao,versaoEsquema:1,atualizadoEm:new Date().toISOString()});
    return {revisao,estado:resultado};
  });
}


// Sincronização bidirecional por base comum. Edições concorrentes no mesmo ID
// são bloqueadas; inclusão independente em outro dispositivo é preservada.
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>[k,canonical(x[k])])):x;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
function indexar(items,campo){
 const m=new Map();
 for(const item of items){if(!item?.id||m.has(String(item.id)))throw Error('ID ausente ou duplicado: '+campo);m.set(String(item.id),item);}
 return m;
}
export function conciliarTresVias(base,local,cloud){
 const result={};
 for(const campo of ['casas','entradas','movimentacoes']){
  const b=indexar(base[campo],campo),l=indexar(local[campo],campo),r=indexar(cloud[campo],campo);
  const merged=new Map();
  for(const id of new Set([...b.keys(),...l.keys(),...r.keys()])){
   const before=b.get(id),mine=l.get(id),theirs=r.get(id);
   if(before && !mine && theirs)throw Error('Exclusão detectada em '+campo+'/'+id+'. Sincronização pausada.');
   const localChanged=!equal(mine,before),cloudChanged=!equal(theirs,before);
   if(localChanged&&cloudChanged&&!equal(mine,theirs))throw Error('Edição concorrente em '+campo+'/'+id+'. Sincronização pausada.');
   const chosen=localChanged?mine:theirs;
   if(chosen)merged.set(id,structuredClone(chosen));
  }
  result[campo]=[...merged.values()];
 }
 const casas=new Set(result.casas.map(x=>x.id));
 if(result.entradas.some(x=>!casas.has(x.casaId))||result.movimentacoes.some(x=>!casas.has(x.casaId)))throw Error('Referências inválidas. Sincronização pausada.');
 return result;
}
export async function excluirEntradaConfirmada(entrada, confirmado){
 if(confirmado!==true||!entrada?.id)throw Error('Confirmação obrigatória.');
 const uid=usuarioAtual().uid,ref=pathFor(uid);
 return runTransaction(db,async tx=>{
  const snap=await tx.get(ref);if(auth?.currentUser?.uid!==uid||!snap.exists())throw Error('Conta ou nuvem indisponível.');
  const cloud=snap.data();validarEstado(cloud);
  const found=cloud.entradas.find(x=>x.id===entrada.id);
  if(!found||!equal(found,entrada))throw Error('Entrada ausente ou alterada na nuvem. Confira antes de excluir.');
  const next={...cloud,entradas:cloud.entradas.filter(x=>x.id!==entrada.id),revisao:cloud.revisao+1,atualizadoEm:new Date().toISOString()};
  tx.set(ref,next);return next;
 });
}
export async function sincronizarTresVias(base,local,revisaoBase){
 validarEstado(base);validarEstado(local);
 if(!Number.isInteger(revisaoBase)||revisaoBase<1)throw Error('Revisão de referência inválida.');
 const uid=usuarioAtual().uid;
 const ref=pathFor(uid);
 return runTransaction(db,async tx=>{
  if(auth?.currentUser?.uid!==uid)throw Error('Conta Firebase mudou durante a sincronização.');
  const snap=await tx.get(ref);
  if(auth?.currentUser?.uid!==uid)throw Error('Conta Firebase mudou durante a sincronização.');
  if(!snap.exists())throw Error('Dados remotos ausentes.');
  const cloud=snap.data();validarEstado(cloud);
  if(!Number.isInteger(cloud.revisao)||cloud.revisao<revisaoBase)throw Error('Revisão remota inconsistente.');
  const merged=conciliarTresVias(base,local,cloud);
  const changed=['casas','entradas','movimentacoes'].some(k=>!equal(merged[k],cloud[k]));
  if(!changed)return {estado:merged,revisao:cloud.revisao,semAlteracoes:true};
  const revisao=cloud.revisao+1;
  if(auth?.currentUser?.uid!==uid)throw Error('Conta Firebase mudou antes da gravação.');
  tx.set(ref,{...merged,revisao,versaoEsquema:1,atualizadoEm:new Date().toISOString()});
  return {estado:merged,revisao};
 });
}

 
// Testes em memória, sem Firebase, sem localStorage e sem modificar apostas reais.
export function testarConciliacaoEmMemoria(){
 const casa={id:'teste-casa'};
 const aposta={id:'teste-aposta',casaId:'teste-casa',resultado:'PENDENTE',stake:1,odd:2};
 const base={casas:[casa],entradas:[aposta],movimentacoes:[]};
 const novo={id:'teste-nova',casaId:'teste-casa',resultado:'RED',stake:2,odd:3};
 const scenarios=[];
 function check(nome,fn){try{fn();scenarios.push({nome,ok:true});}catch(e){scenarios.push({nome,ok:false,erro:e.message});}}
 check('Inclusão local',()=>{const s=conciliarTresVias(base,{...base,entradas:[aposta,novo]},base);if(s.entradas.length!==2)throw Error('Inclusão perdida');});
 check('Atualização RED',()=>{const s=conciliarTresVias(base,{...base,entradas:[{...aposta,resultado:'RED'}]},base);if(s.entradas[0].resultado!=='RED')throw Error('Resultado perdido');});
 check('Atualização GREEN remota',()=>{const s=conciliarTresVias(base,base,{...base,entradas:[{...aposta,resultado:'GREEN'}]});if(s.entradas[0].resultado!=='GREEN')throw Error('Resultado remoto perdido');});
 check('Inclusões independentes',()=>{const s=conciliarTresVias(base,{...base,entradas:[aposta,novo]},{...base,entradas:[aposta,{...novo,id:'teste-outra'}]});if(s.entradas.length!==3)throw Error('Inclusão concorrente perdida');});
 check('Conflito bloqueado',()=>{try{conciliarTresVias(base,{...base,entradas:[{...aposta,resultado:'RED'}]},{...base,entradas:[{...aposta,resultado:'GREEN'}]});}catch(e){if(e.message.includes('Edição concorrente'))return;throw e;}throw Error('Conflito não bloqueado');});
 check('Exclusão remota sem edição local',()=>{const s=conciliarTresVias(base,base,{...base,entradas:[]});if(s.entradas.length)throw Error('Exclusão remota não aplicada');});
 check('Exclusão remota com edição local bloqueada',()=>{try{conciliarTresVias(base,{...base,entradas:[{...aposta,stake:3}]},{...base,entradas:[]});}catch(e){if(e.message.includes('Edição concorrente'))return;throw e;}throw Error('Conflito não bloqueado');});
 check('Exclusão bloqueada',()=>{try{conciliarTresVias(base,{...base,entradas:[]},base);}catch(e){if(e.message.includes('Exclusão detectada'))return;throw e;}throw Error('Exclusão não bloqueada');});
 check('Edições iguais em ambos os aparelhos',()=>{const edit={...aposta,resultado:'RED'};const s=conciliarTresVias(base,{...base,entradas:[edit]},{...base,entradas:[edit]});if(s.entradas[0].resultado!=='RED')throw Error('Edição idêntica perdida');});
 check('Conflito de valor bloqueado',()=>{try{conciliarTresVias(base,{...base,entradas:[{...aposta,stake:3}]},{...base,entradas:[{...aposta,stake:4}]});}catch(e){if(e.message.includes('Edição concorrente'))return;throw e;}throw Error('Conflito financeiro não bloqueado');});
 check('Inclusão com mesmo ID divergente bloqueada',()=>{try{conciliarTresVias(base,{...base,entradas:[aposta,novo]},{...base,entradas:[aposta,{...novo,stake:99}]});}catch(e){if(e.message.includes('Edição concorrente'))return;throw e;}throw Error('Duplicidade divergente não bloqueada');});
 return {total:scenarios.length,aprovados:scenarios.filter(x=>x.ok).length,cenarios:scenarios};
}

// Laboratório separado: usa documento exclusivo, nunca users/{uid}/state/current.
// Acesso depende das regras Firestore; falha de permissão não afeta dados reais.
const laboratorioRef=uid=>doc(db,'users',uid,'sync_lab','isolated_v1');
export async function consultarLaboratorio(){
 const snap=await getDoc(laboratorioRef(usuarioAtual().uid));
 return snap.exists()?{existe:true,...snap.data()}:{existe:false,revisao:0};
}
export async function executarLaboratorio(acao){
 if(!['iniciar','computador','celular','resetar'].includes(acao))throw Error('Ação inválida.');
 const ref=laboratorioRef(usuarioAtual().uid);
 return runTransaction(db,async tx=>{
  const snap=await tx.get(ref);
  const old=snap.exists()?snap.data():null;
  if(old && old.tipo!=='arbitbet-sync-lab-v1')throw Error('Documento de laboratório inesperado; bloqueado.');
  if(acao!=='iniciar' && !old)throw Error('Inicie o laboratório primeiro.');
  const eventos=acao==='iniciar'||acao==='resetar'?[]:[...(old.eventos||[])];
  if(acao==='computador'||acao==='celular')eventos.push({id:'lab-'+(old.revisao+1),origem:acao,descricao:'Evento fictício sem aposta nem valor real',data:new Date().toISOString()});
  const next={tipo:'arbitbet-sync-lab-v1',revisao:(old?.revisao||0)+1,eventos,atualizadoEm:new Date().toISOString()};
  tx.set(ref,next);
  return next;
 });
}

// Teste financeiro fictício: usa exclusivamente o documento sync_lab/isolated_v1.
// NUNCA lê ou grava users/{uid}/state/current, apostas ou saldos reais.
export async function testeFinanceiroIsolado(acao, origem) {
 if(!['consultar','registrar'].includes(acao))throw Error('Ação inválida.');
 if(acao==='registrar' && !['computador','celular'].includes(origem))throw Error('Origem inválida.');
 const ref=laboratorioRef(usuarioAtual().uid);
 if(acao==='consultar'){
  const snap=await getDoc(ref);
  if(!snap.exists()||snap.data().tipo!=='arbitbet-sync-lab-v1')throw Error('Inicie o laboratório Firebase isolado primeiro.');
  const d=snap.data();
  return {revisao:d.revisao,entradas:d.financeiroFicticio||[]};
 }
 return runTransaction(db,async tx=>{
  const snap=await tx.get(ref);
  if(!snap.exists()||snap.data().tipo!=='arbitbet-sync-lab-v1')throw Error('Laboratório isolado não iniciado.');
  const d=snap.data(), entradas=d.financeiroFicticio||[];
  if(!Array.isArray(entradas)||entradas.length>=20)throw Error('Limite de 20 registros fictícios atingido; nenhuma alteração.');
  const registro={id:'ficticio-'+crypto.randomUUID(),origem,resultado:'PENDENTE',stake:1,odd:2,criadoEm:new Date().toISOString()};
  const next={...d,financeiroFicticio:[...entradas,registro],revisao:d.revisao+1,atualizadoEm:new Date().toISOString()};
  tx.set(ref,next);
  return {revisao:next.revisao,entradas:next.financeiroFicticio};
 });
}

// Homologação: usa a MESMA conciliarTresVias da sincronização financeira,
// mas persiste somente em sync_lab/isolated_v1, nunca em state/current.
export async function homologarFinanceiroIsolado(acao,origem){
 if(!['consultar','iniciar','adicionar'].includes(acao))throw Error('Ação de homologação inválida.');
 if(acao==='adicionar'&&!['computador','celular'].includes(origem))throw Error('Origem inválida.');
 const ref=laboratorioRef(usuarioAtual().uid);
 const inicial={casas:[{id:'hom-casa',nome:'Casa fictícia de homologação'}],entradas:[],movimentacoes:[]};
 const validar=d=>{if(!d||d.tipo!=='arbitbet-sync-lab-v1')throw Error('Laboratório isolado não iniciado.');};
 if(acao==='consultar'){
  const snap=await getDoc(ref);
  if(!snap.exists())throw Error('Inicie o laboratório isolado.');
  const d=snap.data();validar(d);
  return {revisao:d.revisao,estado:d.homologacaoFinanceira||null};
 }
 return runTransaction(db,async tx=>{
  const snap=await tx.get(ref);
  if(!snap.exists())throw Error('Inicie o laboratório isolado.');
  const d=snap.data();validar(d);
  const atual=d.homologacaoFinanceira;
  if(acao==='iniciar'&&atual)return {revisao:d.revisao,estado:atual,semAlteracoes:true};
  if(acao==='adicionar'&&!atual)throw Error('Inicie a homologação antes de registrar.');
  const base=atual||inicial;
  validarEstado(base);
  if(base.entradas.length>=12)throw Error('Limite de 12 apostas fictícias na homologação.');
  const local=structuredClone(base);
  if(acao==='adicionar')local.entradas.push({
   id:'hom-'+crypto.randomUUID(),casaId:'hom-casa',resultado:'PENDENTE',
   stake:1,odd:2,origem,criadoEm:new Date().toISOString()
  });
  const merged=conciliarTresVias(base,local,base);
  const next={...d,homologacaoFinanceira:merged,revisao:d.revisao+1,atualizadoEm:new Date().toISOString()};
  tx.set(ref,next);
  return {revisao:next.revisao,estado:merged};
 });
}

// Simula duas edições a partir da MESMA base, com gravação de relatório
// exclusivamente no laboratório Firebase; não toca dados financeiros reais.
export async function testarConcorrenciaHomologacao(){
 const ref=laboratorioRef(usuarioAtual().uid);
 return runTransaction(db,async tx=>{
  const snap=await tx.get(ref);
  if(!snap.exists()||snap.data().tipo!=='arbitbet-sync-lab-v1')throw Error('Laboratório isolado não iniciado.');
  const d=snap.data();
  if(!d.homologacaoFinanceira)throw Error('Inicie a homologação financeira primeiro.');
  const base={casas:[{id:'conc-casa'}],entradas:[],movimentacoes:[]};
  const pc=structuredClone(base),cel=structuredClone(base);
  pc.entradas.push({id:'conc-pc',casaId:'conc-casa',stake:1,odd:2,resultado:'PENDENTE'});
  cel.entradas.push({id:'conc-cel',casaId:'conc-casa',stake:1,odd:2,resultado:'PENDENTE'});
  const aposPC=conciliarTresVias(base,pc,base);
  const aposCel=conciliarTresVias(base,cel,aposPC);
  if(aposCel.entradas.length!==2||!aposCel.entradas.some(x=>x.id==='conc-pc')||!aposCel.entradas.some(x=>x.id==='conc-cel'))throw Error('Inclusões independentes não foram preservadas.');
  const antiga={...base,entradas:[{id:'conc-conflito',casaId:'conc-casa',stake:1,odd:2,resultado:'PENDENTE'}]};
  const editPC=structuredClone(antiga),editCel=structuredClone(antiga);
  editPC.entradas[0].resultado='RED';
  editCel.entradas[0].resultado='GREEN';
  let conflitoBloqueado=false;
  try{conciliarTresVias(antiga,editCel,conciliarTresVias(antiga,editPC,antiga));}
  catch(e){if(e.message.includes('Edição concorrente'))conflitoBloqueado=true;else throw e;}
  if(!conflitoBloqueado)throw Error('Conflito de edição não bloqueado.');
  const resultado={inclusoesPreservadas:2,conflitoBloqueado:true,metodo:'simulacao de duas bases desatualizadas; gravacao de relatorio isolado',testadoEm:new Date().toISOString()};
  tx.set(ref,{...d,testeConcorrencia:resultado,revisao:d.revisao+1,atualizadoEm:new Date().toISOString()});
  return {resultado,revisao:d.revisao+1};
 });
}

// Concorrência real entre aparelhos: cada aba captura sua própria base em memória.
// A transação lê o estado ATUAL do Firebase e concilia contra a base antiga capturada.
// Somente sync_lab/isolated_v1; nunca acessa state/current.
let baseConcorrenciaReal=null;
export async function capturarBaseConcorrenciaReal(){
 const uid=usuarioAtual().uid;
 const snap=await getDoc(laboratorioRef(uid));
 if(!snap.exists()||snap.data().tipo!=='arbitbet-sync-lab-v1'||!snap.data().homologacaoFinanceira)throw Error('Homologação financeira isolada não iniciada.');
 const d=snap.data(),estado=structuredClone(d.homologacaoFinanceira);
 validarEstado(estado);
 baseConcorrenciaReal={uid,estado,revisao:d.revisao};
 return {revisao:d.revisao,quantidade:estado.entradas.length};
}
export async function enviarConcorrenciaReal(origem){
 if(!['computador','celular'].includes(origem))throw Error('Origem inválida.');
 const uid=usuarioAtual().uid;
 const base=baseConcorrenciaReal;
 if(!base||base.uid!==uid)throw Error('Capture a base neste aparelho antes de enviar.');
 const local=structuredClone(base.estado);
 if(local.entradas.length>=12)throw Error('Limite de 12 apostas fictícias.');
 const id='conc-real-'+crypto.randomUUID();
 local.entradas.push({id,casaId:'hom-casa',resultado:'PENDENTE',stake:1,odd:2,origem,criadoEm:new Date().toISOString()});
 const ref=laboratorioRef(uid);
 const result=await runTransaction(db,async tx=>{
  const snap=await tx.get(ref);
  if(!snap.exists()||snap.data().tipo!=='arbitbet-sync-lab-v1')throw Error('Laboratório isolado ausente.');
  const d=snap.data(),cloud=d.homologacaoFinanceira;
  validarEstado(cloud);
  if(d.revisao<base.revisao)throw Error('Revisão do laboratório retrocedeu; operação bloqueada.');
  const merged=conciliarTresVias(base.estado,local,cloud);
  if(merged.entradas.length>12)throw Error('Limite de apostas fictícias excedido.');
  tx.set(ref,{...d,homologacaoFinanceira:merged,revisao:d.revisao+1,atualizadoEm:new Date().toISOString()});
  return {revisao:d.revisao+1,quantidade:merged.entradas.length,baseRevisao:base.revisao,baseDesatualizada:d.revisao!==base.revisao,origem};
 });
 baseConcorrenciaReal=null; // obriga nova captura; evita envios duplicados
 return result;
}

// Fila de eventos fictícios criados offline; nunca acessa o estado financeiro.
export async function enviarEventosLaboratorio(eventos){
 if(!Array.isArray(eventos)||!eventos.length||eventos.length>20)throw Error('Fila de laboratório inválida.');
 for(const e of eventos)if(typeof e.id!=='string'||!/^offline-[a-zA-Z0-9-]{8,80}$/.test(e.id)||!['celular','computador'].includes(e.origem))throw Error('Evento fictício inválido.');
 const ref=laboratorioRef(usuarioAtual().uid);
 return runTransaction(db,async tx=>{
  const snap=await tx.get(ref);
  if(!snap.exists()||snap.data().tipo!=='arbitbet-sync-lab-v1')throw Error('Laboratório não iniciado.');
  const old=snap.data(),map=new Map((old.eventos||[]).map(e=>[e.id,e]));
  for(const e of eventos)if(!map.has(e.id))map.set(e.id,{id:e.id,origem:e.origem,descricao:'Evento fictício offline',data:e.data});
  const lista=[...map.values()];
  if(lista.length===(old.eventos||[]).length)return {revisao:old.revisao,eventos:lista,semAlteracoes:true};
  const next={...old,revisao:old.revisao+1,eventos:lista,atualizadoEm:new Date().toISOString()};
  tx.set(ref,next);return next;
 });
}


// Primitiva de migração: ainda não conectada à interface.
// O chamador deve validar o conteúdo autorizado e confirmar backups antes de invocar.

// Shared migration checks, scoped to avoid collisions with sync helpers.
function conferirMigracaoFinanceira(base,candidato){
 const valid=s=>s&&Array.isArray(s.casas)&&Array.isArray(s.entradas)&&Array.isArray(s.movimentacoes);
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
 else if(e.resultado==='GREEN')p=e.retornoRecebido!=null&&e.retornoRecebido!==''&&Number.isFinite(Number(e.retornoRecebido))?cents(e.retornoRecebido)-stake:cents(Number(e.stake||0)*((Number(e.odd)||1)-1));
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

 validateMigrationContent(base,candidato);
 validateMigrationBalances(base,candidato);
}

export async function gravarMigracaoControlada({base, candidato, revisaoEsperada, uidEsperado, confirmado, backupsConfirmados}) {
  if(confirmado!==true||backupsConfirmados!==true)throw Error('Confirmação e backups obrigatórios.');
  if(revisaoEsperada!==47||typeof uidEsperado!=='string'||!uidEsperado)throw Error('Base ou conta inesperada.');
  const original=structuredClone(base), destino=structuredClone(candidato);
  const campos=['casas','entradas','movimentacoes'];
  const canon=x=>Array.isArray(x)?x.map(canon):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canon(x[k])])):x;
  const normalizar=s=>{
    validarEstado(s);
    return JSON.stringify(campos.map(k=>{
      const ids=new Set();
      for(const x of s[k]){
        if(!x||typeof x.id!=='string'||!x.id.trim()||ids.has(x.id))throw Error('ID inválido ou duplicado.');
        ids.add(x.id);
      }
      return [...s[k]].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).map(canon);
    }));
  };
  const originalCanon=normalizar(original), destinoCanon=normalizar(destino);
  const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
  if(await hash(originalCanon)!=='9c6bff5e8aecf09bbe354117a93ab952c4ed0e9e5a2f8e6b3723e4d159012aef'||await hash(destinoCanon)!=='aff7ef75d365b1e28b9f63c7c74eb30dd6621aff4d8afb1b0ac0894b91e9ceca')throw Error('Arquivo diferente da base ou do candidato autorizado.');
  conferirMigracaoFinanceira(original,destino);
  if(originalCanon===destinoCanon)throw Error('Migração sem alterações.');
  if(original.casas.length!==6||original.entradas.length!==48||original.movimentacoes.length!==12||destino.casas.length!==6||destino.entradas.length!==50||destino.movimentacoes.length!==11)throw Error('Contagens inesperadas.');
  const conferirConta=()=>{if(usuarioAtual().uid!==uidEsperado)throw Error('Conta alterada.');};
  conferirConta();
  const ref=pathFor(uidEsperado);
  const revisao=await runTransaction(db,async tx=>{
    conferirConta();
    const snap=await tx.get(ref);
    conferirConta();
    if(!snap.exists()||snap.data().revisao!==revisaoEsperada||normalizar(snap.data())!==originalCanon)throw Error('Base remota alterada. Migração bloqueada.');
    tx.update(ref,{revisao:revisaoEsperada+1,atualizadoEm:new Date().toISOString(),casas:destino.casas,entradas:destino.entradas,movimentacoes:destino.movimentacoes});
    return revisaoEsperada+1;
  });
  // Uma falha daqui em diante não significa que a transação foi revertida.
  try{
    conferirConta();
    const snap=await getDoc(ref);
    conferirConta();
    if(!snap.exists()||snap.data().revisao!==revisao||normalizar(snap.data())!==destinoCanon)throw Error('Estado posterior divergente.');
  }catch(e){throw Error('Gravação retornou revisão '+revisao+'; verificação posterior falhou. Consulte a nuvem antes de qualquer nova tentativa. '+e.message);}
  return {revisao,estado:destino};
}
