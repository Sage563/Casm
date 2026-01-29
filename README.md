# Soul Polyglot / CASM (Compiled Assembly)

Soul Polyglot is a powerful, multi-paradigm programming language that bridges the gap between high-level Pythonicity and low-level C capabilities. It compiles source code into **.casm** (Compiled Assembly), a compact bytecode format executed by the cross-platform SoulVM.

## 🚀 Features

*   **Hybrid Syntax**: Write naturally using Python-style indentation, or use C-style includes and pointers.
*   **Advanced Data Structures**: First-class support for `set`, `dict` (Map), `deque`, `heap`, and `tuple`.
*   **Module System**: deeply integrated `import` (Python style) and `#include` (C style) pre-processor.
*   **Real Memory Management**: A proper Heap with a Free List Allocator for dynamic memory (`malloc`/`free`).
*   **Virtual File System**: A high-performance, in-memory **RamFS** for fast I/O operations, with optional persistence in Node.js.
*   **Universal Runtime**: Runs anywhere JavaScript runs—Node.js servers, Web Browsers, or massive edge networks.

---

## 🛠️ How It Works

The Soul Polyglot toolchain consists of two main components: the **Compiler** (`soulc`) and the **Runtime** (`SoulVM`).

### 1. The Compiler (`soulc`)
The compiler transforms human-readable `.soul` source code into machine-executable `.casm` bytecode.

1.  **Preprocessing**: It scans for `import` and `#include` directives, recursively resolving files and stitching them into a single translation unit. A Python file can include a C header, which is then parsed uniformly!
2.  **Lexical Analysis**: The source is broken into tokens. The Lexer uses a "Python Mode" to track indentation levels (`INDENT`/`DEDENT`) while still recognizing C-style operators like `++` or `*ptr`.
3.  **Parsing & Code Gen**: The parser constructs the logic and emits optimized bytecode instructions (e.g., `PUSH`, `STORE`, `SYSCALL`).
4.  **CASM Packaging**: The final output is stamped with the `CASM` (0x4341534D) magic header and written to disk.

### 2. The Runtime (`SoulVM`)
The runtime is a Stack-based Virtual Machine.

*   **Memory**: It allocates a large `Uint8Array` as physical RAM. It manages a **Heap** within this RAM using a **Free List Allocator**, allowing for efficient memory reuse just like C++.
*   **Execution**: It runs the bytecode in a tight loop, dispatching OpCodes.
*   **Syscalls**: Complex operations (File I/O, Printing, Time) are offloaded to "Syscalls" (0x60 - 0xC2).

---

## 📦 Compilation Guide

### Basic Compilation
To compile a single file:

```bash
soulc.exe source.soul program.casm
```

### compiling with Modules
Soul supports modular code. You can split your logic into multiple files.

**main.soul**
```python
import utils
#include "config.h"

def main():
    utils.greet("World")
```

**utils.soul**
```python
def greet(name):
    print("Hello", name)
```

**Compile:**
```bash
soulc.exe main.soul output.casm
```
*The compiler automatically finds `utils.soul` and `config.h` and links them into `output.casm`.*

---

## 🔌 Runtime Guide

The runtime (`src/runtime/runtime.js`) is versatile. It can run in Node.js or the Browser.

### Running in Node.js
Standard execution (uses Real Disk I/O):
```bash
node src/runtime/runtime.js program.casm
```

**High-Performance Mode (RamFS)**:
If you want to run purely in memory (great for sandboxing or speed), use the `--ramfs` flag. This forces the VM to use its internal Virtual File System instead of touching the real disk.
```bash
node src/runtime/runtime.js program.casm --ramfs
```

---

## 📚 Language Reference

### Syntax Styles
**Python Style (Recommended)**
```python
def calculate_area(r):
    return math.pi * r * r

val = 10
if val > 5:
    print("Large")
```

**C/C++ Style Integration**
You can use pointers and manual memory management if needed.
```c
var ptr = malloc(16);
*ptr = 100;
free(ptr);
```

### Advanced Collections
Stop writing boilerplate. Use the built-in power types.

| Type | Constructor | Methods |
|------|-------------|---------|
| **Set** | `set()` | `.add(v)`, `.remove(v)` |
| **Dict** | `dict()` | `.set(k,v)`, `.get(k)` |
| **Deque** | `deque()` | `.push(v)`, `.pop()`, `.shift()` |
| **String** | `"text"` | `.lower()`, `.upper()`, `.split(sep)`, `.join(list)` |

### Standard Library
| Module | Functions |
|--------|-----------|
| **math** | `math.pi`, `math.sqrt(x)`, `math.abs(x)`, `math.e` |
| **time** | `time.sleep(sec)`, `time.now()` |
| **sys** | `sys.exit(code)`, `os.system(cmd)` |

---

## 📄 CASM File Format
Every `.casm` file begins with the 4-byte Magic Header:
`0x43 0x41 0x53 0x4D` ("CASM")

Followed by a sequence of OpCodes and Operands.
*   `0x01 [4 bytes]`: Push Integer
*   `0x02 [String]`: Push String
*   `0x90`: Create Set
*   ...and so on.

---

*Soul Polyglot: One language to rule them all.*
