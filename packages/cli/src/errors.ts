export class FileNotFoundError extends Error {
    constructor(path: string) {
        super(`File ${path} not found`);
        this.name = 'FileNotFoundError';
    }
}

export class InvalidFormatError extends Error {
    constructor(path: string) {
        super(`The format from ${path} is not valid`);
        this.name = 'InvalidFormatError';
    }
}