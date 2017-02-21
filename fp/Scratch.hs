quicksort :: (Ord a) => [a] -> [a]
quicksort []     = []
quicksort (x:xs) = xsLess ++ [x] ++ xsMore
  where xsLess = quicksort [a | a <- xs, a <= x]
        xsMore = quicksort [a | a <- xs, a > x]
