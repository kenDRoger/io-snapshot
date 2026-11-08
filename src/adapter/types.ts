/** The common adapter contract (inject / restore / declare its file extensions). */
export interface Adapter {
    inject(targetPattern?: string, force?: boolean): Promise<void>;
    restore(targetPattern?: string | null, keepSnapshots?: boolean): Promise<void>;
    getFileExtensions(): string[];
}
