# Cliente Desktop

O cliente Desktop é baseado em Electron e se conecta a uma instalação Ginga existente.

## Compilar para Windows

O caminho mais simples em Linux é usar o ambiente de compilação preparado pelo projeto:

```bash
./build-win.sh
```

Saída esperada:

```text
apps/desktop/dist/Ginga-Setup-0.3.1-x64.exe
```

## Servidor padrão

`apps/desktop/config.json` contém apenas um endereço alternativo de desenvolvimento. Durante uma publicação, o pipeline ajusta o endereço para a instalação desejada.

Nunca publique um instalador apontando para IP privado, hostname interno ou servidor de testes.

## Atualizador

Os arquivos públicos de atualização ficam em:

```text
/updates/windows/
```

A cadeia de atualização usa uma chave Ed25519 própria. A chave privada fica em:

```text
secrets/update-signing/private.pem
```

Ela é ignorada pelo Git e precisa de backup seguro. Depois que usuários recebem um cliente assinado por essa chave, substituí-la quebra a confiança da cadeia de atualização existente.

## Recursos nativos

- presença de jogos;
- sobreposição durante jogos;
- Push-to-Talk com atalhos de teclado ou mouse;
- integração com a bandeja do sistema;
- seleção de tela ou janela para compartilhamento;
- atualização automática assinada.

## Desenvolvimento local

HTTP pode ser usado em `localhost` ou em ambientes isolados de teste. Para uma instalação pública, use HTTPS/WSS.
