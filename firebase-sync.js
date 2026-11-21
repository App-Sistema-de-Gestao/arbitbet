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
