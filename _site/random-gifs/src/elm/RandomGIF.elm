import Html exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (..)
import Http
import Json.Decode as Decode
import Keyboard exposing (..)
import Char     exposing (..)

main =
  Html.program
    { init = init ""
    , view = view
    , update = update
    , subscriptions = subscriptions
    }

-- MODEL
type alias Model =
  { topic : String
  , pressed : Int
  , gifUrl : String
  , prevUrl : String
  }

init : String -> (Model, Cmd Msg)
init topic =
  ( Model topic 0 "" "", getRandomGif topic )

-- UPDATE
type Msg
  = MorePlease
  | ChangeTopic String
  | Presses Int String
  | NewGif (Result Http.Error String)
  | PrevGif

update : Msg -> Model -> (Model, Cmd Msg)
update msg model =
  case msg of
    MorePlease ->
      ( model, getRandomGif model.topic )

    PrevGif ->
      ( { model | gifUrl = model.prevUrl } , Cmd.none )

    Presses c t ->
      if c == 13 then
        ( { model | topic = t
          , pressed = 0
          }
        , getRandomGif model.topic )
      else ( model, Cmd.none )
          
    ChangeTopic t ->
      ( { model | topic = t }, Cmd.none )

    NewGif (Ok newUrl) ->
      ( { model | prevUrl = model.gifUrl
        , gifUrl = newUrl
        }
      , Cmd.none
      )

    NewGif (Err _) ->
      ( model, Cmd.none )

-- HTTP
-- giphy api
url = "https://api.giphy.com/v1/gifs/random?api_key=dc6zaTOxFJmzC&tag="

getRandomGif : String -> Cmd Msg
getRandomGif topic =
    Http.send NewGif (Http.get (url++topic) decodeGifUrl)

decodeGifUrl : Decode.Decoder String
decodeGifUrl =
  Decode.at [ "data"
            , "image_url"
            ]
  Decode.string
        

-- VIEW
sourceCode = "https://github.com/IvantheTricourne/IvantheTricourne.github.io/tree/master/random-gifs"

view : Model -> Html Msg
view model =
  div [ class "container"
      , style
          [ ( "margin-top", "30px" )
          , ( "text-align", "center" )
          ]
      ]
    [ h2 [][ text "Random GIF Generator" ]
    , a [ href sourceCode ]
        [ Html.text "source code on GitHub" ]
    , hr [][]
    -- , div []
    --     [ h4 [][ text "Instructions: " ]
    --     , p [][ text "1. Enter a topic in the field (or not)" ]
    --     , p [][ text "2. Click \"MOAR PLS!!!\" or press Enter" ]
    --     , p [][ text "3. Press the \"<\" button to go back to the previous GIF." ]
    --     ]
    , input [ placeholder "What ya wanna see?"
            , onInput ChangeTopic
            ][]
    , button [ onClick PrevGif ][ text "<" ]
    , button [ onClick MorePlease ][ text ">" ]
    , br [][]
    , img [ src model.gifUrl ][]
    ]

-- SUBSCRIPTIONS
subscriptions : Model -> Sub Msg
subscriptions model =
  -- Sub.none
  Keyboard.presses (\int -> Presses int model.topic)
