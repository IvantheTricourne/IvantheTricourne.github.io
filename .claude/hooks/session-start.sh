#!/bin/bash
#
# Prepare a Claude Code on the web container to build this site.
#
# Two things bite a fresh remote container that don't bite a local checkout:
#
#   1. `bundle install` writes gem binstubs to Gem.bindir, which isn't on PATH
#      in these images. `bundle exec jekyll` then reports
#      "command not found: jekyll" even though the install just succeeded.
#
#   2. Ruby takes its default external encoding from the locale. These images
#      generate only C.utf8, so the LANG=en_US.UTF-8 workaround that works on
#      macOS leaves Ruby on US-ASCII here and Jekyll's cleaner dies on the
#      accented filenames under project-arwing/rsrc. RUBYOPT sets the encoding
#      directly, independent of which locales exist.

set -euo pipefail

# Local sessions already have a working toolchain; nothing to fix up there.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

bundle install

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  gem_bin="$(ruby -e 'print Gem.bindir')"
  {
    echo "export PATH=\"${gem_bin}:\$PATH\""
    echo 'export RUBYOPT="-EUTF-8"'
  } >> "$CLAUDE_ENV_FILE"
fi
