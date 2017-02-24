---
layout: page
title: Chapter 1 - First Steps
permalink: /pl-chp1/
---
In this chapter, we introduce the foundation of all functional languages and its related concepts, we talk about types and their relationship with functional languages, and end with a discussion on the different ways that we commonly write purely functional programs.

### 1. The λ-calculus
One might be thinking *"Calculus? I thought this was about programming?"* It might come as a surprise to some, but mathematics and computer programming actually have quite a long history and continue to find themselves intertwined as time goes on. One can easily find themselves lost in the history and the theory of it all, but that's not the purpose of this book. We introduce the λ-calculus solely for the reason that it is the foundation of all functional languages.

The λ-calculus is a simple programming language made up of only 3 components: variables, abstractions and applications. We can succintly represent every expression in the language (i.e., λ-expression, Λ), by way of a *grammar*:
```
Λ = x | λx . Λ | Λ Λ
```
In general, grammars are defined *recursively* but don't necessarily have to be. The grammar for λ-calculus (above) is defined recursively to reflect that λ-expressions can be composed with other λ-expressions. In PureScript, we can define the grammar for the λ-calculus in the following way:
```haskell
data Lam = Var String
         | Abs String Lam
         | Lam Lam
```
In languages like PureScript, representing a language in such way also defines what is known as a *data type* and allows us to manipulate expressions as data. For example, let's define the *identity function* of the λ-calculus as an expression of our grammar:
```haskell
identity = Abs "x" (Var "x")
```
Of course, since PureScript is already founded on the λ-calculus, we can define the identity function using PureScript's own representation, which is:
```haskell
id = \x -> x
```
The benefit of defining a language using our own defined data type is that we are not constrained in the manner of using our language. We take advantage of this benefit in a later chapter ([Chapter 3]()).




<!-- The phrase *Turing-complete* is just a fancy way of describing a language that can encode *every possible computation*, which makes the λ-calculus the perfect foundation for a programming language. -->



### 2. What is this about Types and Programming Languages?
### 3. Recursion and its Principles
