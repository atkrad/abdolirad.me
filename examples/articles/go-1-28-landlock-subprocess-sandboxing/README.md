# Landlock in Go 1.28

This is a small runnable example for the [English](https://abdolirad.me/articles/go-1-28-landlock-subprocess-sandboxing/) and [Persian](https://abdolirad.ir/articles/go-1-28-landlock-subprocess-sandboxing/) versions of my article about sandboxing subprocesses with Landlock in Go 1.28.

It runs `mkdir` in a restricted subprocess. Landlock blocks directory creation in the child, while the parent application can still create directories.

You'll need Linux with Landlock enabled and a Go 1.28 development toolchain.

Run it with:

```bash
gotip run .
```

The subprocess should fail with "Permission denied", while the parent succeeds.
