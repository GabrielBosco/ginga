# Cliente Ginga para Linux

## Formatos da 0.4.5

| Arquitetura | AppImage | Debian/Ubuntu/Mint | Fedora/RHEL/openSUSE |
|---|---|---|---|
| x64 | Sim | `.deb` | `.rpm` |
| ARM64 | Sim | `.deb` | não nesta release |

## Pré-requisitos do host de build

O pipeline usa Docker, então o host não precisa instalar Electron globalmente. São necessários:

- Docker;
- Python 3 para gerar manifests;
- espaço para a imagem do builder e artefatos.

## Build local

```bash
cd /opt/ginga-build
./build-linux.sh x64
```

Ou ARM64:

```bash
./build-linux.sh arm64
```

Artefatos temporários ficam em:

```text
apps/desktop/dist/
```

## Gate Linux

```bash
./scripts/pre-release-check.sh 0.4.5 --linux
```

## Publicar no site

x64:

```bash
./release-linux.sh 0.4.5 --x64
```

x64 + ARM64:

```bash
./release-linux.sh 0.4.5 --all
```

O script copia os pacotes para `updates/linux/<arch>/` e cria `manifest.json` + `SHA256SUMS.txt`.

## AppImage

```bash
chmod +x Ginga-0.4.5-linux-x64.AppImage
./Ginga-0.4.5-linux-x64.AppImage
```

## DEB

```bash
sudo apt install ./Ginga-0.4.5-linux-x64.deb
```

## RPM

```bash
sudo dnf install ./Ginga-0.4.5-linux-x64.rpm
```

## Nota do electron-builder

Na versão usada pelo projeto, `packageName` deve permanecer em `build.deb` e `build.rpm`. Colocá-lo em `build.linux` quebra a validação do schema. `scripts/prepare-github.sh` possui um guardrail específico para isso.
