import { Project } from 'ts-morph';
import * as babelParser from '@babel/parser';
import * as babelTraverse from '@babel/traverse';
import * as babelTypes from '@babel/types';
import * as babelGenerator from '@babel/generator';
import fs from 'fs';
import path from 'path';
import { glob } from 'tinyglobby';
import { BACKUP_EXT, SNAPSHOT_FILE, LOCAL_BACKUP_DIR } from './constants.js';
import { getTempSessionDirPath, getPrimaryBackupPath, getLocalBackupPath } from './paths.js';
import { getInlineRecorderCode } from './recorder-inline.js';
import { log } from './logger.js';

const { parse } = babelParser;
const traverse = babelTraverse.default?.default || babelTraverse.default;
const t = babelTypes;
const generate = babelGenerator.default?.default || babelGenerator.default || babelGenerator;

function getProject() {
    return new Project({
        useInMemoryFileSystem: false,
    });
}

function injectTSFile(filePath) {
    const project = getProject();
    const sourceFile = project.addSourceFileAtPath(filePath);
    let modified = false;

    log.info(`Injecting recorder into ${filePath}`);

    const hasRecorder = sourceFile.getText().includes('window._snap_record') || sourceFile.getText().includes('globalThis._snap_record');

    if (!hasRecorder) {
        const inlineCode = getInlineRecorderCode();
        sourceFile.insertText(0, inlineCode);
        modified = true;
    }

    const exports = sourceFile.getExportedDeclarations();

    if (exports.size === 0 && !modified) {
        return false;
    }

    let functionsWrapped = false;
    exports.forEach((declarations, name) => {
        declarations.forEach(decl => {
            const kind = decl.getKindName();

            if (kind === 'FunctionDeclaration') {
                const originalName = decl.getName();
                decl.rename(`_snap_${originalName}`);
                decl.setIsExported(false);

                sourceFile.addVariableStatement({
                    isExported: true,
                    declarationKind: 'const',
                    declarations: [{
                        name: originalName,
                        initializer: `_snap_record(_snap_${originalName}, '${originalName}')`
                    }]
                });
                functionsWrapped = true;
            }

            if (kind === 'ArrowFunction' || kind === 'FunctionExpression') {
                const variableStmt = decl.getFirstAncestor(a => a.getKindName() === 'VariableStatement');
                if (variableStmt) {
                    const declarations = variableStmt.getDeclarations();

                    declarations.forEach(varDecl2 => {
                        const name = varDecl2.getName();
                        const init = varDecl2.getInitializer();
                        if (init && (init.getKindName() === 'ArrowFunction' || init.getKindName() === 'FunctionExpression')) {
                            const originalName = `_snap_${name}`;
                            init.replaceWithText(`_snap_record(${originalName}, '${name}')`);
                            varDecl2.setName(originalName);
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

function injectJSFile(filePath) {
    const code = fs.readFileSync(filePath, 'utf8');

    log.info(`Injecting recorder into ${filePath}`);

    let ast;
    try {
        ast = parse(code, {
            sourceType: 'module',
            plugins: ['jsx']
        });
    } catch (error) {
        log.error(`Parser error in ${filePath}: ${error.message}`);
        return false;
    }

    let modified = false;

    const hasRecorder = ast.program.body.some(
        node => (
            t.isExpressionStatement(node) &&
            node.expression.type === 'CallExpression' &&
            node.expression.callee?.type === 'FunctionExpression' &&
            node.expression.callee.body?.body?.some?.(stmt =>
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

    const newNodes = [];
    let functionsWrapped = false;

    traverse(ast, {
        FunctionDeclaration(path) {
            if (path.node.id && path.node.id.name && !path.node.id.name.startsWith('_snap_')) {
                const { name } = path.node.id;
                const newName = `_snap_${name}`;
                
                const newFunction = t.functionDeclaration(
                    t.identifier(newName),
                    path.node.params,
                    path.node.body,
                    path.node.generator,
                    path.node.async
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

                if (path.parent.type === 'ExportNamedDeclaration' || path.parent.type === 'ExportDefaultDeclaration') {
                    const exportParent = path.findParent(p => p.isExportDeclaration());
                    if (exportParent) {
                        exportParent.replaceWith(newFunction);
                        path.skip();
                        newNodes.push(t.exportNamedDeclaration(wrapper));
                        functionsWrapped = true;
                    }
                } else {
                    path.replaceWith(newFunction);
                    path.skip();
                    newNodes.push(wrapper);
                    functionsWrapped = true;
                }
            }
        },
        VariableDeclaration(path) {
            path.get('declarations').forEach(declaratorPath => {
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

                    if (path.parent.type === 'ExportNamedDeclaration') {
                        const exportParent = path.findParent(p => p.isExportDeclaration());
                        if (exportParent) {
                            exportParent.replaceWith(t.variableDeclaration(path.node.kind, [newDeclarator]));
                            path.skip();
                            newNodes.push(t.exportNamedDeclaration(wrapper));
                            functionsWrapped = true;
                        }
                    } else {
                        path.replaceWith(t.variableDeclaration(path.node.kind, [newDeclarator]));
                        path.skip();
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

    const output = generate(ast, {}, code);
    fs.writeFileSync(filePath, output.code);
    return true;
}

function restoreFile(filePath) {
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

export async function injectRecorder(targetPattern, force = false) {
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
            log.error(`Failed to inject ${file}: ${error.message}`);
            restoreFile(file);
        }
    }
}

export async function restore(targetPattern, keepSnapshots = false) {
    let filesToRestore = [];

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
