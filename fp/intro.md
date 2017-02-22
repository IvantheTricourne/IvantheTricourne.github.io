---
layout: post
title: Intro - Starting Out, Nice and Easy
permalink: /pl-intro/
---

### 1. Functional Programming?
Functional Programming (FP) can be thought of simply as a method of writing computer programs where *specification* takes precedence over direct manipulation of computer-executable *instructions*.

The latter of these is probably the more familiar paradigm of computer programming, as it is the primary idealogy behind programming languages like C, Java and Python. In these languages, programmers compose instructions for computers to execute and allow for the free manipulation of values stored within memory. For example, take the following code snippet written in Python:
```python
x = 3
y = x + 2
print(x, y)
```
The above code executes from top to bottom (i.e., line by line). In this example, the value `3` is first stored in a variable named `x`. Afterwards, the computer reads the value stored in `x`, adds `2` to it, then stores the result of that computation in a variable named `y`. Finally, the computer then reads the values stored in `x` and in `y`, then prints them within a tuple, resulting in the value `(3, 5)` being printed onto the console.

This example shows a simple program that executes in the manner that reflects *how* the program looks, which is just one benefit of writing in an *imperative* style. In imperative code, programs have an inherit *order* in which instructions are executed. However, in many other situations, writing in such a way can get rather verbose and dense, making reasoning about a program's correctness rather difficult (see *printf debugging*).

On the other hand, while functional languages don't (quite) offer the seamless access to computer memory and don't (necessarily) feature an inherit structure in the order in which code is executed, functional languages offer something unique and powerful that imperative languages do not.

Let's take the standard (poster-child) example of functional programming: `quicksort`. Before, we provide our code example, let's recall how `quicksort` is implemented in an imperative language by writing some pseudocode:
1. Choose a `pivot` element inside the given array/list
2. Split the array into two new arrays, one containing elements less than `pivot` (`ls1`) and the other containing elements greater (`ls2`), arbitrarily breaking ties.
3. Recur on both of the new lists to sort them.
4. Place the `pivot` element in between the newly sorted lists (e.g. result = `ls1` + `pivot` + `ls2`).

Now, let's see how to implement `quicksort` in Haskell:
```haskell
quicksort :: (Ord a) => [a] -> [a]
quicksort []     = []
quicksort (x:xs) = xsLess ++ [x] ++ xsMore
  where xsLess = quicksort [a | a <- xs, a <= x]
        xsMore = quicksort [a | a <- xs, a > x]
```

* ease
* polymorphism (reuse)
* expressibility (abstraction and specification)

### 2. What We're Doing Here
This is **Пroject λamp** (PL), a simple, down to earth introduction to the vast and ever-expanding world of functional programming. This project can be thought of as a tutorial into the core concepts of languages that feature some functional programming ideals and as well as those that rely heavily on them.

For this book, we are using the *PureScript* programming language, which can be thought of as a flavor of *Haskell* (a popular general purpose, purely functional language). Unlike Haskell, PureScript is intended for use as a *JavaScript replacement*, giving us the needed flexibility for developing a browser-based teaching tool that not only *teaches* functional programming but also allows users to interact with working code within their browser. This takes direct inspiration from *Eloquent JavaScript*, which provides much of the same utility for learning the JavaScript programming language.
		
* not a book about purescript (there's already one for that!)
* this is a book for those who learn better through hands-on experience (we believe this as an effective method of teaching FP since it requires a lot of mindset and methodlogy)

### 3. How to Use this Book (EXERCISES!)
