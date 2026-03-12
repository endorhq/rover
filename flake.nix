{
  description = "Development environment for rover";

  inputs = {
    flake-utils.url = "github:numtide/flake-utils";
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    llm-agents.url = "github:numtide/llm-agents.nix";
  };

  outputs = {
    self,
    flake-utils,
    nixpkgs,
    llm-agents
  }: flake-utils.lib.eachDefaultSystem (system: let
    pkgs = import nixpkgs { inherit system; };
    llm-agents-pkgs = llm-agents.packages.${system};
  in {
    devShell = pkgs.mkShell {
      buildInputs = with pkgs; [nodejs_22 pnpm vhs bashInteractive llm-agents-pkgs.qmd];
    };
  });
}
