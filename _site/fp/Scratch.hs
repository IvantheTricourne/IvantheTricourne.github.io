quicksort :: (Ord a) => [a] -> [a]
quicksort []     = []
quicksort (x:xs) = xsLess ++ [x] ++ xsMore
  where xsLess = quicksort (filter (<= x)  xs)
        xsMore = quicksort (filter (> x) xs)
