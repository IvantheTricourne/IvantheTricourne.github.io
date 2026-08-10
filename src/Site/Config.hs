-- | Site-wide settings.
--
-- This is the replacement for Jekyll's @_config.yml@: every value that used
-- to be reachable from a template as a @site.*@ Liquid variable lives here,
-- and is handed to templates through 'siteContext'.
module Site.Config
    ( -- * Identity
      siteName
    , siteDescription
    , siteAvatar
    , siteUrl

      -- * Behaviour
    , postsPerPage
    , googleAnalytics
    , disqusShortname

      -- * Template context
    , siteContext
    ) where

import Data.Maybe (catMaybes)
import Hakyll

-- | Name of the site, shown in the masthead and the @<title>@.
siteName :: String
siteName = "Carl J. Factora"

-- | Short bio, shown under the site name and used as the fallback
-- @description@/@og:description@ for pages without an excerpt.
siteDescription :: String
siteDescription = "writer. engineer. fox main."

-- | Avatar shown in the masthead.
siteAvatar :: String
siteAvatar = "https://ivanthetricourne.io/images/lambda-fox.jpg"

-- | Canonical site URL. Used to build absolute links in the feed, the
-- sitemap and @robots.txt@; everything on-page stays root-relative.
siteUrl :: String
siteUrl = "https://ivanthetricourne.io"

-- | Posts per page on the paginated blog index.
postsPerPage :: Int
postsPerPage = 3

-- | Google Analytics tracking code. 'Nothing' leaves the snippet out.
googleAnalytics :: Maybe String
googleAnalytics = Nothing

-- | Disqus shortname. 'Nothing' leaves the comment box out.
disqusShortname :: Maybe String
disqusShortname = Nothing

-- | Footer icons. A 'Just' handle renders that icon and links to the
-- profile; 'Nothing' leaves it out. The URL for each service is built in
-- @templates\/svg-icons.html@.
footerLinks :: [(String, Maybe String)]
footerLinks =
    [ ("dribbble",      Nothing)
    , ("email",         Nothing)
    , ("facebook",      Nothing)
    , ("flickr",        Nothing)
    , ("github",        Just "IvantheTricourne")
    , ("instagram",     Nothing)  -- cjf_setbang
    , ("linkedin",      Just "cfactora")
    , ("pinterest",     Nothing)
    , ("stackoverflow", Nothing)  -- e.g. "users/50476/bart-kiers"
    , ("twitter",       Just "CJF_setBaNG")
    , ("youtube",       Nothing)  -- channel/<id> or user/<name>
    ]

-- | Everything above, as fields templates can read.
--
-- Optional values are simply absent when unset, so templates can gate on
-- them with @$if(...)$@ exactly like the old Liquid includes did.
siteContext :: Context String
siteContext = mconcat $
    [ constField "site-name"        siteName
    , constField "site-description" siteDescription
    , constField "site-avatar"      siteAvatar
    , constField "site-url"         siteUrl
    ]
    ++ [ constField ("footer-" ++ service) handle
       | (service, Just handle) <- footerLinks
       ]
    ++ catMaybes
       [ constField "google-analytics" <$> googleAnalytics
       , constField "disqus"           <$> disqusShortname
       ]
