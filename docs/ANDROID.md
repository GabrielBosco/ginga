# Ginga para Android — teste da versão 0.2.0

A primeira versão Android é um cliente nativo leve que abre a interface responsiva do seu próprio servidor Ginga em um `WebView` controlado pelo aplicativo.

Esta etapa serve para validar a experiência mobile sem manter duas interfaces completamente separadas.

## O que funciona nesta fase

- login e cadastro;
- chats e anexos;
- navegação por servidores e canais;
- seleção de arquivos;
- microfone e câmera mediante permissão do Android;
- WebRTC;
- chamadas e salas de voz usando as mesmas rotas HTTPS/WSS do navegador.

O aplicativo exige **HTTPS** para servidores externos e bloqueia tráfego HTTP sem criptografia.

## Gerar pelo GitHub Actions

1. Abra a aba **Actions** do repositório.
2. Escolha **Gerar APK Android**.
3. Clique em **Run workflow / Executar fluxo de trabalho** — o texto do botão é controlado pela interface do próprio GitHub.
4. Informe a URL pública HTTPS do seu Ginga, sem caminho adicional.
5. Ao terminar, baixe o artefato `Ginga-0.2.0-Android-debug`.

O APK gerado é de desenvolvimento/teste. Para distribuição pública ou Play Store, configure uma `keystore` de produção e assinatura própria.

## Gerar localmente

Com Android SDK e Gradle instalados:

```bash
./scripts/build-android.sh https://ginga.exemplo.com
```

Saída:

```text
dist/android/Ginga-0.2.0-debug.apk
```

## Push-to-Talk no celular

No Android, o modelo recomendado é um botão na tela do tipo **Segure para falar**, em vez de atalho global de teclado ou mouse.

O atalho global continua sendo um recurso do cliente Desktop. O cliente Android pode evoluir depois para incluir:

- Segure para falar;
- ativação por voz;
- escolha de saída entre alto-falante, telefone e Bluetooth;
- chamada em segundo plano;
- notificação persistente durante chamadas.
