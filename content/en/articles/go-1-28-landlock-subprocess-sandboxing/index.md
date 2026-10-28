---
date: '2026-10-28T15:20:00+01:00'
draft: false
title: 'Sandboxing Subprocesses with Landlock in Go 1.28'
slug: "go-1-28-landlock-subprocess-sandboxing"
summary: 'Learn how Go 1.28 applies Linux Landlock rules to subprocesses with os/exec, using an example that blocks directory creation.'
keywords:
  - Go 1.28 Landlock
  - Go subprocess sandboxing
  - os/exec Landlock
  - syscall.SysProcAttr
  - Linux Landlock ruleset
  - subprocess security in Go
tags:
  - Go
  - Linux
  - Landlock
  - Security
  - Sandboxing
---
*How Go 1.28 makes it easier to restrict subprocesses on Linux.*
> **Note:** This article uses the development version of Go 1.28, which is expected to be released in February 2027. The API may change before the final release.

## Running external commands is easy. But what about security?

One of the things I like about Go is how easy it makes working with external programs.
With `os/exec`, we can start a process, pass arguments, and collect its output with just a few lines of code.

```go
cmd := exec.Command("some-tool", "--process", "input.txt")
output, err := cmd.CombinedOutput()
if err != nil {
    log.Fatal(err)
}
fmt.Println(string(output))

```

But there's something worth thinking about. External programs normally run with the same user permissions as our application. If our application can read sensitive files or modify important directories, those programs may be able to do the same.
When building developer tools, I sometimes want to run external commands without giving them access to everything my application can access.
This is where sandboxing becomes useful.
Linux provides several ways to isolate processes, including [namespaces](https://man7.org/linux/man-pages/man7/namespaces.7.html) and [seccomp](https://docs.kernel.org/userspace-api/seccomp_filter.html). [Containers](https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-a-container/) combine different isolation mechanisms.
Another interesting option is **Landlock**, and Go 1.28 makes it easier to use with subprocesses.

## What is Landlock?

[Landlock](https://docs.kernel.org/userspace-api/landlock.html) is a Linux security feature introduced in Linux 5.13 as part of the Linux Security Modules (LSM) framework.
It's specific to Linux and isn't available on macOS or Windows.
What makes Landlock interesting is that applications can use it without root privileges. It allows a process to restrict its own access to resources such as files and directories. Newer kernel versions also support certain network restrictions.
These restrictions are defined through a **ruleset**, which describes the operations Landlock should control and where they are allowed.
Landlock follows an allowlist model. If a ruleset handles an operation but doesn't explicitly allow it, that operation is denied.
It can only reduce existing permissions, never grant new ones. Once applied, the restrictions are also inherited by future child processes.

## What changes in Go 1.28?

Landlock isn't new to Go developers. Libraries such as [go-landlock](https://github.com/landlock-lsm/go-landlock) and tools like [Landrun](https://github.com/Zouuup/landrun) have supported it for some time.
The challenge was applying restrictions only to a subprocess while keeping the parent application unrestricted.
Landlock normally restricts the calling thread and its future children. Since Go manages multiple operating system threads, doing this directly requires care. One solution was to use a separate launcher that applies the policy before executing the target program.
Go 1.28 simplifies this by adding Landlock support to `syscall.SysProcAttr`.
The relevant fields are:

| Field | Purpose |
|---|---|
| `NoNewPrivs` | Prevents privilege gains through execution. |
| `UseLandlock` | Enables Landlock enforcement for the child. |
| `LandlockFD` | Identifies the ruleset to apply. |
| `LandlockFlags` | Provides additional enforcement flags. |

Go applies the ruleset to the child before executing the target program, without restricting the parent.
We'll use `os/exec` in the example, but the same functionality is also available through [`os.StartProcess`](https://pkg.go.dev/os#StartProcess).
There's one detail worth keeping in mind: **Go 1.28 applies Landlock rulesets, but it doesn't create them.** We still need to build a ruleset using the Linux interface or a library.

## Running a sandboxed subprocess

Suppose we're building an application that launches subprocesses. We want these subprocesses to run normally, but we don't want them to be able to create new directories.
With Landlock, we can define that restriction and apply it when starting a subprocess.
For this example, we'll use [`golang.org/x/sys/unix`](https://pkg.go.dev/golang.org/x/sys/unix) to create the ruleset. The `unix` package is part of the `golang.org/x/sys` module, which is developed under the Go project but is not part of the Go standard library. It provides Linux constants and architecture-specific syscall numbers.
Here's the complete example:

```go
//go:build linux && go1.28

package main

import (
    "errors"
    "fmt"
    "log"
    "os"
    "os/exec"
    "path/filepath"
    "syscall"
    "unsafe"

    "golang.org/x/sys/unix"
)

func createRuleset() (int, error) {
    attr := struct {
        HandledAccessFS uint64
    }{
        HandledAccessFS: unix.LANDLOCK_ACCESS_FS_MAKE_DIR,
    }
    fd, _, errno := unix.Syscall(
        unix.SYS_LANDLOCK_CREATE_RULESET,
        uintptr(unsafe.Pointer(&attr)),
        unsafe.Sizeof(attr),
        0,
    )
    if errno != 0 {
        return -1, errno
    }
    return int(fd), nil
}

func main() {
    dir, err := os.MkdirTemp("", "landlock-demo-")
    if err != nil {
        log.Fatal(err)
    }
    defer os.RemoveAll(dir)

    rulesetFD, err := createRuleset()
    if err != nil {
        log.Fatal(err)
    }
    defer unix.Close(rulesetFD)

    cmd := exec.Command(
        "mkdir",
        filepath.Join(dir, "from-child"),
    )
    cmd.SysProcAttr = &syscall.SysProcAttr{
        NoNewPrivs:    true,
        UseLandlock:   true,
        LandlockFD:    rulesetFD,
        LandlockFlags: 0,
    }

    output, err := cmd.CombinedOutput()
    if err == nil {
        log.Fatal("Child unexpectedly created a directory")
    }
    var exitErr *exec.ExitError
    if !errors.As(err, &exitErr) {
        log.Fatalf("Could not start child: %v", err)
    }
    fmt.Printf("Child: %s", output)

    err = os.Mkdir(
        filepath.Join(dir, "from-parent"),
        0o700,
    )
    if err != nil {
        log.Fatal(err)
    }
    fmt.Println("Parent: directory created successfully")
}

```

### How it works

The `createRuleset` function creates a Landlock ruleset that handles directory creation through `LANDLOCK_ACCESS_FS_MAKE_DIR`.
Since we don't add any rules allowing that operation, directory creation is denied. Other filesystem operations aren't restricted by this particular rule.
The important part is how we configure the subprocess:

```go
cmd.SysProcAttr = &syscall.SysProcAttr{
    NoNewPrivs:    true,
    UseLandlock:   true,
    LandlockFD:    rulesetFD,
    LandlockFlags: 0,
}

```

`NoNewPrivs` prevents privilege gains through execution and meets the usual requirement for unprivileged Landlock enforcement. `UseLandlock` tells Go to apply the ruleset identified by `LandlockFD`.
When we run the command, Go applies the restrictions before executing `mkdir`.
On a supported system, the expected output looks like this:

```text
Child: mkdir: cannot create directory '/tmp/landlock-demo-87340035/from-child': Permission denied
Parent: directory created successfully

```

The child cannot create its directory, but the parent can still create another directory in the same location.
That's the behavior we wanted, without a separate launcher or restrictions on the parent application.

### Running the example

For this example, we need Linux with Landlock enabled, a Go 1.28 development toolchain, and the `mkdir` command.
We can save the code as `main.go` and run:

```bash
go mod init example.com/landlock-demo
go get golang.org/x/sys/unix
go run .

```

If Landlock isn't supported or is disabled, creating the ruleset fails instead of silently continuing without the requested restriction.
The [runnable example](https://github.com/atkrad/abdolirad.me/tree/main/examples/articles/go-1-28-landlock-subprocess-sandboxing/) is also available on GitHub.

## Why does this matter?

For me, the main benefit is how naturally Landlock now fits into Go's process execution API.
If I'm already using `os/exec`, I can configure restrictions without introducing a separate launcher. This can be useful for build tools, automation systems, and other applications that execute external programs.
Error handling also becomes more direct. If Go cannot enforce the requested policy, starting the child fails. The target program isn't executed without those restrictions.
A correctly implemented launcher can provide the same security guarantees. Go 1.28 doesn't make Landlock stronger, but it reduces the process management code we need to write and maintain.

## A few things to keep in mind

Landlock has limits, even with Go 1.28.
**Kernel support matters.** Landlock must be enabled, and the available access rights depend on the kernel's Landlock ABI version.
**The policy is our responsibility.** Our example blocks directory creation, but it doesn't stop the child from reading sensitive files or performing other allowed operations.
**Landlock isn't a complete sandbox.** Some operations are outside its scope, and inherited file descriptors can still provide access to resources. Depending on the security requirements, other mechanisms may be needed.
If sandboxing is required, failures should never be ignored.

## Final thoughts

What I like about this change is that Go makes an existing Linux security feature easier to use without adding a completely new abstraction.
We still need to create the right ruleset and understand Landlock's limitations. But applying that policy to a subprocess now fits into Go's normal process execution flow.
For developers building tools that run external commands on Linux, I think that's a useful improvement.

## References

- [Go 1.28 Release Notes](https://tip.golang.org/doc/go1.28)
- [Go Landlock Proposal, Issue #68595](https://github.com/golang/go/issues/68595)
- [Go Linux Process Execution Source](https://github.com/golang/go/blob/master/src/syscall/exec_linux.go)
- [Linux Landlock Documentation](https://docs.kernel.org/userspace-api/landlock.html)
- [golang.org/x/sys/unix](https://pkg.go.dev/golang.org/x/sys/unix)
- [go-landlock](https://github.com/landlock-lsm/go-landlock)
