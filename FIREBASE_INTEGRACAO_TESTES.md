# Arbitbet V2 — integração Firebase (somente testes)

Branch isolada: `feature/firebase-sync-testes`. Não realizar merge em `main` ou alterar produção sem autorização explícita.

## Proteção de dados
- O estado legado é mantido no `localStorage` até importação validada.
- Nunca substituir uma coleção remota não vazia por dados locais vazios.
- Nunca importar automaticamente dados demonstrativos; importação exige seleção explícita de backup real e confirmação de contagens.
- Preservar IDs originais e datas de casas, entradas e movimentações.
- Antes de importar: prévia com quantidades, saldos e P&L; criar snapshot recuperável.
- Não registrar senhas, tokens ou dados financeiros em logs públicos.

## Estrutura proposta
`users/{uid}/state/current` contém `casas`, `entradas`, `movimentacoes`, `schemaVersion`, `updatedAt`. Apenas o usuário autenticado pode ler e escrever seu documento.

## Etapas
1. Conferir configuração Firebase Web App e regras Firestore.
2. Integrar Firebase Auth (e-mail/senha) e persistência Firestore na branch de testes.
3. Adicionar importação de backup em modo prévia, sem gravação automática.
4. Testar em Preview com dados fictícios, incluindo sincronização PC/celular e restauração.
5. Somente depois validar backup real e solicitar autorização para eventual promoção à produção.

## Regras de segurança sugeridas (revisar antes de publicar)
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```
