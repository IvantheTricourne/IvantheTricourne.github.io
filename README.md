# io page
[![CI](https://github.com/IvantheTricourne/IvantheTricourne.github.io/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/IvantheTricourne/IvantheTricourne.github.io/actions/workflows/ci.yml)
[![Deploy to GitHub Pages](https://github.com/IvantheTricourne/IvantheTricourne.github.io/actions/workflows/pages.yml/badge.svg?branch=main)](https://github.com/IvantheTricourne/IvantheTricourne.github.io/actions/workflows/pages.yml)

* [Site](https://ivanthetricourne.io/) — custom domain, served by GitHub Pages
* [github.io mirror](https://ivanthetricourne.github.io) — redirects to the custom domain

## Build

Install [Jekyll](https://jekyllrb.com/docs/).

Install the gem deps:
```sh
make install
```

## Usage

To serve the site locally:

```sh
make serve
```

To build the site and check it the way CI does, before pushing:

```sh
make check
```

`make check` builds into `_site/` and then runs `ci/check-site.sh`, which
asserts the custom domain survives the build, that the sitemap and feed
actually generated, and that the published URL set still matches
`ci/expected-urls.txt`. If a change is meant to add or remove pages, run
`make update-urls` and commit the regenerated manifest with it.
