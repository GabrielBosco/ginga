# Cliente Desktop

Versão atual: `0.4.8`.

O Desktop fica em `apps/desktop` e usa Electron.

## URL do servidor

O source público contém apenas um fallback local em `apps/desktop/config.json`.

O pipeline oficial de Windows substitui a URL antes do build usando:

- `GINGA_PUBLIC_URL`; ou
- `GINGA_SERVER_URL` do `/opt/ginga/.env`.

Assim, a URL de uma instalação específica não precisa ficar hardcoded no GitHub.

## Windows

```bash
./build-win.sh
```

Release oficial:

```bash
./release-win.sh 0.4.8
```

A cadeia de updater utiliza chave pública no cliente e chave privada fora do Git:

```text
apps/desktop/update-public.pem        pode ser versionada
secrets/update-signing/private.pem    NUNCA versionar
```

Não use `--init-key` em uma cadeia de updater que já tenha clientes publicados.

## Linux

Build x64:

```bash
./build-linux.sh x64
```

Publicação x64:

```bash
./release-linux.sh 0.4.8 --x64
```

Publicação x64 + ARM64:

```bash
./release-linux.sh 0.4.8 --all
```

O `electron-builder 26.15.3` usado pelo projeto exige `packageName` nos blocos `build.deb` e `build.rpm`, não em `build.linux`. O gate `scripts/prepare-github.sh` verifica essa regressão.
