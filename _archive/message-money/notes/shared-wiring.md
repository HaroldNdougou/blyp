# Recâblage Message Money (référence)

## Navigation
- `app/(tabs)/_layout.tsx` — `<Tabs.Screen name="messages" …>`
- `app/_layout.tsx` — `<Stack.Screen name="chat/[id]" …>`

## Client API (à remettre dans `lib/api/`)
Exports : `listConversations`, `openConversation`, `listMessages`, `sendTextMessage`, `sendMoneyMessage`, `claimMoneyTransfer`  
Types : `MoneyTransferStatus`, `MoneyTransfer`, `ChatMessage`, `Conversation`  
Mock : fonctions `mockList*` / `mockSend*` / `mockClaim*` (voir historique git si besoin)

## Auth
- `clearAllMessagesSnapshots()` depuis `lib/messagesCache` au logout / session invalidée

## i18n
Section `messages: { … }` dans `lib/i18n/locales/fr.ts` et `en.ts` (voir git history du commit d’archive)

## Thème
Tokens : `bubbleMine`, `bubbleTheirs`, `bubbleMineText`, `bubbleTheirsText`, `moneyBubbleBackground`, `moneyBubbleBorder`, `moneyAmountSent`, `moneyAmountPending`, `moneyAmountClaimed`, `moneyAmountExpired`

## Format
```ts
export function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(currentNumberLocale(), {
    hour: "2-digit",
    minute: "2-digit",
  });
}
```

## AWS déployé
Après retrait du template, un `sam deploy` retire la Lambda `blyp-messaging-*` et les routes API.  
Sans deploy, les routes cloud peuvent encore répondre jusqu’à la prochaine mise à jour de stack.
