# AGENTS.md

Context for working in this repo: Carl's personal blog + portfolio site.

## What this is

A Jekyll static site (based on the old "Jekyll Now" template) hosted on GitHub
Pages at `ivanthetricourne.github.io`, with a custom domain via `CNAME` and a
mirrored deployment on IPFS (`ivanthetricourne.io`). Deploys automatically via
the `pages-build-deployment` GitHub Action on push to `main`.

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
  `_data/resume.yml`, styled with a self-hosted Spectral webfont
- `scripts/generate_resume_pdf.py` — renders `_data/resume.yml` to
  `resume.pdf` via Jinja2 + WeasyPrint, run with `make resume`
- `resume.pdf` — generated output, committed at the repo root

Several standalone mini projects/demos live in their own top-level
directories and are linked from the site rather than built through Jekyll:
`Name-Tag-Generator`, `set-count-app`, `fp`, `random-gifs`, `project-arwing`.
Treat each as its own self-contained app — don't assume shared tooling with
the Jekyll site.

## Build & run

```sh
make install   # bundle install
make serve     # bundle exec jekyll serve, local preview
make resume    # regenerate resume.pdf from _data/resume.yml
```

Dependencies are pinned via `Gemfile`/`Gemfile.lock` (locked for both
`x86_64-darwin` and `x86_64-linux`, the latter for Netlify's build image).
Netlify's dashboard build command is `bundle exec jekyll build` — it failed
on every deploy preview before the Gemfile existed (no Bundler setup to
resolve against), so don't remove the Gemfile without checking Netlify still
builds.

Known local-only issue: on macOS 13 (Ventura) and earlier, `jekyll build`
can fail during SCSS conversion because `sass-embedded`'s native binary
requires macOS 14+. Not an issue on Netlify's Linux build image or GitHub
Pages; a local-machine quirk, not a repo bug.

`scripts/generate_resume_pdf.py` has its own Python deps
(`scripts/requirements.txt`: pyyaml, jinja2, weasyprint) — separate from the
Jekyll/Bundler toolchain.

## Git workflow

`main` has branch protection requiring PRs — direct pushes are only possible
via an explicit bypass. Default to feature branches + PRs unless told
otherwise.

## Editing content

- New posts: add a markdown file to `_posts/` following the existing
  front matter style (see recent posts for the pattern).
- Resume: edit `_data/resume.yml`, then run `make resume` to regenerate
  `resume.pdf`. Don't hand-edit `resume.pdf` or `resume.html` — the latter
  is a Jekyll template driven by the same YAML, not standalone content.
  Draft/unfinished bullets are kept as commented-out YAML under the
  relevant entry rather than left as placeholder text in `highlights`.
