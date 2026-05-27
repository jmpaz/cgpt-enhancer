{
  description = "ChatGPT enhancement browser extension";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-darwin"
        "x86_64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      packages = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          cgptEnhancer = pkgs.stdenvNoCC.mkDerivation {
            pname = "cgpt-enhancer";
            version = "0.1.4";
            src = self;
            dontBuild = true;

            installPhase = ''
              runHook preInstall

              install -Dm644 manifest.json "$out/manifest.json"
              install -Dm644 script.js "$out/script.js"

              runHook postInstall
            '';

            meta = {
              description = "Chrome extension for ChatGPT keyboard enhancements";
              platforms = nixpkgs.lib.platforms.all;
            };
          };
        in
        {
          default = cgptEnhancer;
          cgpt-enhancer = cgptEnhancer;
        });

      checks = forAllSystems (system: {
        default = self.packages.${system}.default;
      });
    };
}
