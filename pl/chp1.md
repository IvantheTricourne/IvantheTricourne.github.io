---
layout: page
title: Chapter 1 - First Steps
permalink: /pl-chp1/
---
In this chapter, we introduce the foundation of all functional languages and its related concepts, we talk about types and their relationship with functional languages, and end with a discussion on the different ways that we commonly write purely functional programs.

### 1. The λ-calculus
One might be thinking *"Calculus? I thought this was about programming?"* It might come as a surprise to some, but mathematics and computer programming actually have quite a long history and continue to find themselves intertwined as time goes on. One can easily find themselves lost in the history and the theory of it all, but that's not the purpose of this book. We introduce the λ-calculus solely for the reason that it is the foundation of all functional languages.

#### a. Foundations
The λ-calculus can be thought of as a simple programming language made up of three components: variables, functions, and function application. In many functional languages, the λ-calculus is used at the fundamental level (e.g. function representation and function application) but some of them use it for many other interesting things, which is a testament to how flexible the calculus truly is.

How about a few examples?
```haskell
-- these are variables
x = 5
y = 6

-- this is a function
foo1 = \x -> x

-- this is also a function
foo2 f x y = f x

-- function application
app1 = foo1 x
app2 = foo2 foo1 y x
```
In functional languages, one is free to assign values (i.e., Integers, Booleans, etc.) to variables. As is the case in PureScript and Haskell, variables are constrained by *lower-case* names. It is, however, impossible to *re-assign* new values to variables (i.e., we cannot re-associate `x` with another value; it's always `5`).

A key feature in functional languages is the appearance of functions as *first-class* values. This simply means that one can do with functions as one can do with normal values, as is the case with `foo1`, which itself is a variable associated with the value `(\x -> x)`, an example of an *anonymous function*. Having functions first-class allows one to pass functions as arguments to other functions (as is the case in `foo2`'s first argument, `f`). As we see later on in this chapter, this allows a considerable amount of flexibility in writing our code.

Finally, functions are applied using *juxtaposition*, or simply placing the function beside its arguments. An interesting part of function application in similar functional languages is that we can use *partial function application*. That is, the expression `(foo2 foo1)` is just as valid as `(foo2 foo1 y)`, etc., all of which are also considered first-class values! Imagine the possibilities.

#### b. The Fine Print -- β-reduction

Another thing to note about functions is that they have what is known as a *local namespace*. This means that names contained within functions (i.e, the names of their parameters) are different from those defined outside of the function. In the above examples, we have defined `x` and `y` to hold the value `5` and `6`, respectively. We then later pass these names through function application into `foo1` and `foo2`, which themselves make reference to a certain `x` and `y`. It might then come as a surprise that the value that `app2` results in is `6` and not `5`! The reason for this is that the `x` and `y` defined outside of `foo1` and `foo2` are said to be defined *globally*, while the `x` and `y` in the definition of `foo1` and `foo2` are defined *locally* and are thus different from one another.

To make this concept a bit clearer, it might help to see how `app2` comes up with its answer. In the λ-calculus, this is done through what is known as *β-reduction*. The name *reduction* seems a bit off-putting, since each step in a *β-reduction* is essentially an expansion of expressions into their respective values. This is where a language like PureScript becomes rather helpful, since the act of reducing is simply taking an expression from the left hand side of an `=` sign to the value on the right. Another thing that happens at each step is that with every function application, a function's namespace grows, where the names of its parameters are associated with the values passed in their place. We represent this *namespace growth* as the expression contained within curly braces, `{}`, placed beside the given function being applied. Once all of a function's parameters have their associated value, all occurances of names inside of its body (i.e., the expression after the `->`) are replaced with the respective values mapped inside of its namespace. This continues until there is no other possible reduction. In a later chapter, we show how to simulate this step-by-step calculation inside of PureScript itself!

For now, let's see β-reduction in action!:
```
app2
= foo2 foo1 y x 
= (\f x y -> f x) foo1 y x
= (\f x y -> f x) (\x -> x) 6 5
= ((\f x y -> f x){}) (\x -> x) 6 5
= ((\x y -> f x){f : (\x -> x)}) 6 5
= ((\y -> f x){f : (\x -> x), x : 6}) 5
= ((f x){f : (\x -> x), x : 6, y : 5})
= (\x -> x) 6
= ((\x -> x){}) 6
= (x{x : 6})
= 6
```

<!-- The λ-calculus is a simple programming language made up of only 3 components: variables, abstractions and applications. We can succintly represent every expression in the language (i.e., λ-expression, Λ), by way of a *grammar*: -->
<!-- ``` -->
<!-- Λ = x | λx . Λ | Λ Λ -->
<!-- ``` -->
<!-- In general, grammars are defined *recursively* but don't necessarily have to be. The grammar for λ-calculus (above) is defined recursively to reflect that λ-expressions can be composed with other λ-expressions. In PureScript, we can define the grammar for the λ-calculus in the following way: -->
<!-- ```haskell -->
<!-- data Lam = Var String -->
<!--          | Abs String Lam -->
<!--          | Lam Lam -->
<!-- ``` -->
<!-- In languages like PureScript, representing a language in such way also defines what is known as a *data type* and allows us to manipulate expressions as data. For example, let's define the *identity function* of the λ-calculus as an expression of our grammar: -->
<!-- ```haskell -->
<!-- identity = Abs "x" (Var "x") -->
<!-- ``` -->
<!-- Of course, since PureScript is already founded on the λ-calculus, we can define the identity function using PureScript's own representation, which is: -->
<!-- ```haskell -->
<!-- id = \x -> x -->
<!-- ``` -->
<!-- The benefit of defining a language using our own defined data type is that we are not constrained in the manner of using our language. We take advantage of this benefit in a later chapter ([Chapter 3]()). -->

<!-- The phrase *Turing-complete* is just a fancy way of describing a language that can encode *every possible computation*, which makes the λ-calculus the perfect foundation for a programming language. -->



### 2. What is this about Types and Programming Languages?
### 3. Recursion and its Principles
