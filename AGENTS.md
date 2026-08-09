# AGENTS.md

Context for working in this repo: Carl's personal blog + portfolio site.

## What this is

A Jekyll static site (based on the old "Jekyll Now" template) hosted on GitHub
Pages, served at the custom domain `ivanthetricourne.io` (set by the root
`CNAME` file), with `ivanthetricourne.github.io` redirecting to it. Deploys
automatically via `.github/workflows/pages.yml` on push to `main`.

The site used to deploy through GitHub's built-in `pages-build-deployment`
flow, which ignored the `Gemfile` and built with the `github-pages` gem's
pinned Jekyll 3.10 while local development ran Jekyll 4.4.1. Local
verification and production could therefore disagree, and did. Building
through Actions means local, CI and production all resolve the same
`Gemfile.lock`. Don't reintroduce the legacy flow.

`ivanthetricourne.io` used to be a separate IPFS deployment on Fleek, wired up
through the Fleek GitHub App rather than any config in this repo. That site was
lost when Fleek dropped its free tier — its last build was cancelled on
2025-08-21, after which the domain served bunny.net's "Domain suspended or not
configured" page until the DNS was repointed at GitHub Pages. There is no
longer an IPFS mirror; don't reintroduce references to one.

## Structure

- `_posts/` — blog posts, one file per post, named `YYYY-MM-DD-title.md`
- `_layouts/` — `default.html` (site chrome/nav), `page.html`, `post.html`
- `_includes/` — partials (analytics, disqus, meta, footer icons)
- `_sass/`, `style.scss` — styling
- `about.md`, `projects.md`, `learn.md`, `index.html` — top-level static pages
- `images/` — post and page images
- `_config.yml` — Jekyll config (site name/description, nav footer links, gems)
- `_data/resume.yml` — resume content, source of truth (see Editing content below)
- `resume.html`, `resume.css`, `fonts/` — live `/resume/` page rendered from
  `_data/resume.yml`, styled with a self-hosted Spectral webfont. `resume.css`
  doubles as the print stylesheet (`@page` sizing, letter margins) so the
  page's "Download PDF" button (`window.print()`) produces a clean PDF
  without any separate build step or committed binary.

Several standalone mini projects/demos live in their own top-level
directories and are linked from the site rather than built through Jekyll:
`Name-Tag-Generator`, `set-count-app`, `fp`, `random-gifs`, `project-arwing`.
Treat each as its own self-contained app — don't assume shared tooling with
the Jekyll site.

## Build & run

```sh
make install      # bundle install
make serve        # local preview
make build        # production build into _site/
make check        # build, then assert invariants — run this before pushing
make update-urls  # regenerate ci/expected-urls.txt after an intended page change
```

`make check` is what CI runs. Use it rather than eyeballing a local build.

Dependencies are pinned via `Gemfile`/`Gemfile.lock`, locked for both
`x86_64-darwin` and `x86_64-linux`. The Linux platform is required by the
CI and Pages workflows, so don't drop it from the lockfile.

An older note here said the Linux platform existed for Netlify's build image,
that Netlify's dashboard build command was `bundle exec jekyll build`, and
that removing the `Gemfile` would break its deploy previews. Whether a Netlify
site is still connected to this repo hasn't been confirmed — there is no
Netlify config in the repo, so it could only be wired up dashboard-side.
Treat the "don't remove the `Gemfile`" advice as still good regardless; the
CI and Pages workflows now depend on it too.

Known toolchain issues:

- **SCSS conversion fails on macOS 13 (Ventura) and earlier**, because newer
  `sass-embedded` native binaries require macOS 14+. Fixed by pinning
  `gem "sass-embedded", "1.77.8"` in the `Gemfile` (see the pin's comment).
  Genuinely macOS-only.
- **`Encoding::UndefinedConversionError` in `Jekyll::Cleaner`** on the accented
  filenames under `project-arwing/rsrc/` (e.g. `Poké Floats.png`). This is
  *not* macOS-only — it hits any machine whose Ruby default external encoding
  isn't UTF-8, which includes Linux CI images and remote agent containers.
  Ruby takes that encoding from the locale, and most Linux images generate
  only `C.utf8`, so the `LANG=en_US.UTF-8` workaround silently leaves Ruby on
  `US-ASCII` and the build still crashes. The fix is `RUBYOPT=-EUTF-8`, which
  sets the encoding directly and doesn't care which locales exist. The
  `Makefile` exports it, so anything run through `make` is already covered;
  only a bare `bundle exec jekyll ...` needs it passed by hand.

## CI checks

`.github/workflows/ci.yml` runs `make check` on every PR and uploads the built
`_site` as an artifact. `.github/workflows/pages.yml` runs the same checks on
`main` before deploying, so a build that fails them never ships.

`ci/check-site.sh` asserts:

- `CNAME` survives the build and still reads `ivanthetricourne.io` — GitHub
  Pages reads the custom domain from the built output, so losing it takes the
  site down.
- `sitemap.xml` and `feed.xml` exist and are non-empty. Both silently produced
  nothing for years because the plugins were listed under Jekyll's removed
  `gems:` key instead of `plugins:` — the build reported success the whole
  time. That's the failure this check exists to catch.
- No URL matching `ci/forbidden-urls.txt` appears in the sitemap.
- The sitemap's URL list matches `ci/expected-urls.txt` exactly.

That last one is the important one for agent work: **any page added to or
removed from the published site shows up as a diff line on the PR** rather
than being discovered in production. If a change is *supposed* to change the
published surface, run `make update-urls` and commit the regenerated manifest
in the same commit — the diff is the reviewable record of what changed.

Don't work around a failing check by regenerating the manifest without
reading the diff first.

## Git workflow

`main` has branch protection requiring PRs — direct pushes are only possible
via an explicit bypass. Default to feature branches + PRs unless told
otherwise.

Consider making the CI workflow a required status check on `main`, so the
checks gate merges rather than merely reporting.

## Editing content

- New posts: add a markdown file to `_posts/` following the existing
  front matter style (see recent posts for the pattern).
- Resume: edit `_data/resume.yml` — `/resume/` picks it up automatically.
  Don't hand-edit `resume.html`, it's a Jekyll template driven by the same
  YAML, not standalone content. The page's "Download PDF" button uses
  `window.print()`, so there's no separate PDF build step to run. Draft/
  unfinished bullets are kept as commented-out YAML under the relevant
  entry rather than left as placeholder text in `highlights`.
