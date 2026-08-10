-- | Routes, contexts and helpers shared by the rules in @site.hs@.
--
-- Most of this module exists to reproduce behaviour the Jekyll site got for
-- free, so that the ported site keeps the same URLs, the same post ordering
-- and the same rendered dates.
module Site.Context
    ( -- * Routes
      postRoute

      -- * Post metadata
    , postTime
    , recentFirst'
    , sortIdentifiersRecentFirst

      -- * Contexts
    , baseContext
    , dateContext
    , timeField
    , cleanUrlField
    , excerptField
    , excerptTextField

      -- * Excerpts
    , excerptSource
    ) where

import           Data.Char        (isDigit)
import           Data.List        (isSuffixOf, sortOn)
import           Data.Ord         (Down (..))
import           Data.Time.Clock  (UTCTime)
import           Data.Time.Format (defaultTimeLocale, formatTime, parseTimeM)
import           Hakyll
import           System.FilePath  (takeBaseName, (<.>), (</>))

--------------------------------------------------------------------------------
-- Routes
--------------------------------------------------------------------------------

-- | @\/:year\/:month\/:title.html@, the permalink scheme inherited from the
-- Jekyll site.
--
-- The slug keeps whatever case the filename has, so
-- @_posts\/2017-02-28-On-a-tues.md@ stays at @\/2017\/02\/On-a-tues.html@.
-- That is what Jekyll emitted and what the live URLs already are, so
-- lowercasing it here would break every existing link to that post.
postRoute :: Routes
postRoute = customRoute $ \identifier ->
    let (year, month, _day, slug) = splitPostName identifier
    in  year </> month </> slug <.> "html"

-- | Split a post filename into its date parts and slug:
-- @_posts\/2017-02-20-first-post.md@ becomes
-- @("2017", "02", "20", "first-post")@.
splitPostName :: Identifier -> (String, String, String, String)
splitPostName identifier = case takeBaseName (toFilePath identifier) of
    (y1:y2:y3:y4:'-':m1:m2:'-':d1:d2:'-':slug) ->
        ([y1, y2, y3, y4], [m1, m2], [d1, d2], slug)
    other ->
        error $ "Site.Context.splitPostName: post filename is not \
                \YYYY-MM-DD-slug: " ++ other

--------------------------------------------------------------------------------
-- Dates
--------------------------------------------------------------------------------

-- | The date a post carries in its front matter, falling back to the date in
-- its filename.
postTime :: MonadMetadata m => Identifier -> m UTCTime
postTime identifier = do
    metadata <- getMetadata identifier
    let (year, month, day, _) = splitPostName identifier
        fromFilename = parseUTC "%Y-%m-%d" (year ++ "-" ++ month ++ "-" ++ day)
    case lookupString "date" metadata >>= parsePostTime of
        Just time -> return time
        Nothing   -> case fromFilename of
            Just time -> return time
            Nothing   -> error $ "Site.Context.postTime: could not date "
                              ++ show identifier

-- | Parse a front matter @date@ the way Jekyll did.
--
-- The dates in @_posts@ are written inconsistently — some are a bare day,
-- some add a time, some add a UTC offset, and two write that offset with
-- three digits (@-500@) rather than four. Jekyll handed these to Ruby's
-- @Time.parse@, which applies the offset when a time is present and ignores
-- it when one is not. Reproducing that quirk keeps the timestamps in the
-- feed and the sitemap identical to what the site already publishes.
parsePostTime :: String -> Maybe UTCTime
parsePostTime raw = case words raw of
    [day]                          -> parseUTC "%Y-%m-%d" day
    [day, tok] | isOffset tok      -> parseUTC "%Y-%m-%d" day
               | otherwise         -> parseUTC "%Y-%m-%d %H:%M:%S"
                                        (unwords [day, tok])
    [day, time, off] | isOffset off -> parseUTC "%Y-%m-%d %H:%M:%S %z"
                                        (unwords [day, time, padOffset off])
    _                              -> Nothing
  where
    isOffset (sign:rest) = sign `elem` "+-" && not (null rest) && all isDigit rest
    isOffset []          = False

    -- "-500" means -05:00; %z insists on four digits.
    padOffset (sign:digits) | length digits == 3 = sign : '0' : digits
    padOffset off                                = off

parseUTC :: String -> String -> Maybe UTCTime
parseUTC = parseTimeM True defaultTimeLocale

-- | Sort items newest first, using 'postTime'.
--
-- Hakyll's own 'recentFirst' goes through @getItemUTC@, which rejects the
-- malformed offsets described above.
recentFirst' :: MonadMetadata m => [Item a] -> m [Item a]
recentFirst' items = do
    dated <- mapM (\i -> (\t -> (t, i)) <$> postTime (itemIdentifier i)) items
    return $ map snd $ sortOn (Down . fst) dated

-- | 'recentFirst'' over bare identifiers, for the paginator.
sortIdentifiersRecentFirst :: MonadMetadata m => [Identifier] -> m [Identifier]
sortIdentifiersRecentFirst identifiers = do
    dated <- mapM (\i -> (\t -> (t, i)) <$> postTime i) identifiers
    return $ map snd $ sortOn (Down . fst) dated

--------------------------------------------------------------------------------
-- Contexts
--------------------------------------------------------------------------------

-- | Hakyll's 'defaultContext' without @titleField@.
--
-- @titleField@ invents a title from the filename whenever front matter does
-- not supply one, which would make @$if(title)$@ true on every page and put
-- \"index\" in the homepage @\<title\>@. Templates here need @title@ to mean
-- \"the page declared one\", exactly like Liquid's @page.title@.
baseContext :: Context String
baseContext =
    bodyField     "body"    <>
    metadataField           <>
    urlField      "url"     <>
    pathField     "path"    <>
    missingField

-- | Post dates, in the two shapes the templates need.
--
-- @date@ is the human form the old @date: "%B %e, %Y"@ Liquid filter
-- produced (@%e@ is space padded, so single-digit days render as
-- \"March  8, 2025\"); @iso-date@ is the RFC 3339 form used by the feed and
-- the sitemap.
dateContext :: Context a
dateContext =
    timeField "date"     "%B %e, %Y" <>
    timeField "iso-date" "%Y-%m-%dT%H:%M:%S%Ez"

-- | A post's 'postTime', rendered with the given 'formatTime' format.
timeField :: String -> String -> Context a
timeField key format = field key $ \item ->
    formatTime defaultTimeLocale format <$> postTime (itemIdentifier item)

-- | Like Hakyll's @$url$@, but without the trailing @index.html@, so a page
-- routed to @about\/index.html@ is linked as @\/about\/@.
cleanUrlField :: String -> Context a
cleanUrlField key = field key $ \item -> do
    mroute <- getRoute (itemIdentifier item)
    case mroute of
        Nothing   -> noResult $ "cleanUrlField: no route for "
                             ++ show (itemIdentifier item)
        Just path -> return $ toUrl (dropIndexHtml path)
  where
    dropIndexHtml path
        | index `isSuffixOf` path = take (length path - length index) path
        | otherwise               = path
      where index = "index.html"

-- | Expose a saved snapshot as a template field.
excerptField :: String -> Snapshot -> Context String
excerptField key snapshot = field key $ \item ->
    loadSnapshotBody (itemIdentifier item) snapshot

-- | The same snapshot as plain text, for @\<meta name="description"\>@ —
-- the old template did @{{ page.excerpt | strip_html }}@.
--
-- Runs of whitespace collapse to single spaces. Jekyll left the excerpt's
-- newlines in place, which put literal line breaks inside the attribute.
excerptTextField :: String -> Snapshot -> Context String
excerptTextField key snapshot = field key $ \item ->
    unwords . words . stripTags
        <$> loadSnapshotBody (itemIdentifier item) snapshot

--------------------------------------------------------------------------------
-- Excerpts
--------------------------------------------------------------------------------

-- | Jekyll's @post.excerpt@: the source up to the first blank line, which is
-- then rendered as markdown in its own right.
--
-- Every post but one opens with a plain paragraph;
-- @2017-03-01-goals.md@ opens with a bullet list, and gets the whole list as
-- its excerpt under this rule, just as it did under Jekyll.
excerptSource :: String -> String
excerptSource = unlines . takeWhile (not . blank) . dropWhile blank . lines
  where
    blank = all (`elem` " \t")
