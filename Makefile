# Ruby takes its default external encoding from the locale, and Jekyll's cleaner
# dies with Encoding::UndefinedConversionError on the accented filenames under
# project-arwing/rsrc (e.g. "Poké Floats.png") when that encoding isn't UTF-8.
#
# RUBYOPT is used here rather than LANG/LC_ALL because it doesn't depend on
# which locales the machine happens to have generated. Most Linux CI images and
# agent containers ship only C.utf8, so setting LANG=en_US.UTF-8 there leaves
# Ruby silently on US-ASCII and the build still crashes.
export RUBYOPT := -EUTF-8

# GitHub Pages builds with JEKYLL_ENV=production; match it so `make check`
# exercises the same artifact that gets deployed.
JEKYLL_ENV ?= production

JEKYLL := bundle exec jekyll

.PHONY: install build serve check update-urls clean

install:
	bundle install

build: install
	JEKYLL_ENV=$(JEKYLL_ENV) $(JEKYLL) build

# Local preview. Left on Jekyll's default development environment.
serve: install
	$(JEKYLL) serve

# Build, then assert the invariants CI enforces. Run this before pushing.
check: build
	bash ci/check-site.sh _site

# Regenerate the published-URL manifest. Run this when a change is *meant* to
# add or remove pages, and commit the result alongside it.
update-urls: build
	grep -o '<loc>[^<]*</loc>' _site/sitemap.xml \
	  | sed -e 's|<loc>||' -e 's|</loc>||' \
	  | LC_ALL=C sort > ci/expected-urls.txt
	@echo "Wrote ci/expected-urls.txt ($$(wc -l < ci/expected-urls.txt | tr -d ' ') URLs)"

# Note: deliberately does not touch .sass-cache. Those files are gitignored but
# also tracked (committed before the ignore rule), so removing them would show
# up as deletions in `git status`.
clean:
	rm -rf _site .jekyll-cache
