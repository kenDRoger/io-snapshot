package io.snapshot;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

public class Main {
    public static void main(String[] args) {
        if (args.length == 0) {
            printUsage();
            System.exit(1);
        }

        String command = args[0];
        try {
            switch (command) {
                case "inject":
                    handleInject(args);
                    break;
                case "restore":
                    handleRestore(args);
                    break;
                default:
                    System.err.println("Unknown command: " + command);
                    printUsage();
                    System.exit(1);
            }
        } catch (Exception e) {
            System.err.println("Error: " + e.getMessage());
            e.printStackTrace();
            System.exit(1);
        }
    }

    private static void handleInject(String[] args) throws Exception {
        String filesArg = "";
        boolean force = false;

        for (int i = 1; i < args.length; i++) {
            if (args[i].startsWith("--files=")) {
                filesArg = args[i].substring(8);
            } else if (args[i].equals("--force")) {
                force = true;
            }
        }

        if (filesArg.isEmpty()) {
            System.err.println("Error: --files argument required");
            System.exit(1);
        }

        String[] files = filesArg.split(",");
        System.out.println("Injecting " + files.length + " Java files...");

        IOSnapshotProcessor processor = new IOSnapshotProcessor(force);
        processor.process(files);

        System.out.println("Injection complete.");
    }

    private static void handleRestore(String[] args) throws Exception {
        String filesArg = "";
        boolean keepSnapshots = false;

        for (int i = 1; i < args.length; i++) {
            if (args[i].startsWith("--files=")) {
                filesArg = args[i].substring(8);
            } else if (args[i].equals("--keep-snapshots")) {
                keepSnapshots = true;
            }
        }

        if (filesArg.isEmpty()) {
            System.err.println("Error: --files argument required");
            System.exit(1);
        }

        String[] files = filesArg.split(",");
        System.out.println("Restoring " + files.length + " Java files...");

        // Restore from backups
        for (String file : files) {
            String backupPath = file + ".snap.bak";
            File backup = new File(backupPath);
            if (backup.exists()) {
                Files.copy(backup.toPath(), Paths.get(file), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                System.out.println("Restored: " + file);
            }
        }

        System.out.println("Restore complete.");
    }

    private static void printUsage() {
        System.out.println("Usage: java -jar io-snapshot-java.jar <command>");
        System.out.println("Commands:");
        System.out.println("  inject --files=<file1,file2> [--force]");
        System.out.println("  restore --files=<file1,file2> [--keep-snapshots]");
    }
}
