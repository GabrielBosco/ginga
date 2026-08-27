# Publicando `ginga-bot` no PyPI

O nome do pacote de distribuicao e `ginga-bot`. O modulo importado pelo usuario e `gingabot`.

## Antes da primeira publicacao

1. Crie ou reivindique o projeto `ginga-bot` no PyPI.
2. Configure **Trusted Publishing** apontando para este repositorio GitHub.
3. Use o workflow `.github/workflows/python-sdk-publish.yml` e o environment `pypi`.
4. Nao salve token ou senha do PyPI no repositorio.

O nome estava sem pagina de projeto no PyPI quando o SDK foi preparado, mas disponibilidade nao e reserva: registre o projeto antes de anunciar publicamente o comando de instalacao.

## Validar localmente

```bash
cd sdk/python
python -m pip install -U build twine
python -m build
python -m twine check dist/*
```

## Publicar

O workflow e acionado por tag no formato:

```text
sdk-python-v0.1.0
```

Exemplo:

```bash
git tag -a sdk-python-v0.1.0 -m "Ginga Bot SDK 0.1.0"
git push origin sdk-python-v0.1.0
```

A tag do SDK e independente da tag do servidor Ginga.
