{
  description = "abdolirad.me";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-24.11";
    nixpkgs-unstable.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    self,
    nixpkgs,
    nixpkgs-unstable,
    flake-utils,
  }:
    flake-utils.lib.eachDefaultSystem (
      system: let
        pkgs = nixpkgs.legacyPackages.${system};
        unstable = nixpkgs-unstable.legacyPackages.${system};
      in {
        formatter = pkgs.alejandra;
        devShells.default = pkgs.mkShell {
          name = "abdolirad.me";
          buildInputs = with pkgs; [
            go
            unstable.hugo
          ];
        };
      }
    );
}

