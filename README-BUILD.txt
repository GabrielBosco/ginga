GINGA DESKTOP BUILD 0.4.3 RC9

Aplicacao segura:
  cd /caminho/Ginga-v0.4.3-RC9-LINUX-BUILD-FIX-source
  ./scripts/apply-update-safe.sh "$PWD"

Linux x64:
  cd /opt/ginga-build
  ./scripts/pre-release-check.sh 0.4.3 --linux
  ./release-linux.sh 0.4.3 --x64

Linux x64 + ARM64:
  cd /opt/ginga-build
  ./scripts/pre-release-check.sh 0.4.3 --linux
  ./release-linux.sh 0.4.3 --all

Windows:
  cd /opt/ginga-build
  ./scripts/pre-release-check.sh 0.4.3 --windows
  ./release-win.sh 0.4.3

Preserve /opt/ginga-build/secrets/update-signing/private.pem. Nao use --init-key numa cadeia ja publicada.
