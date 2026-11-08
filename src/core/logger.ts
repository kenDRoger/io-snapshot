/** Terminal-friendly reporter.
 *  Source of truth: lib/core/logger.js — colors are ANSI codes (the caller's terminal decides rendering). */

const PREFIX = '[io-snapshot]';

export const log = {
    info: (msg: string): void => console.log(`${PREFIX} ${msg}`),
    success: (msg: string): void => console.log(`\x1b[32m${PREFIX} SUCCESS: ${msg}\x1b[0m`),
    warn: (msg: string): void => console.warn(`\x1b[33m${PREFIX} WARNING: ${msg}\x1b[0m`),
    error: (msg: string): void => console.error(`\x1b[31m${PREFIX} ERROR: ${msg}\x1b[0m`),
    step: (num: number, msg: string): void => console.log(`\x1b[34m${PREFIX} [Step ${num}] ${msg}\x1b[0m`),
    divider: (label = ''): void => {
        const line = '━'.repeat(20);
        console.log(`\x1b[90m${line}${label ? ` ${label} ` : ''}${line}\x1b[0m`);
    },
    workflow: (steps: readonly string[]): void => {
        console.log(`\x1b[36m${PREFIX} Workflow:\x1b[0m`);
        steps.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
    }
};
