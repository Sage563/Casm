# Soul Polyglot / CASM (Compiled Assembly)

Soul Polyglot is a powerful, multi-paradigm programming language that bridges the gap between high-level Pythonicity and low-level C capabilities. It compiles source code into **.casm** (Compiled Assembly), a compact bytecode format executed by the cross-platform SoulVM.

## 🚀 Features

*   **Hybrid Syntax**: Write naturally using Python-style indentation, or use C-style includes and pointers.
*   **Advanced Data Structures**: First-class support for `set`, `dict` (Map), `deque`, `heap`, and `tuple`.
*   **Module & Package System**: Python-style `import` compiles packages (e.g. `import random`) with **package constants** and functions; C-style `#include`; search paths: `packages/`, `site-packages/`, `lib/`, and `SOUL_PACKAGES` env.
*   **Real Memory Management**: A proper Heap with a Free List Allocator for dynamic memory (`malloc`/`free`).
*   **Virtual File System**: A high-performance, in-memory **RamFS** for fast I/O operations, with optional persistence in Node.js.
*   **Universal Runtime**: Runs anywhere JavaScript runs—Node.js servers, Web Browsers, or massive edge networks.

### Quick start

1. **Build the compiler** (once): `make` (Linux/macOS) or `build.bat` / `.\build.ps1` (Windows).
2. **Compile** a program: `soulc.exe source.soul program.casm` (or `./soulc` on Linux/macOS).
3. **Run** it: `node src/runtime/runtime.js program.casm`.

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

## 🔨 Building the Compiler (soulc)

Before you can compile `.soul` files, you need to build the **soulc** compiler once.

### Prerequisites

- **C++17 compiler** (one of):
  - **Windows:** [MinGW-w64](https://www.mingw-w64.org/) (g++) or Visual Studio (Developer Command Prompt with `cl`)
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`) or Homebrew `gcc`
  - **Linux:** `g++` or `clang++` (e.g. `sudo apt install build-essential`)

- **Node.js** (to run the VM): [nodejs.org](https://nodejs.org/)

### Build steps

**Linux / macOS / WSL:**
```bash
make
```
Produces `soulc` in the project root.

**Windows (Command Prompt):**
```cmd
build.bat
```
Produces `soulc.exe` in the project root.

**Windows (PowerShell):**
```powershell
.\build.ps1
```

**Using npm (any platform with g++ in PATH):**
```bash
npm run build
```

After building, you can compile and run programs:

```bash
soulc.exe myfile.soul myfile.casm
node src/runtime/runtime.js myfile.casm
```

On Linux/macOS use `./soulc` instead of `soulc.exe`.

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

### Custom packages (pip-style)

Packages are folders or `.soul` / `.py` files the compiler can **import**. When you `import random`, the compiler:

1. Looks for `packages/random.soul`, `packages/random/__init__.soul`, `lib/random.soul`, etc.
2. Compiles that file with a **module prefix** so all top-level names become `random.xxx`.
3. **Package constants** (e.g. `RANDOM_MAX = 2147483647`) and **functions** (e.g. `randint(a, b)`) are compiled and available as `random.RANDOM_MAX` and `random.randint(1, 10)`.

**Search order:** current directory → `.` → `packages` → `site-packages` → `lib` → `src` → `include` → `C_INCLUDE_PATH` → `SOUL_PACKAGES` (env).  
**File order:** `packagename/__init__.soul`, `packagename/__init__.py`, `packagename.soul`, `packagename.py`, then `.h` / `.c`.

**Example — use the built-in `random` package:**

**main.soul**
```python
import random

def main():
    print("Roll:", random.randint(1, 6))
    print("Max:", random.RANDOM_MAX)
```

**Add your own package:** put `mypkg.soul` (or `mypkg/__init__.soul`) in `packages/` or a directory listed in `SOUL_PACKAGES`. Use normal Soul syntax; top-level `def` and `name = value` become `mypkg.func` and `mypkg.name`.

```bash
soulc.exe main.soul output.casm
node src/runtime/runtime.js output.casm
```

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

### Standard Library & Packages
| Module | Functions / Constants |
|--------|------------------------|
| **math** | `math.pi`, `math.sqrt(x)`, `math.abs(x)`, `math.e` |
| **time** | `time.sleep(sec)`, `time.now()` |
| **sys** | `sys.exit(code)`, `os.system(cmd)` |
| **random** (package) | `random.randint(a, b)`, `random.RANDOM_MAX` |

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
