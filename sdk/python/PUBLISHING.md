# Publicacao do `ginga-bot` no PyPI

Este documento e destinado aos mantenedores do SDK.

- pacote: `ginga-bot`
- modulo: `gingabot`
- workflow: `.github/workflows/python-sdk-publish.yml`
- autenticacao: PyPI Trusted Publishing (OIDC)

## Regra principal

Versoes publicadas no PyPI sao imutaveis.

Depois que `ginga-bot 0.1.0` foi publicado, nao e possivel sobrescrever:

```text
ginga_bot-0.1.0-py3-none-any.whl
ginga_bot-0.1.0.tar.gz
```

Qualquer alteracao no codigo do SDK exige nova versao, por exemplo `0.1.1`.

## Trusted Publishing

No PyPI, o projeto deve confiar no GitHub Actions deste repositorio usando:

```text
Workflow: python-sdk-publish.yml
Environment: pypi
```

Nao armazene usuario, senha ou API token do PyPI no GitHub.

## Preparar uma nova versao

Exemplo para `0.1.1`:

1. altere `sdk/python/pyproject.toml`;
2. altere `sdk/python/gingabot/version.py`;
3. atualize o changelog/documentacao;
4. rode os testes;
5. gere o pacote localmente;
6. faca commit;
7. crie a tag `sdk-python-v0.1.1`.

Confira as duas versoes:

```bash
grep '^version' sdk/python/pyproject.toml
cat sdk/python/gingabot/version.py
```

## Validar localmente

```bash
cd sdk/python
python -m pip install -U build twine
python -m unittest discover -s tests -v
rm -rf dist build *.egg-info
python -m build
python -m twine check dist/*
```

Confira o conteudo do wheel:

```bash
python -m zipfile -l dist/*.whl
```

O namespace publicado deve ser `gingabot`.

## Publicar

A tag deve corresponder exatamente a versao do `pyproject.toml`:

```bash
git tag -a sdk-python-v0.1.1 -m "Ginga Bot SDK 0.1.1"
git push origin sdk-python-v0.1.1
```

O workflow:

1. valida a versao da tag;
2. gera wheel e source distribution;
3. executa `twine check`;
4. salva o artefato;
5. autentica no PyPI por OIDC;
6. publica usando Trusted Publishing.

O job de publicacao usa `skip-existing: true` para que um rerun de uma tag ja publicada nao termine em erro apenas porque os mesmos arquivos ja existem no PyPI. Isso nao permite sobrescrever releases: arquivos existentes continuam imutaveis.

## Validar depois da publicacao

Use um ambiente limpo:

```bash
python -m venv .venv-pypi-test
source .venv-pypi-test/bin/activate
python -m pip install --upgrade pip
python -m pip install --no-cache-dir --index-url https://pypi.org/simple ginga-bot==0.1.1
python -c "import gingabot; print(gingabot.__version__)"
```

No Windows PowerShell:

```powershell
python -m venv .venv-pypi-test
.\.venv-pypi-test\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install --no-cache-dir --index-url https://pypi.org/simple ginga-bot==0.1.1
python -c "import gingabot; print(gingabot.__version__)"
```

## Erro `File already exists`

Se o PyPI responder algo como:

```text
400 File already exists ('ginga_bot-X.Y.Z-py3-none-any.whl')
```

significa que aquela distribuicao ja foi publicada. Nao tente apagar/recriar o mesmo release para substituir arquivos.

Se a versao publicada esta correta, nao ha nada para corrigir no pacote. Se existe codigo novo, incremente a versao.

## Versao do servidor x versao do SDK

Sao ciclos independentes:

```text
Ginga Server/Desktop: 0.3.1
Ginga Bot SDK:        0.1.1
```

Uma atualizacao de documentacao do servidor nao obriga um novo SDK. Uma alteracao no codigo publicado do SDK obriga uma nova versao do pacote Python.
