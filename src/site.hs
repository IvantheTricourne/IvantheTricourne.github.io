{-# LANGUAGE OverloadedStrings #-}

-- | The generator for https://ivanthetricourne.io.
--
-- Ported from Jekyll. The URLs it produces are deliberately identical to the
-- ones Jekyll produced, so nothing already published moves.
module Main (main) where

import           Hakyll
import           System.FilePath (splitDirectories)
import           Text.Pandoc.Extensions (Extension (..), disableExtension)
import           Text.Pandoc.Options (ReaderOptions (..), WriterOptions)

import           Site.Config
import           Site.Context
import           Site.Resume     (decodeResume, resumeContext)

--------------------------------------------------------------------------------

main :: IO ()
main = hakyllWith configuration $ do

    ----------------------------------------------------------------------
    -- Assets
    ----------------------------------------------------------------------

    -- CNAME has to reach the output: GitHub Pages reads the custom domain
    -- from the published site, so dropping it drops ivanthetricourne.io.
    match ("images/**" .||. "fonts/**" .||. "favicon.ico" .||. "CNAME") $ do
        route   idRoute
        compile copyFileCompiler

    -- Standalone mini projects, linked from the site but not built by it.
    -- They ship exactly as they sit in the repo.
    match (   "Name-Tag-Generator/**"
         .||. "project-arwing/**"
         .||. "random-gifs/**"
         .||. "set-count-app/**"
         .||. "fp/Scratch.hs"
          ) $ do
        route   idRoute
        compile copyFileCompiler

    ----------------------------------------------------------------------
    -- Stylesheets
    ----------------------------------------------------------------------

    -- The partials are pulled in by `@import`, so Hakyll cannot see the
    -- dependency on its own; declaring it keeps `style.css` rebuilding when
    -- one of them changes.
    partials <- makePatternDependency "css/_*.scss"
    rulesExtraDependencies [partials] $ match "css/style.scss" $ do
        route   (constRoute "style.css")
        compile sassCompiler

    match "css/resume.css" $ do
        route   (constRoute "resume.css")
        compile copyFileCompiler

    ----------------------------------------------------------------------
    -- Posts
    ----------------------------------------------------------------------

    match "_posts/*" $ do
        route   postRoute
        compile $ do
            -- Jekyll's `post.excerpt`, saved for the blog index and the
            -- page's own <meta name="description">.
            excerpt <- renderPandocWith readerOptions writerOptions
                         . fmap excerptSource =<< getResourceBody
            _ <- saveSnapshot "excerpt" excerpt

            postCompiler
                >>= saveSnapshot "content"
                >>= loadAndApplyTemplate "templates/post.html"    postContext
                >>= loadAndApplyTemplate "templates/default.html" postContext

    ----------------------------------------------------------------------
    -- Standalone pages
    ----------------------------------------------------------------------

    match ("about.md" .||. "projects.md" .||. "learn.md" .||. "404.md"
      .||. "fp/*.md") $ do
        route   permalinkRoute
        compile $ postCompiler
            >>= loadAndApplyTemplate "templates/page.html"    pageContext
            >>= loadAndApplyTemplate "templates/default.html" pageContext

    ----------------------------------------------------------------------
    -- Résumé
    ----------------------------------------------------------------------

    -- Loaded rather than read directly so that editing the YAML rebuilds
    -- the page.
    match "_data/resume.yml" $ compile getResourceString

    create ["resume/index.html"] $ do
        route   idRoute
        compile $ do
            source <- loadBody "_data/resume.yml"
            resume <- either (fail . ("_data/resume.yml: " ++)) return
                        (decodeResume source)
            let context = resumeContext resume <> baseContext <> siteContext
            makeItem "" >>= loadAndApplyTemplate "templates/resume.html" context

    ----------------------------------------------------------------------
    -- Blog index, paginated
    ----------------------------------------------------------------------

    postCount <- length <$> getMatches "_posts/*"
    let lastPage = max 1 ((postCount + postsPerPage - 1) `div` postsPerPage)

    pages <- buildPaginateWith
        (fmap (paginateEvery postsPerPage) . sortIdentifiersRecentFirst)
        "_posts/*"
        pageIdentifier

    paginateRules pages $ \pageNumber postsOnPage -> do
        route   idRoute
        compile $ do
            posts <- recentFirst' =<< loadAll postsOnPage
            let context =
                    listField "posts" postItemContext (return posts) <>
                    pagerContext lastPage pageNumber                 <>
                    baseContext                                      <>
                    siteContext
            makeItem ""
                >>= loadAndApplyTemplate "templates/index.html"   context
                >>= loadAndApplyTemplate "templates/default.html" context

    ----------------------------------------------------------------------
    -- Feed, sitemap, robots
    ----------------------------------------------------------------------

    create ["feed.xml"] $ do
        route   idRoute
        compile $ do
            posts <- fmap (take 10) . recentFirst'
                        =<< loadAllSnapshots "_posts/*" "content"
            renderAtom feedConfiguration feedContext posts

    create ["sitemap.xml"] $ do
        route   idRoute
        compile $ do
            posts     <- recentFirst' =<< loadAll "_posts/*"
            pagesList <- loadAll ("about.md" .||. "projects.md" .||. "learn.md"
                            .||. "fp/*.md")
            -- `$for$` does not inherit the surrounding context, so the
            -- per-entry contexts need `siteContext` for `$site-url$` too.
            let entryContext = cleanUrlField "url" <> siteContext
                context =
                    listField "posts" (dateContext <> entryContext)
                        (return (posts :: [Item String])) <>
                    listField "pages" entryContext
                        (return (pagesList :: [Item String])) <>
                    siteContext
            makeItem "" >>= loadAndApplyTemplate "templates/sitemap.xml" context

    create ["robots.txt"] $ do
        route   idRoute
        compile $ makeItem ""
            >>= loadAndApplyTemplate "templates/robots.txt" siteContext

    ----------------------------------------------------------------------
    -- Templates
    ----------------------------------------------------------------------

    match "templates/*" $ compile templateBodyCompiler

--------------------------------------------------------------------------------
-- Configuration
--------------------------------------------------------------------------------

configuration :: Configuration
configuration = defaultConfiguration
    { destinationDirectory = "_site"
    , storeDirectory       = "_cache"
    , tmpDirectory         = "_cache/tmp"
    , ignoreFile           = ignore
    }
  where
    -- Keep Hakyll out of the Haskell build trees; `.stack-work` is already
    -- covered by the default dotfile rule.
    ignore path =
        ignoreFile defaultConfiguration path ||
        "dist-newstyle" `elem` splitDirectories path

feedConfiguration :: FeedConfiguration
feedConfiguration = FeedConfiguration
    { feedTitle       = siteName
    , feedDescription = siteDescription
    , feedAuthorName  = siteName
    , feedAuthorEmail = ""
    , feedRoot        = siteUrl
    }

--------------------------------------------------------------------------------
-- Routes
--------------------------------------------------------------------------------

-- | Honour a page's front matter @permalink@, the way Jekyll did:
-- @permalink: \/about\/@ publishes to @about\/index.html@. Pages without one
-- (@404.md@) keep their name and just change extension.
permalinkRoute :: Routes
permalinkRoute = metadataRoute $ \metadata ->
    case lookupString "permalink" metadata of
        Just permalink -> constRoute (trimSlashes permalink ++ "/index.html")
        Nothing        -> setExtension "html"
  where
    trimSlashes = dropWhile (== '/') . reverse . dropWhile (== '/') . reverse

-- | Page 1 of the blog is the site root; the rest live at @\/pageN\/@.
pageIdentifier :: PageNumber -> Identifier
pageIdentifier 1 = fromFilePath "index.html"
pageIdentifier n = fromFilePath ("page" ++ show n ++ "/index.html")

--------------------------------------------------------------------------------
-- Contexts
--------------------------------------------------------------------------------

postContext :: Context String
postContext =
    dateContext                                   <>
    excerptField     "excerpt"      "excerpt"     <>
    excerptTextField "excerpt-text" "excerpt"     <>
    baseContext                                   <>
    siteContext

-- | A post as it appears in the blog index: headline, date and excerpt.
postItemContext :: Context String
postItemContext = cleanUrlField "url" <> postContext

pageContext :: Context String
pageContext = baseContext <> siteContext

feedContext :: Context String
feedContext =
    timeField "published" "%Y-%m-%dT%H:%M:%SZ" <>
    timeField "updated"   "%Y-%m-%dT%H:%M:%SZ" <>
    postContext                                <>
    bodyField "description"

-- | Newer/older links under the blog index.
pagerContext :: Int -> PageNumber -> Context a
pagerContext lastPage pageNumber =
    boolField "has-pager"    (const (lastPage > 1))     <>
    boolField "has-newer"    (const (pageNumber > 1))   <>
    boolField "has-older"    (const (pageNumber < lastPage)) <>
    constField "newer-page-url" (pageUrl (pageNumber - 1))   <>
    constField "older-page-url" (pageUrl (pageNumber + 1))
  where
    pageUrl 1 = "/"
    pageUrl n = "/page" ++ show n ++ "/"

--------------------------------------------------------------------------------
-- Compilers
--------------------------------------------------------------------------------

-- | Markdown, rendered the way the Kramdown-built site rendered it.
postCompiler :: Compiler (Item String)
postCompiler = pandocCompilerWith readerOptions writerOptions

-- | Pandoc's @implicit_figures@ turns a paragraph holding a lone image into
-- a @\<figure\>@ and promotes its alt text to a visible @\<figcaption\>@.
-- Every image in the posts carries descriptive alt text that was never meant
-- to be shown, so this keeps the plain @\<p\>\<img\>\<\/p\>@ Kramdown emitted.
readerOptions :: ReaderOptions
readerOptions = defaultHakyllReaderOptions
    { readerExtensions =
        disableExtension Ext_implicit_figures
            (readerExtensions defaultHakyllReaderOptions)
    }

writerOptions :: WriterOptions
writerOptions = defaultHakyllWriterOptions

-- | Compile SCSS with dart-sass, the same compiler Jekyll used through
-- @sass-embedded@, in the same expanded output style.
sassCompiler :: Compiler (Item String)
sassCompiler = do
    source <- getResourceString
    withItemBody
        (unixFilter "sass" [ "--stdin"
                           , "--load-path=css"
                           , "--style=expanded"
                           , "--no-source-map"
                           ])
        source
