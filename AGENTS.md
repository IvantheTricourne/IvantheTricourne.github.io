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
- `resume.pdf` — resume, committed directly at the repo root

Several standalone mini projects/demos live in their own top-level
directories and are linked from the site rather than built through Jekyll:
`Name-Tag-Generator`, `set-count-app`, `fp`, `random-gifs`, `project-arwing`.
Treat each as its own self-contained app — don't assume shared tooling with
the Jekyll site.

## Build & run

```sh
make install   # installs jekyll-sitemap, jekyll-feed, jekyll-paginate gems
make serve     # jekyll serve, local preview
```

Note: the local Jekyll/Ruby toolchain has been broken in this environment
(gem/Ruby version mismatch — `jekyll` gem installed under a different Ruby
than the active one). Verify `jekyll --version` works before relying on
`make serve` for local preview; don't assume it's fixed.

## Git workflow

`main` has branch protection requiring PRs — direct pushes are only possible
via an explicit bypass. Default to feature branches + PRs unless told
otherwise.

## Editing content

- New posts: add a markdown file to `_posts/` following the existing
  front matter style (see recent posts for the pattern).
- Resume: content and regeneration tooling for `resume.pdf` may live in
  `_data/resume.yml` plus a generation script — check for that before
  assuming it must be hand-edited; if present, prefer editing the data file
  and regenerating over hand-editing `resume.pdf`.
