# AGENTS.md

Context for working in this repo: Carl's personal blog + portfolio site.

## What this is

A [Hakyll](https://jaspervdj.be/hakyll/) static site hosted on GitHub Pages,
served at the custom domain `ivanthetricourne.io` (set by the root `CNAME`
file), with `ivanthetricourne.github.io` redirecting to it.

It was a Jekyll site (based on the old "Jekyll Now" template) until the port
to Hakyll. The port kept every published URL identical, so the permalink
scheme, the pagination paths and the mixed-case post slug in
`/2017/02/On-a-tues.html` are all load-bearing — don't "tidy" them.

Deploys run through `.github/workflows/build-and-deploy.yml`: GitHub Pages
can build Jekyll on its own but not Hakyll, so the workflow builds the site
and publishes it as a Pages artifact. This requires the repo's Pages source
to be set to **GitHub Actions** (Settings → Pages → Build and deployment →
Source) rather than "Deploy from a branch".

Netlify still hosts the per-PR deploy previews, but it no longer builds
anything — compiling Pandoc and Hakyll inside Netlify's build image would
cost tens of minutes per preview. The `build` job builds once against a warm
cache and the `preview` job uploads the finished `_site` through the Netlify
CLI, so Netlify's repo link must stay disconnected. The preview needs two
repo secrets, `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID`; without them the
job logs a notice and skips rather than failing, which is also what happens
for pull requests from forks.

`ivanthetricourne.io` used to be a separate IPFS deployment on Fleek, wired
up through the Fleek GitHub App rather than any config in this repo. That
site was lost when Fleek dropped its free tier — its last build was cancelled
on 2025-08-21, after which the domain served bunny.net's "Domain suspended or
not configured" page until the DNS was repointed at GitHub Pages. There is no
longer an IPFS mirror; don't reintroduce references to one.

## Structure

- `src/site.hs` — the generator: every rule, route and context lives here
- `src/Site/Config.hs` — site name, description, avatar, URL, footer links.
  This is what `_config.yml` used to be; there is no YAML site config.
- `src/Site/Context.hs` — routes, date parsing, post ordering, excerpts
- `src/Site/Resume.hs` — parses `_data/resume.yml` for the `/resume/` page
- `templates/` — Hakyll templates (`$var$`, `$if(x)$`, `$for(xs)$`), the
  former `_layouts/` and `_includes/`
- `_posts/` — blog posts, one file per post, named `YYYY-MM-DD-title.md`
- `css/` — `style.scss` plus its `_*.scss` partials, compiled to `/style.css`
  by shelling out to dart-sass; `resume.css` is plain CSS, copied through
- `about.md`, `projects.md`, `learn.md`, `404.md`, `fp/*.md` — standalone
  pages, routed by the `permalink:` in their front matter
- `images/`, `fonts/`, `favicon.ico`, `CNAME` — copied verbatim
- `_data/resume.yml` — resume content, source of truth (see Editing content)

The `/resume/` page is rendered from `_data/resume.yml` into
`templates/resume.html` and styled with a self-hosted Spectral webfont.
`css/resume.css` doubles as the print stylesheet (`@page` sizing, letter
margins) so the page's "Download PDF" button (`window.print()`) produces a
clean PDF without any separate build step or committed binary.

Several standalone mini projects/demos live in their own top-level
directories and are copied into the output as-is rather than built by
Hakyll: `Name-Tag-Generator`, `set-count-app`, `fp` (just `Scratch.hs`;
the `.md` files there are real pages), `random-gifs`, `project-arwing`.
Treat each as its own self-contained app — don't assume shared tooling with
the site.

## Build & run

```sh
make build   # stack build && stack exec site -- build
make serve   # rebuild on change, serve on http://localhost:8000
make rebuild # force a full rebuild
make clean   # drop _site/ and Hakyll's _cache/
```

Needs [Stack](https://docs.haskellstack.org/) and
[dart-sass](https://sass-lang.com/install) on `PATH`; `make` checks for the
latter and fails with a pointer if it's missing. Dependencies are pinned by
the single `resolver:` line in `stack.yaml` (LTS 22.43 → GHC 9.6.6, hakyll
4.16). The first build compiles Hakyll and Pandoc from source and takes
tens of minutes; CI caches `~/.stack` and `.stack-work` to avoid repeating
it.

Hakyll keeps its build cache in `_cache/` and writes the site to `_site/`;
both are gitignored. If output looks stale in a way that makes no sense,
`make rebuild`.

## Git workflow

`main` has branch protection requiring PRs — direct pushes are only possible
via an explicit bypass. Default to feature branches + PRs unless told
otherwise.

## Editing content

- New posts: add a markdown file to `_posts/` following the existing front
  matter style — `date:` and `title:`, no `layout:` key (Hakyll picks the
  template in `src/site.hs`). The filename date sets the URL; the `date:`
  in front matter sets what's displayed and how posts sort.
- Post bodies are Pandoc markdown, not Kramdown. Two habits Kramdown
  tolerated and Pandoc does not: a list or a code fence needs a blank line
  before it, and a raw HTML block needs a blank line after it or the next
  line gets swallowed into it.
- Pages: routed by the `permalink:` in their front matter, same as Jekyll.
- Resume: edit `_data/resume.yml` — `/resume/` picks it up automatically.
  Don't hand-edit `templates/resume.html`, it's a template driven by the
  same YAML, not standalone content. The page's "Download PDF" button uses
  `window.print()`, so there's no separate PDF build step to run. Draft/
  unfinished bullets are kept as commented-out YAML under the relevant
  entry rather than left as placeholder text in `highlights`.
