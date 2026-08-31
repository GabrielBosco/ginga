# Ginga 0.4.3 RC8 R1 — Build Fix

Corrige a regressao de build introduzida ao tornar a barra de formatacao contextual.

## Correcao

Foram restaurados os estados React ausentes em:

- `ChatView.tsx`
- `DirectChat.tsx`

Estado adicionado:

```ts
const [composerFocused, setComposerFocused] = useState(false);
```

A barra de formatacao permanece escondida por padrao e aparece apenas quando o composer recebe foco.
