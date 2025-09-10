{
  description = "Development environment for rover";

  inputs = {
    flake-utils.url = "github:numtide/flake-utils";
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = {
    self,
    flake-utils,
    nixpkgs
  }: flake-utils.lib.eachDefaultSystem (system: let
    pkgs = import nixpkgs { inherit system; };
  in {
    devShell = pkgs.mkShell {
      buildInputs = with pkgs; [nodejs_22 pnpm vhs bashInteractive];
    };
  });
}
