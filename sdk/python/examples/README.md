# Exemplos do Ginga Bot SDK

Instale o SDK:

```bash
python -m pip install -U ginga-bot
```

Configure:

```text
GINGA_SERVER=https://seu-servidor-ginga.exemplo
GINGA_BOT_TOKEN=seu_token
```

Arquivos:

- `basic_bot.py`: conexao, `on_ready`, `!ping` e tratamento de erro;
- `commands.py`: argumentos tipados, texto restante e IDs do contexto.

Antes de executar comandos por mensagem, habilite `MESSAGE_CONTENT` no codigo e **Conteudo de mensagens** no Portal Developer.
