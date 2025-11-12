export type NewTaskMetadata = {
  provider: NewTaskProvider;
  workflow?: string;
};

export type IterateMetadata = {
  iteration: number;
};

export type InitMetadata = {
  agents: string[];
  preferredAgent: string;
  languages: string[];
  attribution: boolean;
};
