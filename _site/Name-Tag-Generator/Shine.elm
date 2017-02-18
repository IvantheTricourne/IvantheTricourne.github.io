module Shine where

-- HTML and FRP
import Html            exposing (..)
import Html.Attributes exposing (..)
import Html.Events     exposing (..)
import Signal          exposing (Address)
import StartApp.Simple as StartApp
-- CSS SHIT
import MyCss
import Html.CssHelpers
-- Collage stuff
import String
import Text             exposing (..)
import Color            exposing (..)
import Graphics.Collage exposing (..)

-- MAIN
main : Signal Html
main = StartApp.start
  { model  = empty
  , view   = view
  , update = update
  }

-- MODEL
type alias Model =
  { name  : String
  , prev  : String
  , fill  : Bool          
  , sides : Int
  , nth   : Float
  , size  : Float
  , rotat : Float          
  }

empty : Model
empty = Model "" "" False 6 0 20 0

-- UPDATE
type Action = Name String
            | IncSides
            | DecSides
            | Filled
            | IncSize
            | DecSize
            | Render
            | Rotate

update : Action -> Model -> Model
update action model = 
  case action of
    Name s   -> if (String.length s) <= 20 
                then { model | name = s } 
                else model
    Filled   -> { model | fill = not (model.fill) }
    IncSides -> { model | sides = Basics.min (model.sides + 1) 12 }
    DecSides -> { model | sides = Basics.max (model.sides - 1) <|
                    if model.nth >= 7 then 2 else 3
                }
    IncSize -> { model | size = Basics.min (model.size + 1) 25 }
    DecSize -> { model | size = Basics.max (model.size - 1) 12 }
    Rotate  -> { model | rotat = model.rotat + 2.5 }
    -- Render  -> updateOnlyIfNew model (\x -> x + 1)
    -- for testing shape transformation
    Render -> { model | nth = model.nth + 1 }

updateOnlyIfNew : Model -> (Float -> Float) -> Model
updateOnlyIfNew model f = 
  if model.name == model.prev || model.name == ""
  then model
  else Model model.name model.name model.fill
             model.sides (f <| model.nth) model.size
             model.rotat
  
-- VIEW
{ id, class, classList } =
  Html.CssHelpers.withNamespace "dreamwriter" -- you need this for some reason
      
sourceCode = "https://github.com/IvantheTricourne/IvantheTricourne.github.io/tree/master/Name-Tag-Generator"

view : Address Action -> Model -> Html
view address model =
  div []
    -- Headings
    [ a [ href sourceCode ]
        [ Html.text "source code on GitHub" ]
    , hr [] []
    , h2 [] [ Html.text <|
       "The (Simple) Hygenic-Name Tag Generator"
            ]
    , hr [] []
    , div [] [ Html.text <|
       "design your shape, enter your name, then click render!"
             ]
    -- Easter    
    , div [] [ Html.text <|
                 if model.sides > 2 then ""
                 else "EASTER EGG!!! (because it looks cool)"
             ]
    -- Shape control    
    , button [ onClick address IncSides ]
             [ Html.text "+" ]
    , div [myStyle "55px"] [ Html.text "sides" ]
    , button [ onClick address DecSides ]
             [ Html.text "-" ]
    , button [ onClick address Rotate ]
             [ Html.text "rotate" ]
    -- Fill/Unfill
    , button [ onClick address Filled ]
             [ Html.text "fill/unfill" ]
    , div [] []
    -- Name
    , button [ onClick address IncSize ]
             [ Html.text "+" ]
    , div [myStyle "55px"] [ Html.text "font size" ]
    , button [ onClick address DecSize ]
             [ Html.text "-" ]
    , field address Name model.name
    , hr [] []
    -- Render shape
    , button [ onClick address Render ] 
             [ Html.text "render" ]
    -- Shine    
    , div [] [
        shine model.fill model.sides
              model.size model.rotat model.name model.nth
             ]
    --, div [] [ Html.text <| "Location: " ++ (toString (model.nth 8)) ]
    ]
    
field : Address Action -> (String -> Action) -> String -> Html
field address toAction content =
  div [ myStyle "15px" ]
    [ input
        [ placeholder "Enter your name here"
        , value content
        , on "input" targetValue 
            (\string -> Signal.message address (toAction string))
        ]
        []
    ]
         
myStyle : String -> Attribute
myStyle px =
  Html.Attributes.style
    [ ("width", px)
    , ("padding", "10px")
    , ("text-align", "center")
    , ("display", "inline-block")
    ]

-- MAKING A SHINE
filledHex : Int -> Float -> Float -> Float -> Float -> List Form
filledHex sides off rot b e = 
  let twentyXX x  = rgba 112 219 255 x
      -- gray scale tests
      -- twentyXX x  = rgba 150 150 150 x
      mkShine clr = outlined (solid clr) (ngon sides 50)
                      |> rotate 1.576
                      |> rotate rot
      format x    = case x of
          0 -> mkShine (twentyXX x) 
                |> scale x
          _ -> mkShine (twentyXX (x / 22)) -- fade
                |> rotate (off * x)        -- size
                |> scale x
  in List.map format << List.map (\x -> x / 100.0) 
      <| [b..e]

shine : Bool -> Int -> Float -> Float -> String -> Float -> Html
shine filled sides size rot s m = 
  let displayName s = 
        Graphics.Collage.text << bold << Text.height size
          <| fromString s
      nameToIMG x   =
        if filled
        then filledHex sides x rot 0 300
        else filledHex sides x rot 180 300
  in fromElement << collage 400 400 
      <| displayName s :: nameToIMG m
