{
  description = "abdolirad.me";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    systems.url = "github:nix-systems/default";
  };

  outputs =
    {
      self,
      nixpkgs,
      systems,
      ...
    }:
    let
      eachSystem = nixpkgs.lib.genAttrs (import systems);
    in
    {
      formatter = eachSystem (system: nixpkgs.legacyPackages.${system}.nixfmt-tree);

      packages = eachSystem (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          vl-convert = pkgs.callPackage ./charts/nix/vl-convert.nix { };
        in
        {
          inherit vl-convert;
          charts = pkgs.callPackage ./charts/nix/charts.nix { inherit vl-convert; };
        }
      );

      apps = eachSystem (system: {
        charts = {
          type = "app";
          program = nixpkgs.lib.getExe self.packages.${system}.charts;
        };
      });

      devShells = eachSystem (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.hugo
              pkgs.go
              pkgs.nodejs_24
              self.packages.${system}.vl-convert
              (pkgs.python3.withPackages (ps: [
                ps.fonttools
                ps.brotli
              ]))
              pkgs.harfbuzz.dev
            ];
            shellHook = ''
              export PATH="$PWD/node_modules/.bin:$PATH"
              export CHARTS_FONT_DIR=${self.packages.${system}.charts.fontDir}
              export FONTCONFIG_FILE=${self.packages.${system}.charts.fontConfig}
            '';
          };
        }
      );
    };
}
