---
date: '2026-10-18T10:16:00+02:00'
draft: false
title: 'The Decisions Behind the Code'
summary: 'I can usually look at a piece of code and understand what it does. The harder question is why it was written that way.'
---
I can usually look at a piece of code and understand what it does. The harder question is why it was written that way.

Why was an API designed this way instead of another? Why does a CLI tool behave differently depending on how it's used? Why do we introduce an abstraction in one part of a system but deliberately avoid it somewhere else?

The answers aren't always obvious from the code itself.

I've been building software professionally since 2013. Over the years, I've worked across backend development, infrastructure, and developer tooling. One thing I've learned is that understanding why something was built a certain way is often more valuable than simply understanding how it works.

Software engineering is full of trade-offs.

A good abstraction can make a system easier to work with, but it can also hide important details. A convenient default can improve the developer experience while making certain behaviors harder to understand. A solution that works well for one team might be completely wrong for another.

There's rarely a perfect answer. Most decisions depend on context, constraints, and what we're willing to compromise on.

That's what I want to explore through this blog.

I'll write about problems I've encountered, tools I've built, and decisions I've made along the way. Sometimes it'll be a technical deep dive. Other times, it might be an experiment, a design decision, or something I used to believe but have since changed my mind about.

A lot of these stories will involve Go, APIs, platform engineering, Kubernetes, and developer tools. But the technologies themselves aren't necessarily the most interesting part.

I'm more interested in the reasoning behind them.

Why did I choose one approach over another? What alternatives did I consider? What worked, what didn't, and what would I do differently today?

Writing is also a way for me to challenge my own thinking. Explaining a decision forces me to examine assumptions I might otherwise overlook.

I want this blog to be a place where I document that process, including the mistakes, lessons, and occasional changes of mind.

And if something I write helps another engineer approach a similar problem differently, even better.
