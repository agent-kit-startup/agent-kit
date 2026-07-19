---
name: cursor-skills-python
description: CURSOR-SKILLS rules for Python (Django, Flask, FastAPI, Data Science). PEP, venv, tests.
version: 0.1.0
category: language
---

# CURSOR-SKILLS - Python

Source: [cursor-skills/python](https://github.com/araguaci/cursor-skills/tree/main/python)

## CURSOR setup

- Python, Pylance, Python Debugger, Docstring Generator, Python Indent, Test Explorer, Jupyter (if applicable).

## Typical structure

```
project/
├── src/   ├── tests/   ├── docs/
├── requirements.txt   ├── requirements-dev.txt   ├── pyproject.toml   └── .env
```

## Required standards

- **PEP**: 8 (style), 257 (docstrings), 484 (type hints), 526 (annotations).
- **Environment**: always venv or conda; `requirements.txt`; pip-tools; separate dev deps.
- **Tools**: Black, isort, flake8, mypy, pytest.

## By framework

- **Django**: MVT, ORM, admin, forms; `python.formatting.provider: "black"`.
- **Flask**: blueprints, app factory; flake8, Black.
- **FastAPI**: DI, Pydantic, OpenAPI; async; Pylint, Black.

## Data Science

- Jupyter: clear cells, validation, versioning, clean before sharing.
- Pandas, NumPy, matplotlib/seaborn; scikit-learn; model validation and documentation.

## Code and documentation

- Docstrings and type hints on functions/classes; comments on complex logic; README and API docs.

## Security and DB

- Validate inputs; OWASP; hashing; HTTPS. ORM (Django/SQLAlchemy); avoid N+1; transactions.
