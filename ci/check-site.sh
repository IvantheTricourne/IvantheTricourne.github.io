#!/usr/bin/env bash
#
# Assert invariants on a built Jekyll site.
#
# Every check here corresponds to something that actually shipped broken,
# because until now the only build of the production artifact ran *after*
# merge. Run via `make check`.
#
# Usage: ci/check-site.sh [site_dir]   (default: _site)

set -uo pipefail

SITE="${1:-_site}"
CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXPECTED_URLS="$CI_DIR/expected-urls.txt"
FORBIDDEN_URLS="$CI_DIR/forbidden-urls.txt"
EXPECTED_DOMAIN="ivanthetricourne.io"

fails=0
ok()   { printf 'ok    %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; fails=$((fails + 1)); }

# Pull <loc> values out of a sitemap, one per line, deterministically ordered.
# LC_ALL=C stops macOS and Linux from disagreeing about sort order, which would
# otherwise show up as a phantom manifest diff between a laptop and CI.
sitemap_urls() {
  grep -o '<loc>[^<]*</loc>' "$1" \
    | sed -e 's|<loc>||' -e 's|</loc>||' \
    | LC_ALL=C sort
}

if [ ! -d "$SITE" ]; then
  echo "FAIL  no build output at $SITE/ — run 'make build' first" >&2
  exit 1
fi

echo "Checking $SITE/"

# --- custom domain -----------------------------------------------------------
# GitHub Pages reads the custom domain from the built output, so a CNAME that
# doesn't survive the build takes ivanthetricourne.io down with it.
if [ -f "$SITE/CNAME" ]; then
  domain="$(tr -d '[:space:]' < "$SITE/CNAME")"
  if [ "$domain" = "$EXPECTED_DOMAIN" ]; then
    ok "CNAME is $domain"
  else
    fail "CNAME is '$domain', expected '$EXPECTED_DOMAIN'"
  fi
else
  fail "CNAME missing from build output — the custom domain would break"
fi

# --- plugin output -----------------------------------------------------------
# jekyll-sitemap and jekyll-feed generated nothing at all for years: they were
# listed under Jekyll's removed `gems:` key instead of `plugins:`, so they were
# silently ignored and the build still reported success. A green build that
# produces neither file is precisely that failure mode.
if [ -s "$SITE/sitemap.xml" ]; then
  url_count="$(sitemap_urls "$SITE/sitemap.xml" | wc -l | tr -d ' ')"
  if [ "$url_count" -gt 0 ]; then
    ok "sitemap.xml lists $url_count URLs"
  else
    fail "sitemap.xml exists but lists no URLs"
  fi
else
  fail "sitemap.xml missing or empty — is jekyll-sitemap loading?"
fi

if [ -s "$SITE/feed.xml" ]; then
  entries="$(grep -c '<entry>' "$SITE/feed.xml" | tr -d ' ')"
  if [ "$entries" -gt 0 ]; then
    ok "feed.xml has $entries entries"
  else
    fail "feed.xml exists but contains no entries"
  fi
else
  fail "feed.xml missing or empty — is jekyll-feed loading?"
fi

if [ -s "$SITE/index.html" ]; then
  ok "index.html rendered"
else
  fail "index.html missing or empty"
fi

# --- URLs that must never be published ---------------------------------------
if [ -f "$SITE/sitemap.xml" ] && [ -f "$FORBIDDEN_URLS" ]; then
  matched=""
  while IFS= read -r pattern || [ -n "$pattern" ]; do
    case "$pattern" in ''|'#'*) continue ;; esac
    hits="$(sitemap_urls "$SITE/sitemap.xml" | grep -F -- "$pattern")"
    [ -n "$hits" ] && matched="${matched}${hits}"$'\n'
  done < "$FORBIDDEN_URLS"
  if [ -n "$matched" ]; then
    fail "sitemap advertises forbidden URLs:"
    printf '%s' "$matched" | sed 's/^/        /'
  else
    ok "no forbidden URLs in sitemap"
  fi
fi

# --- the published URL surface -----------------------------------------------
# This is the check that makes agent work reviewable: any page added to or
# removed from the public site turns into a diff line on the PR, instead of
# being discovered in production afterwards.
if [ -f "$SITE/sitemap.xml" ]; then
  if [ -f "$EXPECTED_URLS" ]; then
    actual="$(mktemp)"
    trap 'rm -f "$actual"' EXIT
    sitemap_urls "$SITE/sitemap.xml" > "$actual"
    if diff -u "$EXPECTED_URLS" "$actual" > /dev/null 2>&1; then
      ok "published URLs match ci/expected-urls.txt"
    else
      fail "published URL set changed (- expected, + built):"
      diff -u "$EXPECTED_URLS" "$actual" | tail -n +3 | sed 's/^/        /'
      echo "        If the change is intended, run 'make update-urls' and commit the result."
    fi
  else
    fail "ci/expected-urls.txt missing — run 'make update-urls'"
  fi
fi

echo
if [ "$fails" -gt 0 ]; then
  echo "$fails check(s) failed"
  exit 1
fi
echo "all checks passed"
