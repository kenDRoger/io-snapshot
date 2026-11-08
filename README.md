# 📸 io-snapshot

`io-snapshot` is a powerful behavior-preservation tool designed for zero-regression refactoring. It captures the exact inputs and outputs of your functions during real-world execution and allows you to "replay" them later to ensure that your structural changes haven't introduced behavioral drift.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🚀 Why io-snapshot?

Unit tests verify what you _expect_ to happen. `io-snapshot` verifies what _actually happens_ in your application. It acts as a safety net for:

- **Major Refactors:** Switching from Promises to `async/await` or restructuring complex logic.
- **Dependency Swaps:** Replacing one library with another while maintaining the same interface.
- **Performance Tuning:** Ensuring that optimizations don't break edge cases or return values.
- **Legacy Code:** Safely refactoring codebases that lack traditional test coverage.

## 📦 Installation

> **Note:** `io-snapshot` is not yet published to npm — there is no `@kendroger/io-snapshot` package on the registry yet. Install from source for now:

```bash
git clone https://github.com/kenDRoger/io-snapshot
cd io-snapshot
npm install
```

From inside this folder, the CLI resolves through the local bin symlink, so the examples below work with plain `npx`:

```bash
npx io-snapshot record ./src/services/*.ts
```

## 🛠 Workflow

`io-snapshot` follows a simple 4-step workflow:

### 1. Record

Inject the recorder into your target files and start capturing snapshots while you use your application.

```bash
npx io-snapshot record ./src/services/*.ts
```

_Wait for the "Recording started" message, then start and interact with your app._

### 2. Stop & Restore

Once you've captured enough data, stop the recording. This restores your original source code but preserves the snapshots in `.snaps.jsonl`.

```bash
npx io-snapshot stop
```

### 3. Refactor

Modify your code, optimize your functions, or swap dependencies. As long as the function name and exported interface remain the same, you're good to go.

### 4. Verify

Run the test command to replay the captured inputs against your new code and compare the outputs.

```bash
npx io-snapshot test ./src/services/*.ts
```

## ⌨️ Command Reference

| Command           | Description                                                      |
| :---------------- | :--------------------------------------------------------------- |
| `record [target]` | Injects recorder, starts daemon, and begins capturing snapshots. |
| `stop`            | Stops the daemon and restores original source code.              |
| `test [target]`   | Replays snapshots against current code and reports any drift.    |
| `clean [target]`  | Restores original files and deletes the snapshot data.           |
| `inject [target]` | Explicitly injects the recorder without starting the daemon.     |

## ⚙️ Configuration

You can configure `io-snapshot` via a `.iosnapshotrc.json` file in your project root.

**File Locations:**

- **`.snaps.jsonl`**: Stores your recorded snapshots directly in your project's root directory.
- **Temporary Session Files**: Files like the daemon's PID (`io-snapshot.pid`) and primary backups are stored in a unique, project-specific directory within your **operating system's temporary folder**. This ensures a clean project root and prevents conflicts.
- **Backup Files**:
  - **Primary Backups**: Created in the OS temporary folder alongside other temporary session files.
  - **Fallback Backups**: Created in a `.io-snapshot-backups/` directory in your project's root for persistence against OS temp folder cleanup.

```json
{
  "port": 9444,
  "timeout": 30,
  "exclude": ["node_modules/**", "test/**"]
}
```

## 🤔 Troubleshooting

Here are some common issues and how to solve them in simple terms.

| Problem                                                   | Solution                                                                                                                                                                                                                                                                                          |
| :-------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`"io-snapshot: command not found"`**                    | Run the CLI from inside the cloned repo folder, where the local bin symlink resolves it (`npx io-snapshot --help`). It is not published to npm yet, so there is nothing to install globally.                                                                                                    |
| **`"io-snapshot is already running!"`**                   | You have a previous session that wasn't stopped. Run `npx io-snapshot stop` to end it, and then you can start a new recording.                                                                                                                                                         |
| **No snapshots are being recorded.**                      | 1. Make sure you are running your application _after_ `io-snapshot record` says "Recording started." <br> 2. Check that the functions you want to record are **exported** from their files. <br> 3. Make sure you are interacting with the parts of your app that use those functions. |
| **`"EADDRINUSE: address already in use"`**                | The port `io-snapshot` wants to use (default: 9444) is occupied. You can either stop the other program or tell `io-snapshot` to use a different port with the `-p` flag: `io-snapshot record -p 9445`                                                                                  |
| **Tests are passing, but I know the logic is different.** | `io-snapshot` checks if the final _output_ is the same for a given _input_. If your refactor produces the same result (e.g., changing a `for` loop to a `.map()`), `io-snapshot` will correctly report no change in behavior. It only cares about the "what," not the "how."                      |

## 🔍 How it Works

1. **Instrumentation:** It uses `ts-morph` and `Babel` to wrap your exported functions with a Proxy.
2. **Backup:** Before injecting, `io-snapshot` creates two backups of your original files:
   - A **primary backup** in a temporary directory managed by your operating system.
   - A **fallback backup** in a `.io-snapshot-backups/` directory within your project's root.
     This ensures that even if OS temporary files are cleared, your original code can still be restored.
3. **Capture:** When the wrapped functions are called, the inputs and outputs are sent to a local background daemon.
4. **Storage:** Snapshots are serialized using `SuperJSON` (to preserve complex types like Dates and RegEx) and stored in a newline-delimited JSON file (`.snaps.jsonl`) in your project root.
5. **Verification:** The test runner imports your modified functions and feeds them the exact arguments from the snapshots, then performs a deep-diff on the results. When restoring, it first attempts to use the primary backup, falling back to the local backup if necessary.

## ⚠️ Requirements & Limitations

- Functions must be **exported** (for JS/TS) or annotated with **`@IOSnapshot`** (for Java) to be captured.
- Data must be **serializable** (SuperJSON handles many complex types, but extremely complex circular references or native handles might be tricky).
- Currently supports **ES Modules (ESM)** projects.
- Java support requires **Java 11+** and **Maven** (for building the component).

## ☕ Java Support

`io-snapshot` also supports Java projects.

### Usage

1. **Add Annotation:** Add `@IOSnapshot` annotation to the methods you want to record:
   ```java
   import io.snapshot.IOSnapshot;

   public class MyService {
       @IOSnapshot
       public String process(String input) {
           return input.toUpperCase();
       }
   }
   ```

2. **Record Snapshots:**
   ```bash
   npx io-snapshot record "**/*.java"
   ```

3. **Interact with your application.**

4. **Stop recording:**
   ```bash
   npx io-snapshot stop
   ```

5. **Refactor your code.**

6. **Verify:**
   ```bash
   npx io-snapshot test "**/*.java"
   ```

### Environment Variables

- **`IOSNAP_DAEMON_PORT`**: Port for the daemon (default: 9444)
- **`IOSNAP_DAEMON_HOST`**: Daemon host (default: localhost)

## 📄 License

MIT © [kendroger](https://github.com/kendroger)
