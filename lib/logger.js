const PREFIX = '[io-snapshot]';

export const log = {
    info: (msg) => console.log(`${PREFIX} ${msg}`),
    success: (msg) => console.log(`\x1b[32m${PREFIX} SUCCESS: ${msg}\x1b[0m`),
    warn: (msg) => console.warn(`\x1b[33m${PREFIX} WARNING: ${msg}\x1b[0m`),
    error: (msg) => console.error(`\x1b[31m${PREFIX} ERROR: ${msg}\x1b[0m`),
    step: (num, msg) => console.log(`\x1b[34m${PREFIX} [Step ${num}] ${msg}\x1b[0m`),
    divider: (label = '') => {
        const line = '━'.repeat(20);
        console.log(`\x1b[90m${line}${label ? ` ${label} ` : ''}${line}\x1b[0m`);
    },
    workflow: (steps) => {
        console.log(`\x1b[36m${PREFIX} Workflow:\x1b[0m`);
        steps.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
    }
};
