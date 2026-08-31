# Ginga 0.4.3 RC9 - Linux build fix

## Causa do erro

O `electron-builder` 26.15.3 recusava o objeto `build.linux` porque `packageName` foi colocado nesse bloco.
Nessa versao, `packageName` e uma opcao especifica dos empacotadores Linux baseados em pacote (DEB/RPM), e nao uma propriedade de `LinuxConfiguration`.

O erro exibido pelo validador era pouco descritivo:

```text
configuration.linux should be one of these:
  null
```

## Correcao

- removido `build.linux.packageName`;
- adicionado `build.deb.packageName = "ginga"`;
- adicionado `build.rpm.packageName = "ginga"`;
- reforcado `scripts/pre-release-check.sh` para detectar essa regressao antes de iniciar o build;
- mantidos AppImage + DEB + RPM para x64 e AppImage + DEB para ARM64;
- mantida a release em Ginga 0.4.3 RC9;
- removidos artefatos de feeds publicados de `updates/windows` do source clean; o `apply-update-safe.sh` ja preserva o feed ativo no servidor.

## Preflight e build Linux

```bash
cd /opt/ginga-build
./scripts/pre-release-check.sh 0.4.3 --linux
./build-linux.sh x64
```

Release Linux x64:

```bash
./release-linux.sh 0.4.3 --x64
```

x64 + ARM64:

```bash
./release-linux.sh 0.4.3 --all
```

Observacao: se `/opt/ginga/updates/windows/manifest.json` ja publicar 0.4.4, use `pre-release-check.sh 0.4.3 --linux` para validar a distribuicao Linux. O modo `--windows`/`--all` continuara recusando 0.4.3 para impedir downgrade do feed Windows.
