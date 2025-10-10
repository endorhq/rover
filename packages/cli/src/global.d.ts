declare module '*.md' {
  const content: string;
  export default content;
}

declare module '*.sh' {
  const content: string;
  export default content;
}

declare module '*.yml' {
  const path: string;
  export default path;
}

declare module '*.yaml' {
  const path: string;
  export default path;
}
