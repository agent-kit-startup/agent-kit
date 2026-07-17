#!/usr/bin/env sh
# Detecta padrões de secrets em arquivos staged. Bloqueia commit se encontrar.
# Uso: chamado por pre-commit; ou check-secrets.sh [file ...]
# Exit: 0 ok, 1 secret detectado, 2 uso

set -e

# Arquivos a verificar: argumentos ou staged
if [ $# -gt 0 ]; then
  files="$*"
else
  files=$(git diff --cached --name-only 2>/dev/null || true)
fi

if [ -z "$files" ]; then
  exit 0
fi

found=0
for f in $files; do
  [ -f "$f" ] || continue
  case "$f" in
    *.json|*.js|*.ts|*.env)
      # Padrões: chave sensível com valor longo (possível secret)
      if grep -E '"(password|apiKey|api_key|secret|token|auth)"\s*:\s*"[^"]{12,}"' "$f" 2>/dev/null; then
        echo "Possível secret em: $f"
        found=1
      fi
      ;;
  esac
done

if [ $found -eq 1 ]; then
  echo "Remova secrets antes de commitar. Use variáveis de ambiente ou Credentials."
  exit 1
fi
exit 0
