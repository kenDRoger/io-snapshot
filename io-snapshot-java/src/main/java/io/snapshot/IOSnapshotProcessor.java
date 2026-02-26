package io.snapshot;

import spoon.Launcher;
import spoon.processing.AbstractProcessor;
import spoon.reflect.code.CtBlock;
import spoon.reflect.code.CtCodeSnippetStatement;
import spoon.reflect.declaration.CtMethod;
import spoon.reflect.declaration.CtType;
import spoon.reflect.reference.CtTypeReference;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.*;
import java.nio.file.Paths;

public class IOSnapshotProcessor extends AbstractProcessor<CtMethod<?>> {
    private final Set<String> processedMethods = new HashSet<>();
    private final boolean force;
    private final Map<String, String> originalCode = new HashMap<>();

    public IOSnapshotProcessor(boolean force) {
        this.force = force;
    }

    public void process(String[] filePaths) {
        Launcher launcher = new Launcher();
        
        File firstFile = new File(filePaths[0]);
        File projectRoot = firstFile.getParentFile();
        while (projectRoot != null && !new File(projectRoot, "pom.xml").exists() && !new File(projectRoot, ".git").exists()) {
            projectRoot = projectRoot.getParentFile();
        }
        if (projectRoot == null) projectRoot = firstFile.getParentFile();

        for (String filePath : filePaths) {
            launcher.addInputResource(filePath);
            
            // Backup original
            String backupPath = filePath + ".snap.bak";
            try {
                Files.copy(new File(filePath).toPath(), Paths.get(backupPath), 
                    StandardCopyOption.REPLACE_EXISTING);
                originalCode.put(filePath, new String(Files.readAllBytes(Paths.get(filePath))));
            } catch (Exception e) {
                System.err.println("Warning: Could not backup " + filePath + ": " + e.getMessage());
            }
        }

        launcher.getEnvironment().setNoClasspath(true);
        launcher.getEnvironment().setCommentEnabled(true);
        launcher.getEnvironment().setAutoImports(true);
        launcher.setSourceOutputDirectory(projectRoot); // This is where prettyprint writes
        
        launcher.addProcessor(this);
        launcher.run();
        // launcher.run() already calls processors and can be configured to prettyprint.
        // By default launcher.run() doesn't prettyprint to the same files.
        // We'll use a more manual approach if needed, but let's try this first.
    }

    @Override
    public void process(CtMethod<?> method) {
        if (!hasIOSnapshotAnnotation(method)) return;
        
        String methodKey = method.getDeclaringType().getQualifiedName() + "." + method.getSignature();
        if (processedMethods.contains(methodKey) && !force) return;
        processedMethods.add(methodKey);

        if (method.getBody() == null) return;
        
        wrapMethod(method);
    }

    private boolean hasIOSnapshotAnnotation(CtMethod<?> method) {
        return method.getAnnotations().stream()
            .anyMatch(a -> a.getAnnotationType().getSimpleName().equals("IOSnapshot"));
    }

    private void wrapMethod(CtMethod<?> method) {
        String methodName = method.getSimpleName();
        String implName = "__" + methodName + "_impl";
        CtType<?> declaringType = method.getDeclaringType();

        // Create impl method with original body
        CtMethod<?> implMethod = method.getFactory().Core().createMethod();
        implMethod.setSimpleName(implName);
        implMethod.setType((CtTypeReference) method.getType().clone());
        implMethod.setParameters(new ArrayList<>(method.getParameters()));
        implMethod.setModifiers(method.getModifiers());
        implMethod.setBody(method.getBody().clone());
        
        declaringType.addMethod(implMethod);

        // Build parameter list
        String params = method.getParameters().stream()
            .map(p -> p.getSimpleName())
            .reduce((a, b) -> a + ", " + b)
            .orElse("");

        // Build args array for proxy
        String argsArray = method.getParameters().stream()
            .map(p -> p.getSimpleName())
            .reduce((a, b) -> a + ", " + b)
            .orElse("");

        String returnType = method.getType().getSimpleName();
        
        // Create wrapper body
        String wrapperBody;
        if (returnType.equals("void")) {
            wrapperBody = String.format(
                "%s(%s); IOSnapshotProxy.__snap_record(\"%s\", new Object[]{%s}, null);",
                implName,
                params,
                methodName,
                argsArray
            );
        } else {
            wrapperBody = String.format(
                "%s __result = %s(%s); IOSnapshotProxy.__snap_record(\"%s\", new Object[]{%s}, __result); return __result;",
                returnType,
                implName,
                params,
                methodName,
                argsArray
            );
        }

        try {
            CtBlock<?> block = method.getFactory().Core().createBlock();
            CtCodeSnippetStatement snippet = method.getFactory().Code().createCodeSnippetStatement(wrapperBody);
            block.addStatement(snippet);
            method.setBody(block);
        } catch (Exception e) {
            System.err.println("Error wrapping method " + methodName + ": " + e.getMessage());
        }
    }
}
