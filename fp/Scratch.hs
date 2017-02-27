quicksort :: (Ord a) => [a] -> [a]
quicksort []     = []
quicksort (x:xs) = xsLess ++ [x] ++ xsMore
  where xsLess = quicksort (filter (<= x)  xs)
        xsMore = quicksort (filter (> x) xs)

-- these are variables
x = 5
y = 6

-- this is a function
foo1 = \x -> x

-- this is also a function
foo2 f x = \y -> f x

-- this is how to apply functions
app1 = foo1 x
app2 = foo2 foo1 y x
