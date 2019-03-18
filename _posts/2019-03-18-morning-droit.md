---
layout: post
date: 2019-03-18 11:50:00
title: the return.
---

Today at work I was able to finally get a chance to write down tests for DSDS
_first order logic_ expression generation. I was also able to find out that
`obligation` expressions can be generalized to support the return of constant
values (something I apparently didn't add already lol).

My musical taste today was:

1. [Panda Eyes](https://ukf.com/artist/panda-eyes)
2. [CY8ER](https://rateyourmusic.com/artist/cy8er)

Seems like an average day.

I was also able to share my method of setting up this blog to some of my
co-workers. I wrote up a simple how-to (included below), that I hope is
easy enough to follow.

## Setting up your own blog with Jekyll

_Hello Jekyll._

Since you're here, maybe you'd like to see what it's like to edit a blog using
markdown? Why? Because that's what you're looking at!

By now you should have figured out this is not your
[your typical blog post](https://erikanapoletano.com/generic-blog-post/),
for that you must look
[elsewhere](https://ivanthetricourne.github.io/we-in-here/).
No, this is a _teaching_ blog post all about `jekyll`.

(you can also just go to my
[GitHub IO repo](https://github.com/IvantheTricourne/IvantheTricourne.github.io)
in case you already know what you're doing)

You will need [`brew`](https://brew.sh/). It shouldn't take long to install.

Once you get passed that, you will need to install the most recent version of
`ruby` (the macOS default doesn't play well with the newer `ruby` gems).

`$ brew install ruby`

Once `ruby` is installed, you'll get some `Caveats`, which tell you to:

`$ echo 'export PATH="/usr/local/opt/ruby/bin:$PATH"' >> ~/.bash_profile`

This will add the `ruby` you just installed _over_ the default macOS install.
You will also need to:

`$ echo 'export PATH="${PATH}:$HOME/.gem/ruby/2.6.0/bin"' >> ~/.bash_profile`

This will add all `ruby` Gems to your path. In this case, you will need
~~only 2~~ 4 gems:

1. `bundler`
2. `jekyll`
3. `jekyll-sitemap`
4. `jekyll-feed`

Gems 3-4 are _optional_ according to official `jekyll` docs. If you, however,
copied this blog, then they are required. If you copied this format, use
`jekyll build` to build your site. If you want to make your own from scratch,
follow the instructions on the `jekyll` [home site](https://jekyllrb.com).

Finally, once everything is happy, you can then use `jekyll serve` to see
a preview of your edits over [localhost](http://127.0.0.1:4000/).
