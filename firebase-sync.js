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
