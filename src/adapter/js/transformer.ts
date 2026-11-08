import { Project, SourceFile, VariableStatement, VariableDeclaration, VariableDeclarationKind, FunctionDeclaration as TsMorphFunctionDeclaration } from 'ts-morph';
import * as babelParser from '@babel/parser';
import * as babelTraverse from '@babel/traverse';
import * as babelTypes from '@babel/types';
import * as babelGenerator from '@babel/generator';
import fs from 'node:fs';
import path from 'node:path';
import { glob } from 'tinyglobby';
import { BACKUP_EXT, SNAPSHOT_FILE, LOCAL_BACKUP_DIR } from '../../core/constants.js';
import { getTempSessionDirPath, getPrimaryBackupPath, getLocalBackupPath } from '../../core/paths.js';
import { getInlineRecorderCode } from './recorder-inline.js';
import { log } from '../../core/logger.js';

const { parse } = babelParser;
const t = babelTypes;

// At runtime these CommonJS packages nest their callable default twice
// (`pkg.default?.default`), matching lib/adapter/js/transformer.js's defense.
// Type them with DT primitives instead of namespace casts.
type TraverseVisitorMap = {
    FunctionDeclaration?: (path: babelTraverse.NodePath<babelTypes.FunctionDeclaration>) => void;
    VariableDeclaration?: (path: babelTraverse.NodePath<babelTypes.VariableDeclaration>) => void;
};
type TraverseCaller = (ast: babelTypes.File, visitors: TraverseVisitorMap) => void;
type GenerateCaller = (ast: babelTypes.File, opts?: object, code?: string) => { code: string };
type BabelCommonJsModule = { default?: { default?: unknown } };

function pickCallable<T>(pkg: unknown, direct: T, label: string): T {
    const nested = (pkg as BabelCommonJsModule).default?.default;
    if (typeof nested === 'function') return nested as T;
    if (typeof direct === 'function') return direct;
    throw new Error(`[@babel/${label}] no callable default found under nodenext interop`);
}

const traverse = pickCallable<TraverseCaller>(babelTraverse, babelTraverse as unknown as TraverseCaller, 'traverse');
const generate = pickCallable<GenerateCaller>(babelGenerator, babelGenerator as unknown as GenerateCaller, 'generator');

function getProject(): Project {
    return new Project({
        useInMemoryFileSystem: false,
    });
}

function injectTSFile(filePath: string): boolean {
    const project = getProject();
    const sourceFile: SourceFile = project.addSourceFileAtPath(filePath);
    let modified = false;

    log.info(`Injecting recorder into ${filePath}`);

    const hasRecorder = sourceFile.getText().includes('window._snap_record') || sourceFile.getText().includes('globalThis._snap_record');

    if (!hasRecorder) {
        const inlineCode = getInlineRecorderCode();
        sourceFile.insertText(0, inlineCode);
        modified = true;
    }

    const exported = sourceFile.getExportedDeclarations();

    if (exported.size === 0 && !modified) {
        return false;
    }

    let functionsWrapped = false;
    exported.forEach((declarations, name) => {
        declarations.forEach(decl => {
            const kind = decl.getKindName();

            if (kind === 'FunctionDeclaration' && decl instanceof TsMorphFunctionDeclaration) {
                const originalName = decl.getName() ?? name;
                decl.rename(`_snap_${originalName}`);
                decl.setIsExported(false);

                sourceFile.addVariableStatement({
                    isExported: true,
                    declarationKind: VariableDeclarationKind.Const,
                    declarations: [{
                        name: originalName,
                        initializer: `_snap_record(_snap_${originalName}, '${originalName}')`
                    }]
                });
                functionsWrapped = true;
            }

            if ((kind === 'ArrowFunction' || kind === 'FunctionExpression') && decl instanceof VariableDeclaration) {
                const variableStmt = decl.getFirstAncestor(
                    (a: { getKindName: () => string }) => a.getKindName() === 'VariableStatement'
                ) as VariableStatement | undefined;
                if (variableStmt) {
                    const declarators = variableStmt.getDeclarations();

                    declarators.forEach(varDecl2 => {
                        const varName = varDecl2.getName();
                        const init = varDecl2.getInitializer();
                        if (init && (init.getKindName() === 'ArrowFunction' || init.getKindName() === 'FunctionExpression')) {
                            const originalName = `_snap_${varName}`;
                            init.replaceWithText(`_snap_record(${originalName}, '${varName}')`);
                            varDecl2.rename(originalName);
                            functionsWrapped = true;
                        }
                    });
                }
            }
        });
    });

    if (functionsWrapped) {
        modified = true;
    }

    if (modified) {
        sourceFile.saveSync();
    }

    return modified;
}

function injectJSFile(filePath: string): boolean {
    const code = fs.readFileSync(filePath, 'utf8');

    log.info(`Injecting recorder into ${filePath}`);

    let ast: babelTypes.File;
    try {
        ast = parse(code, {
            sourceType: 'module',
            plugins: ['jsx']
        });
    } catch (error) {
        log.error(`Parser error in ${filePath}: ${(error as Error).message}`);
        return false;
    }

    let modified = false;

    const body = ast.program.body;
    const hasRecorder = body.some(
        (node) => (
            node.type === 'ExpressionStatement' &&
            node.expression?.type === 'CallExpression' &&
            node.expression.callee?.type === 'FunctionExpression' &&
            node.expression.callee.body?.body?.some?.((stmt: any) =>
                stmt.type === 'ExpressionStatement' &&
                stmt.expression.type === 'AssignmentExpression' &&
                stmt.expression.left.property?.name === '_snap_record'
            )
        )
    );

    if (!hasRecorder) {
        const inlineCode = getInlineRecorderCode();
        const recorderAst = parse(inlineCode, { sourceType: 'script' });
        ast.program.body.unshift(...recorderAst.program.body);
        modified = true;
    }

    const newNodes: babelTypes.Statement[] = [];
    let functionsWrapped = false;

    traverse(ast, {
        FunctionDeclaration(nodePath) {
            if (nodePath.node.id && nodePath.node.id.name && !nodePath.node.id.name.startsWith('_snap_')) {
                const { name } = nodePath.node.id;
                const newName = `_snap_${name}`;

                const newFunction = t.functionDeclaration(
                    t.identifier(newName),
                    nodePath.node.params,
                    nodePath.node.body
                );

                const wrapper = t.variableDeclaration('const', [
                    t.variableDeclarator(
                        t.identifier(name),
                        t.callExpression(t.identifier('_snap_record'), [
                            t.identifier(newName),
                            t.stringLiteral(name)
                        ])
                    )
                ]);

                if (nodePath.parent.type === 'ExportNamedDeclaration' || nodePath.parent.type === 'ExportDefaultDeclaration') {
                    const exportParent = nodePath.findParent((p: any) => p.isExportDeclaration?.());
                    if (exportParent) {
                        exportParent.replaceWith(newFunction);
                        nodePath.skip();
                        newNodes.push(t.exportNamedDeclaration(wrapper));
                        functionsWrapped = true;
                    }
                } else {
                    nodePath.replaceWith(newFunction);
                    nodePath.skip();
                    newNodes.push(wrapper);
                    functionsWrapped = true;
                }
            }
        },
        VariableDeclaration(nodePath) {
            (nodePath.get('declarations') as any[]).forEach((declaratorPath: any) => {
                const declarator = declaratorPath.node;
                if (t.isIdentifier(declarator.id) &&
                    !declarator.id.name.startsWith('_snap_') &&
                    (t.isArrowFunctionExpression(declarator.init) || t.isFunctionExpression(declarator.init))) {

                    const { name } = declarator.id;
                    const newName = `_snap_${name}`;

                    const originalFunction = declarator.init;

                    const newDeclarator = t.variableDeclarator(t.identifier(newName), originalFunction);

                    const wrapper = t.variableDeclaration('const', [
                        t.variableDeclarator(
                            t.identifier(name),
                            t.callExpression(t.identifier('_snap_record'), [
                                t.identifier(newName),
                                t.stringLiteral(name)
                            ])
                        )
                    ]);

                    if (nodePath.parent.type === 'ExportNamedDeclaration') {
                        const exportParent = nodePath.findParent((p: any) => p.isExportDeclaration?.());
                        if (exportParent) {
                            exportParent.replaceWith(t.variableDeclaration(nodePath.node.kind, [newDeclarator]));
                            nodePath.skip();
                            newNodes.push(t.exportNamedDeclaration(wrapper));
                            functionsWrapped = true;
                        }
                    } else {
                        nodePath.replaceWith(t.variableDeclaration(nodePath.node.kind, [newDeclarator]));
                        nodePath.skip();
                        newNodes.push(wrapper);
                        functionsWrapped = true;
                    }
                }
            });
        }
    });

    if (functionsWrapped) {
        modified = true;
    }

    if (!modified) {
        return false;
    }

    ast.program.body.push(...newNodes);

    const output = (generate)(ast, {}, code);
    fs.writeFileSync(filePath, output.code);
    return true;
}

function restoreFile(filePath: string): boolean {
    const primaryBackupPath = getPrimaryBackupPath(filePath);
    const localBackupPath = getLocalBackupPath(filePath);

    if (fs.existsSync(primaryBackupPath)) {
        fs.copyFileSync(primaryBackupPath, filePath);
    } else if (fs.existsSync(localBackupPath)) {
        log.warn(`Primary backup not found for ${filePath}. Restoring from local fallback.`);
        fs.copyFileSync(localBackupPath, filePath);
    } else {
        log.error(`No backup found for ${filePath}.`);
        return false;
    }
    return true;
}

export async function injectRecorder(targetPattern?: string, force = false): Promise<void> {
    const defaultPattern = '**/*.{ts,tsx,js,jsx}';
    const pattern = targetPattern || defaultPattern;

    const files = await glob(pattern, {
        ignore: ['node_modules/**', '**/node_modules/**', `${LOCAL_BACKUP_DIR}/**`]
    });

    if (files.length === 0) {
        log.warn(`No files found matching: ${pattern}`);
        return;
    }

    const sourceFiles = files.filter(f => !f.endsWith(BACKUP_EXT));

    log.info(`Processing ${sourceFiles.length} files...`);

    for (const file of sourceFiles) {
        const primaryBackupPath = getPrimaryBackupPath(file);

        if (fs.existsSync(primaryBackupPath) && !force) {
            log.warn(`Skipping ${file} - already injected. Use --force to re-inject.`);
            continue;
        }

        if (fs.existsSync(primaryBackupPath) && force) {
            fs.copyFileSync(primaryBackupPath, file);
        }

        const localBackupPath = getLocalBackupPath(file);
        fs.copyFileSync(file, primaryBackupPath);
        fs.copyFileSync(file, localBackupPath);

        try {
            let injected = false;
            if (file.endsWith('.ts') || file.endsWith('.tsx')) {
                injectTSFile(file);
                injected = true; // Assume true for TS files for now
            } else {
                injected = injectJSFile(file);
            }

            if (injected) {
                log.success(`Injected into ${file}`);
            } else {
                log.info(`No functions to inject in ${file}, skipping.`);
                // Restore the original file since no changes were made
                restoreFile(file);
            }
        } catch (error) {
            log.error(`Failed to inject ${file}: ${(error as Error).message}`);
            restoreFile(file);
        }
    }
}

export async function restore(targetPattern?: string | null, keepSnapshots = false): Promise<void> {
    let filesToRestore: string[] = [];

    if (targetPattern) {
        const files = await glob(targetPattern);
        filesToRestore = files.filter(f => !f.endsWith(BACKUP_EXT));
    } else {
        const backupDir = path.join(process.cwd(), LOCAL_BACKUP_DIR);
        if (fs.existsSync(backupDir)) {
            const bakFiles = await glob(`${backupDir}/**/*${BACKUP_EXT}`);
            filesToRestore = bakFiles.map(f => {
                const relativePath = path.relative(backupDir, f);
                return relativePath.slice(0, -BACKUP_EXT.length);
            });
        }
    }

    for (const file of filesToRestore) {
        if (restoreFile(file)) {
            log.success(`Restored ${file}`);
        }
    }

    const snapshotPath = path.resolve(process.cwd(), SNAPSHOT_FILE);
    if (!keepSnapshots && fs.existsSync(snapshotPath)) {
        fs.unlinkSync(snapshotPath);
        log.success(`Removed ${SNAPSHOT_FILE}`);
    }

    const tempSessionDirPath = getTempSessionDirPath();
    if (fs.existsSync(tempSessionDirPath)) {
        fs.rmSync(tempSessionDirPath, { recursive: true, force: true });
    }

    const localBackupDirPath = path.join(process.cwd(), LOCAL_BACKUP_DIR);
    if (fs.existsSync(localBackupDirPath)) {
        fs.rmSync(localBackupDirPath, { recursive: true, force: true });
        log.success(`Removed local backup directory: ${LOCAL_BACKUP_DIR}`);
    }
}
