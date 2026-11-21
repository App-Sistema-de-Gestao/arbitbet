// Arbitbet V2 — infraestrutura isolada para testes. Não é carregada pela produção.
// Não contém credenciais, não executa login ou gravação automaticamente.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
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
