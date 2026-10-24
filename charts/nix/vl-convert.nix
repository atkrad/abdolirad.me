{
  lib,
  rustPlatform,
  fetchFromGitHub,
  fetchurl,
  protobuf,
  pkg-config,
  libffi,
  stdenv,
}:

# Nixpkgs packages python3Packages.vl-convert-python, which is the Python
# binding, not the vl-convert command. The chart workflow needs `vl-convert vl2svg`.
# This derivation builds that CLI from the same 1.9.0 source and cargo vendor
# hash Nixpkgs uses for the Python package. The librusty_v8 pin matches
# pkgs/development/python-modules/vl-convert-python/librusty_v8.nix for v8 0.105.1.
rustPlatform.buildRustPackage rec {
  pname = "vl-convert";
  version = "1.9.0";

  src = fetchFromGitHub {
    owner = "vega";
    repo = "vl-convert";
    tag = "v${version}";
    hash = "sha256-W23cau2VzpvfO6DRa/40UVv4j8AbsNLfAfDaMkTyj6w=";
  };

  cargoHash = "sha256-P228JMS5K0TbZYyPgKhIbZ1NviwO1jHO5dClFYerNbI=";

  patches = [ ./libffi-system.patch ];

  buildAndTestSubdir = "vl-convert";

  env.RUSTY_V8_ARCHIVE = fetchurl {
    name = "librusty_v8-0.105.1";
    url = "https://github.com/denoland/rusty_v8/releases/download/v0.105.1/librusty_v8_release_${stdenv.hostPlatform.rust.rustcTarget}.a.gz";
    hash =
      {
        x86_64-linux = "sha256-f7aDA74Jn2h4rp9sACGHX4DBbN6yevgWCEKdfI1fJDU=";
        aarch64-linux = "sha256-vuEP7in+A/PrBXSunRq1SC77dOuMiScsKcA712AuNuk=";
        aarch64-darwin = "sha256-GmwTJADMxArwOvRN/w5KVmWGc1+WfraBc/wWe7dxHMg=";
      }
      .${stdenv.hostPlatform.system}
        or (throw "vl-convert has no librusty_v8 pin for ${stdenv.hostPlatform.system}");
  };

  nativeBuildInputs = [
    protobuf
    pkg-config
  ];

  buildInputs = [ libffi ];

  doCheck = false;

  meta = {
    description = "Convert Vega-Lite specifications to SVG";
    homepage = "https://github.com/vega/vl-convert";
    license = lib.licenses.bsd3;
    mainProgram = "vl-convert";
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
      "aarch64-darwin"
    ];
  };
}
