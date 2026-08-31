# Ginga no Android (teste 0.2.0)

A primeira versao Android e um shell nativo leve que abre a interface web responsiva do seu proprio servidor Ginga em um `WebView` seguro.

## O que funciona nesta fase

- login e cadastro;
- chats e anexos;
- navegacao por servidores e canais;
- microfone, camera e WebRTC mediante permissao do Android;
- selecao de arquivos;
- chamadas e salas de voz dependem das mesmas rotas HTTPS/WSS usadas pelo navegador.

A aplicacao exige HTTPS e bloqueia cleartext HTTP.

## Gerar pelo GitHub Actions

1. Abra **Actions** no repositorio.
2. Escolha **Android APK**.
3. Clique **Run workflow**.
4. Informe a URL publica HTTPS do seu Ginga, sem caminho adicional.
5. Ao terminar, baixe o artefato `Ginga-0.2.0-Android-debug`.

O APK resultante e de teste/debug. Para Play Store ou distribuicao publica, configure uma keystore de release e assinatura propria.

## Gerar localmente

Com Android SDK e Gradle instalados:

```bash
./scripts/build-android.sh https://ginga.exemplo.com
```

Saida:

```text
dist/android/Ginga-0.2.0-debug.apk
```

## Observacao sobre Push-to-Talk

No Android, um botao de PTT na tela e mais apropriado do que bind global de teclado/mouse. O bind global continua sendo um recurso do Desktop. Uma implementacao mobile dedicada pode ser adicionada depois.
