package io.snapshot;

import spoon.Launcher;
import spoon.processing.AbstractProcessor;
import spoon.reflect.code.CtBlock;
import spoon.reflect.declaration.CtMethod;
import spoon.reflect.declaration.CtType;
import spoon.reflect.reference.CtTypeReference;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.*;
import java.nio.file.Path;
import java.nio.file.Paths;

public class IOSnapshotProcessor extends AbstractProcessor<CtMethod<?>> {
    private final Set<String> processedMethods = new HashSet<>();
    private final boolean force;
    private final String proxyCode;

    private static final Set<String> CLASS_PATTERNS = Set.of(
        "Service", "Handler", "Controller", "Manager", "Repository",
        "Bean", "Component", "Facade", "Provider"
    );

    public IOSnapshotProcessor(boolean force, String proxyCode) {
        this.force = force;
        this.proxyCode = proxyCode;
    }

    public void process(String[] filePaths) {
        if (filePaths == null || filePaths.length == 0) return;

        // Step 1: Inject proxy into first file (direct file write)
        if (proxyCode != null && !proxyCode.isEmpty()) {
            injectProxyInline(filePaths[0]);
        }
        
        // Step 2: Backup files
        for (String filePath : filePaths) {
            String backupPath = filePath + ".snap.bak";
            try {
                Files.copy(Paths.get(filePath), Paths.get(backupPath), StandardCopyOption.REPLACE_EXISTING);
            } catch (Exception e) {
                System.err.println("Warning: Could not backup " + filePath + ": " + e.getMessage());
            }
        }
        
        // Step 3: Only process the specific files with Spoon
        Launcher launcher = new Launcher();
        for (String filePath : filePaths) {
            launcher.addInputResource(new File(filePath).getAbsolutePath());
        }
        launcher.getEnvironment().setNoClasspath(true);
        launcher.getEnvironment().setCommentEnabled(false);
        launcher.addProcessor(this);
        launcher.process();
        
        // Step 4: Save modified files using Spoon's printer
        for (CtType<?> type : launcher.getModel().getAllTypes()) {
            try {
                // Find the original file path for the type
                String originalPath = type.getPosition().getFile().getAbsolutePath();
                String output = launcher.getFactory().createPrettyPrinter().calculate(type.getPosition().getCompilationUnit(), type.getPosition().getCompilationUnit().getOriginalSourceCode()).getResult();
                Files.write(Paths.get(originalPath), output.getBytes());
            } catch (Exception e) {
                System.err.println("Error saving " + type.getQualifiedName() + ": " + e.getMessage());
            }
        }
    }

    private void injectProxyInline(String filePath) {
        try {
            String content = new String(Files.readAllBytes(Paths.get(filePath)));
            
            // Check if already injected
            if (content.contains("__snap_record")) {
                System.out.println("[io-snapshot] Proxy and/or wrappers already present in " + filePath);
                return;
            }
            
            int classIdx = content.indexOf("public class ");
            if (classIdx == -1) classIdx = content.indexOf("class ");
            if (classIdx == -1) {
                System.err.println("Could not find class in " + filePath);
                return;
            }
            
            String beforeClass = content.substring(0, classIdx);
            String afterClass = content.substring(classIdx);
            
            String modified = beforeClass + "\n" + proxyCode + "\n\n" + afterClass;
            
            Files.write(Paths.get(filePath), modified.getBytes());
            System.out.println("[io-snapshot] Injected proxy into " + filePath);
        } catch (Exception e) {
            System.err.println("Error injecting proxy: " + e.getMessage());
            e.printStackTrace();
        }
    }

    @Override
    public void process(CtMethod<?> method) {
        if (!shouldInject(method)) return;
        
        String methodKey = method.getDeclaringType().getQualifiedName() + "." + method.getSignature();
        if (processedMethods.contains(methodKey) && !force) return;
        processedMethods.add(methodKey);

        if (method.getBody() == null) return;
        if (isAlreadyWrapped(method)) return;
        
        wrapMethod(method);
    }

    private boolean shouldInject(CtMethod<?> method) {
        String className = method.getDeclaringType().getSimpleName();
        boolean isPublic = method.isPublic();
        boolean isMain = isMainMethod(method);
        
        boolean matchesPattern = false;
        for (String pattern : CLASS_PATTERNS) {
            if (className.endsWith(pattern)) {
                matchesPattern = true;
                break;
            }
        }
    
        System.out.println("[DEBUG] Checking method: " + method.getSimpleName());
        System.out.println("[DEBUG]   className: " + className + ", isPublic: " + isPublic + ", isMain: " + isMain + ", matchesPattern: " + matchesPattern);
        
        if (matchesPattern) {
            System.out.println("[DEBUG]   -> Will inject (matches a class name pattern)");
            return true;
        }
        if (isPublic && !isMain) {
            System.out.println("[DEBUG]   -> Will inject (public non-main method)");
            return true;
        }
        
        System.out.println("[DEBUG]   -> Skipping");
        return false;
    }

    private boolean isMainMethod(CtMethod<?> method) {
        return method.getSimpleName().equals("main") && 
               method.isStatic() && 
               method.getType().getSimpleName().equals("void") &&
               method.getParameters().size() == 1 &&
               method.getParameters().get(0).getType().getSimpleName().equals("String[]");
    }

    private boolean isAlreadyWrapped(CtMethod<?> method) {
        return method.getBody() != null && 
               method.getBody().getStatements().stream()
                   .anyMatch(s -> s.toString().contains("__snap_record"));
    }

    private void wrapMethod(CtMethod<?> method) {
        String methodName = method.getSimpleName();
        String implName = "__" + methodName + "_impl";
        CtType<?> declaringType = method.getDeclaringType();

        CtMethod<?> implMethod = method.getFactory().Core().createMethod();
        implMethod.setSimpleName(implName);
        implMethod.setType(method.getType().clone());
        implMethod.setParameters(new ArrayList<>(method.getParameters()));
        implMethod.setModifiers(method.getModifiers());
        implMethod.setBody(method.getBody().clone());
        
        implMethod.removeModifier(spoon.reflect.declaration.ModifierKind.PUBLIC);
        implMethod.addModifier(spoon.reflect.declaration.ModifierKind.PRIVATE);
        
        declaringType.addMethod(implMethod);

        String params = method.getParameters().stream()
            .map(p -> p.getSimpleName())
            .reduce((a, b) -> a + ", " + b)
            .orElse("");

        String returnType = method.getType().getSimpleName();
        
        String wrapperBody;
        if (returnType.equals("void")) {
            wrapperBody = String.format(
                "%s(%s); __snap_record(\"%s\", new Object[]{%s}, null);",
                implName, params, methodName, params
            );
        } else {
            wrapperBody = String.format(
                "%s __result = %s(%s); __snap_record(\"%s\", new Object[]{%s}, __result); return __result;",
                returnType, implName, params, methodName, params
            );
        }

        try {
            CtBlock<?> block = method.getFactory().Core().createBlock();
            block.addStatement(method.getFactory().Code().createCodeSnippetStatement(wrapperBody));
            method.setBody(block);
            System.out.println("[io-snapshot] Wrapped method: " + methodName);
        } catch (Exception e) {
            System.err.println("Error wrapping method " + methodName + ": " + e.getMessage());
        }
    }
}
