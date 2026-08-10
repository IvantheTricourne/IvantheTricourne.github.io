# io page
[![Build and deploy](https://github.com/IvantheTricourne/IvantheTricourne.github.io/actions/workflows/build-and-deploy.yml/badge.svg?branch=main)](https://github.com/IvantheTricourne/IvantheTricourne.github.io/actions/workflows/build-and-deploy.yml)

* [Site](https://ivanthetricourne.io/) — custom domain, served by GitHub Pages
* [github.io mirror](https://ivanthetricourne.github.io) — redirects to the custom domain

A [Hakyll](https://jaspervdj.be/hakyll/) static site. The generator lives in
[`src/site.hs`](src/site.hs); [`templates/`](templates/) holds the page
templates and [`_posts/`](_posts/) the writing.

## Build

Install [Stack](https://docs.haskellstack.org/en/stable/#how-to-install-stack)
and [dart-sass](https://sass-lang.com/install) — the generator shells out to
`sass` to compile [`css/style.scss`](css/style.scss).

The first build compiles Hakyll and Pandoc from source and takes a while;
later ones are incremental.

```sh
make build
```

## Usage

To serve the site locally on <http://localhost:8000>, rebuilding as files
change:

```sh
make serve
```

`make rebuild` forces a full rebuild, and `make clean` drops `_site/` and
Hakyll's `_cache/`.

Pushing to `main` builds and deploys through
[the Pages workflow](.github/workflows/build-and-deploy.yml).
