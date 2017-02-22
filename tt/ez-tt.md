---
layout: page
title: 1 + 1 = 2
permalink: /tt-1/
---
*Reach for the stars* (i.e., the universal supertype).

In Type Theory, there is what is known as the *universal supertype*, or *top*. This type is rather simple but plays a key role in keeping our concept of mathematics in tact. In a fully dependently typed language (i.e., Agda), we can define this type as follows:

```haskell
data ⊤ : Set where
  * : ⊤
```

That is, the type ⊤ has exactly (and only) one element: `*`. What can we do this type? To answer this question, let's familiarize ourselves with a new concept called *induction principles*.

Induction principles aren't too different from the more familiar *recursion principles* that are used in a lot of different programming languages (another name for those is *eliminator* or a *fold* function). Unlike recursion principles, induction principles are more flexible and are not only capable of returning other values. To make this point clear, let's write the recursion principle for the ⊤ type:
```haskell
rec⊤ : (C : Set) → C → ⊤ → C
rec⊤ C c * = c
```
Now, you might be saying that this function looks rather silly. You're right. It's basically an identity function with extra, unused parameters. This function, nonetheless, is the proper way of defining the recursion principle for the ⊤ type. Why? Well, the role of a recursion principle is essentially to map every element of a giving type to another. Since there's only one element in ⊤, we simply take a single element from any other type (in this case the type `C`, as specified by `rec⊤`) and return it (viz. `c`).

The induction principle does the same thing, except the certain "element" we are returning is not exactly a *value* (e.g. `"Banana"`, `True`, `42`) but is a *proof* concerning elements of the respective type.
```haskell
ind⊤ : (C : ⊤ → Set) → C * → (x : ⊤) → C x
ind⊤ C c * = c
```
And that, ladies and gentlemen, is a *dependent type*! To show how to use this function, let's prove the following:
```haskell
(x : ⊤) → x ≡ *
```
That is, for every element that is in ⊤, that element is `*`. The element that inhabits the above type (i.e., the *value* that is of that type) can be constructed using an induction principle. Also, this form of proof, where we take a type and prove something about the identity of its elements, is called a *uniqueness of identity proof*. Our proof looks like this:
```haskell
uip⊤ : (x : ⊤) → x ≡ *
uip⊤ = ind⊤ (λ top → top ≡ *) (refl *)
```
Let's take the time to digest what this code is saying:

1. This function is named `uip⊤`
2. This function is a proof that every element in ⊤ is `*`.
3. To do (2), we use `ind⊤`, since we want to make a statement about *all* elements in ⊤ (this concept applies for more complex types).
4. The first argument of `ind⊤` is called the *motive* and reflects the type of the proof we are trying to construct.
5. `(refl *)` is of type `* ≡ *`


