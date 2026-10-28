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
