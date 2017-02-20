---
layout: page
title: Equational Reasoning
permalink: /equational-reasoning/
---
Consider the following definitions of `append` and `rev` in Haskell (one can, however, do this in any functional language).

```haskell
append :: [a] -> [a] -> [a]
append []     ys = ys
append (x:xs) ys = x:(append xs ys)

rev :: [a] -> [a]
rev []     = []
rev (x:xs) = append (rev xs) [x]
```

This implementation of `rev` works quite well for smaller sized lists. However, on larger lists, its performance suffers quite a bit (due to the fact that it also calls another recursively defined function, `append`).

We can improve its performance using "equational reasoning" to remove the dependency of `rev` on `append`. First, let's define a function that takes two lists, reverses the first list and then appends the two lists together.

```haskell
appendRev :: [a] -> [a] -> [a]
appendRev xs ys = append (rev xs) ys
```

**Exercises**:

As an example, I've included the solution to the first exercise.

1. Calculate `appendRev [] ys` for any list `ys`. Use substitution.
```haskell
appendRev [] ys
== append (rev []) ys       (def of appendRev)
== append [] ys             (def of rev)
== ys                       (def of append)
```

2. Calculate `appendRev (x:xs) ys` in a similar manner.
3. Reimplement `appendRev` using (1) and (2).
4. Reimplement `rev` to use `appendRev` from (3).

To see this in action, open a GHCi repl, then type the following:
```haskell
*> :set +s
```
Then run `rev` on a large list (e.g. `[1..5000]`). Compare the time it took to complete the computation using the two implementations of `rev`.
