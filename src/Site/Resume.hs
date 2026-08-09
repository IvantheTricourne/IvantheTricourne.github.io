{-# LANGUAGE OverloadedStrings #-}

-- | The @\/resume\/@ page.
--
-- @_data\/resume.yml@ stays the single source of truth for résumé content,
-- exactly as it was under Jekyll. This module parses it and exposes it to
-- @templates\/resume.html@, replacing Jekyll's @site.data.resume@.
module Site.Resume
    ( Resume
    , decodeResume
    , resumeContext
    ) where

import           Data.Aeson         (FromJSON (..), withObject, (.:), (.:?))
import           Data.Maybe         (fromMaybe)
import           Data.Text          (Text)
import qualified Data.Text          as T
import qualified Data.Text.Encoding as T
import qualified Data.Yaml          as Yaml
import           Hakyll

--------------------------------------------------------------------------------
-- Types
--------------------------------------------------------------------------------

data Resume = Resume
    { resumeName       :: Text
    , resumeTitle      :: Text
    , resumeSite       :: Text
    , resumeExperience :: [Job]
    , resumeEducation  :: [School]
    , resumeAdditional :: [Group]
    }

data Job = Job
    { jobCompany    :: Text
    , jobLocation   :: Text
    , jobRole       :: Text
    , jobDates      :: Text
    , jobHighlights :: [Highlight]
    }

data School = School
    { schoolName       :: Text
    , schoolLocation   :: Text
    , schoolProgram    :: Text
    , schoolDates      :: Text
    , schoolHighlights :: [Highlight]
    }

-- | A résumé bullet, optionally with its own nested bullets.
data Highlight = Highlight
    { highlightText :: Text
    , highlightSub  :: [Text]
    }

-- | One line of the \"Additional Information\" list.
data Group = Group
    { groupLabel :: Text
    , groupItems :: [Text]
    }

instance FromJSON Resume where
    parseJSON = withObject "Resume" $ \o -> Resume
        <$> o .:  "name"
        <*> o .:  "title"
        <*> o .:  "site"
        <*> o .:  "experience"
        <*> o .:  "education"
        <*> o .:  "additional"

instance FromJSON Job where
    parseJSON = withObject "Job" $ \o -> Job
        <$> o .:  "company"
        <*> o .:  "location"
        <*> o .:  "role"
        <*> o .:  "dates"
        <*> (orEmpty <$> o .:? "highlights")

instance FromJSON School where
    parseJSON = withObject "School" $ \o -> School
        <$> o .:  "school"
        <*> o .:  "location"
        <*> o .:  "program"
        <*> o .:  "dates"
        <*> (orEmpty <$> o .:? "highlights")

instance FromJSON Highlight where
    parseJSON = withObject "Highlight" $ \o -> Highlight
        <$> o .:  "text"
        <*> (orEmpty <$> o .:? "sub")

instance FromJSON Group where
    parseJSON = withObject "Group" $ \o -> Group
        <$> o .: "label"
        <*> o .: "items"

orEmpty :: Maybe [a] -> [a]
orEmpty = fromMaybe []

--------------------------------------------------------------------------------
-- Parsing
--------------------------------------------------------------------------------

-- | Parse @_data\/resume.yml@, reporting the YAML error verbatim on failure
-- so a typo in the data file fails the build with something actionable.
decodeResume :: String -> Either String Resume
decodeResume source =
    either (Left . Yaml.prettyPrintParseException) Right $
        Yaml.decodeEither' (T.encodeUtf8 (T.pack source))

--------------------------------------------------------------------------------
-- Context
--------------------------------------------------------------------------------

-- | Everything @templates\/resume.html@ needs.
resumeContext :: Resume -> Context String
resumeContext resume =
    constField "resume-name"  (T.unpack (resumeName  resume)) <>
    constField "resume-title" (T.unpack (resumeTitle resume)) <>
    constField "resume-site"  (T.unpack (resumeSite  resume)) <>
    listField  "experience" jobContext
        (mapM makeItem (resumeExperience resume)) <>
    listField  "education"  schoolContext
        (mapM makeItem (resumeEducation  resume)) <>
    listField  "additional" groupContext
        (mapM makeItem (resumeAdditional resume))

jobContext :: Context Job
jobContext =
    textField "company"  jobCompany  <>
    textField "location" jobLocation <>
    textField "role"     jobRole     <>
    textField "dates"    jobDates    <>
    highlightsContext jobHighlights

schoolContext :: Context School
schoolContext =
    textField "school"   schoolName     <>
    textField "location" schoolLocation <>
    textField "program"  schoolProgram  <>
    textField "dates"    schoolDates    <>
    highlightsContext schoolHighlights

-- | The bullet list shared by jobs and schools.
--
-- @has-highlights@ lets the template skip the surrounding @\<ul\>@ entirely
-- when there are none, which is what the old
-- @{% if job.highlights.size > 0 %}@ guard did.
highlightsContext :: (a -> [Highlight]) -> Context a
highlightsContext highlightsOf =
    boolField "has-highlights" (not . null . highlightsOf . itemBody) <>
    listFieldWith "highlights" highlightContext
        (mapM makeItem . highlightsOf . itemBody)

highlightContext :: Context Highlight
highlightContext =
    textField "text" highlightText <>
    boolField "has-sub" (not . null . highlightSub . itemBody) <>
    listFieldWith "sub" subContext
        (mapM makeItem . highlightSub . itemBody)
  where
    subContext = textField "text" id

groupContext :: Context Group
groupContext =
    textField "label" groupLabel <>
    -- Renders the old `{{ group.items | join: ", " }}`.
    textField "items" (T.intercalate ", " . groupItems)

textField :: String -> (a -> Text) -> Context a
textField key get = field key (return . T.unpack . get . itemBody)
