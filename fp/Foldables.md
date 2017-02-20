---
layout: page
title: Recursion Principles and Foldables
permalink: /recursion-foldables/
---
Consider the definition of the simplest foldable data structure: the *Natural Number*!
```haskell
data Nat = Zero
         | Add1 Nat

-- How to print natural numbers a nice way :P
instance Show Nat where
  show Zero     = show (0 :: Integer)
  show (Add1 n) = show $ 1 + (read $ show n)
```

A natural number is either `Zero` or the successor of (i.e., 1 value greater than) another natural number. Think *peano numbers*. With this, we have defined a data structure that includes all positive integers and as well as 0.

Let's define some basic functions for Natural Numbers:
```haskell
-- add two natural numbers together.
plus :: Nat -> Nat -> Nat
plus Zero     y = y
plus (Add1 x) y = Add1 (x `plus` y)

-- multiply two natural numbers.
times :: Nat -> Nat -> Nat
times Zero     _ = Zero
times (Add1 x) y = (x `times` y) `plus` y

-- pow raises its first argument to the power of the second argument.
pow :: Nat -> Nat -> Nat
pow _ Zero     = Add1 Zero
pow x (Add1 y) = (x `pow` y) `times` x
```

Cool, but nothing really out of the ordinary here. These are just your average, every-day run of the mill recursively defined functions, but we can make things a bit more interesting.

Consider the following definition of `foldNat`, which behaves exactly like a reducer (i.e., a *recursion principle*) for natural numbers.

Any data structure that is defined similarly to natural numbers (e.g. Lists) has a corresponding `fold` function. Looking at its type definition, `foldNat` takes an `a`, a function of type `a -> a`, a `Nat` and returns an `a`. One should think of `a` as equivalent to *any* type, which makes `foldNat` an example of a **polymorphic function**. I will write more about those later on :)

Essentially, the job of `foldNat` is to take *any* natural number into the appropriate `a`. For example, reading the first line of `foldNat` says that:

*In the event that* `n` *is the natural number* `Zero`, `foldNat` *should return* `base`.

Consequently, the second line of `foldNat` is called in the event that the given `n` is **not** `Zero` but is instead the `Add1` of another natural number `n`. Thus, `foldNat` would then recur on the smaller natural number, `n`, resulting in an `a` which is then passed to `recur` that does whatever it is it's meant to do. The real magic that happens is mostly contained within the function `recur` passed to `foldNat` (**hint** **hint**).
```haskell
foldNat :: a -> (a -> a) -> Nat -> a
foldNat base recur Zero     = base
foldNat base recur (Add1 n) = recur $ foldNat base recur n
```
To further understand what exactly `foldNat` is meant to do, I've included some exercises! As an example, I've done the first of these.

For those who want a little bit more, I've also included a bonus question to define factorial (`fact`) in terms of `foldNat`.

Good luck!

*Hint*: You may find it useful to define a few natural numbers to avoid having to write out a long series of `Add1`s every time you want to test your functions. For example:

```haskell
two :: Nat
two = Add1 (Add1 Zero)

five :: Nat
five = Add1 (Add1 (Add1 (Add1 (Add1 Zero))))
```

**Exercises**:
```haskell
-- 1. Define `plusFold` that behaves like `plus` but uses `foldNat`.
plusFold :: Nat -> Nat -> Nat
plusFold m n = foldNat n Add1 m

-- 2. Define `timesFold` that behaves like `times` but uses `foldNat`.
timesFold :: Nat -> Nat -> Nat
timesFold = undefined

-- 3. Define `powFold` that behaves like `pow` but uses `foldNat`.
powFold :: Nat -> Nat -> Nat
powFold = undefined

-- BONUS!! This is rather difficult...
fact :: Nat -> Nat
fact Zero     = Add1 Zero
fact (Add1 n) = (Add1 n) `times` (fact n)

factFold :: Nat -> Nat
factFold = undefined
```
