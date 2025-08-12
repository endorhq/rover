export type NewTaskMetadata = {
    provider: NewTaskProvider
}

export type IterateMetadata = {
    iteration: number
}

export type InitMetadata = {
    agents: string[],
    preferredAgent: string,
    languages: string[]
}
