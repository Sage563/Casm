// Cross-platform Soul VM Runtime - OPTIMIZED
// Supports Node.js (fs) and Browser (fetch/ramFS)

class VirtualFile {
    constructor() {
        this.buffer = new Uint8Array(1024);
        this.size = 0;
        this.mtime = Date.now();
    }

    grow(needed) {
        if (this.buffer.length >= needed) return;
        const newCap = Math.max(this.buffer.length * 2, needed);
        const newBuf = new Uint8Array(newCap);
        newBuf.set(this.buffer);
        this.buffer = newBuf;
    }

    write(data, offset) {
        this.grow(offset + data.length);
        this.buffer.set(data, offset);
        if (offset + data.length > this.size) {
            this.size = offset + data.length;
        }
        this.mtime = Date.now();
        return data.length;
    }

    read(length, offset) {
        if (offset >= this.size) return new Uint8Array(0);
        const end = Math.min(offset + length, this.size);
        return this.buffer.slice(offset, end);
    }
}

class FreeBlock {
    constructor(addr, size, next = null) {
        this.addr = addr;
        this.size = size;
        this.next = next;
    }
}

class SoulVM {
    constructor(config = {}) {
        this.config = {
            maxMemory: config.maxMemory || 1024 * 1024,
            stackSize: config.stackSize || 16384,
            maxCallDepth: config.maxCallDepth || 1000,
            useRamFS: config.useRamFS !== undefined ? config.useRamFS : (typeof window !== 'undefined'),
            outputMode: config.outputMode || false,
            debug: config.debug || false,
            validateBytecode: config.validateBytecode !== undefined ? config.validateBytecode : true,
            ...config
        };

        // OPTIMIZATION: Pre-allocated stack with stack pointer
        this.stack = new Array(this.config.stackSize);
        this.sp = 0;

        this.callStack = [];
        this.variables = new Map();
        this.frames = [new Map()];
        this.memory = new Uint8Array(this.config.maxMemory);
        this.heapStart = Math.floor(this.config.maxMemory / 2);
        this.heapOffset = this.heapStart;
        this.pc = 0;
        this.running = false;
        this.handles = new Map();
        this.nextFD = 3;
        this.capturedOutput = [];
        this.freeList = null;
        this.allocatedSizes = new Map();
        this.ramFS = new Map();
        this.atexitHandlers = [];
        this.atQuickExitHandlers = [];
        this.tryStack = [];

        // OPTIMIZATION: String interning cache for frequently used strings
        this.stringCache = new Map();
        this.stringCacheHits = 0;
        this.stringCacheMisses = 0;

        // Debug and error tracking
        this.instructionCount = 0;
        this.lastError = null;
        this.errorStack = [];

        // WASM-like: Function Tables for indirect calls
        this.functionTable = [];  // Array of function addresses
        this.tableSize = config.tableSize || 256;

        // WASM-like: Module System
        this.modules = new Map();  // module name -> Module object
        this.currentModule = null;
        this.exports = new Map();  // exported functions/globals
        this.imports = new Map();  // imported functions/globals

        // WASM-like: Type System
        this.typeInfo = new Map();  // variable -> type mapping
        this.typeCache = new Map();  // inline caching for polymorphic ops

        // OPTIMIZATION: TextDecoder for fast string reading
        this.decoder = new TextDecoder();
        this.encoder = new TextEncoder();
        this.isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
        if (this.isNode) this.fs = require('fs');

        this.variables.set('True', 1);
        this.variables.set('False', 0);
        this.variables.set('None', null);

        // Built-in functions for C compatibility
        this.variables.set('ARRAY_LEN', function () {
            const arr = this.stack[--this.sp];
            this.stack[this.sp++] = Array.isArray(arr) ? arr.length : 0;
        });
        this.variables.set('MAX', function () {
            const b = this.stack[--this.sp];
            const a = this.stack[--this.sp];
            this.stack[this.sp++] = a > b ? a : b;
        });
        this.variables.set('memcpy', function () {
            // memcpy(dest, src, n) - copies n bytes from src to dest
            const n = this.stack[--this.sp];
            const src = this.stack[--this.sp];
            const dest = this.stack[--this.sp];
            // BUG FIX: Add bounds checking
            if (dest < 0 || dest + n > this.config.maxMemory) {
                this.throwError('Memory access out of bounds in memcpy');
                return;
            }
            if (typeof src === 'string') {
                // Copy string to memory
                for (let i = 0; i < n && i < src.length; i++) {
                    this.memory[dest + i] = src.charCodeAt(i);
                }
            } else if (typeof src === 'number' && typeof dest === 'number') {
                if (src < 0 || src + n > this.config.maxMemory) {
                    this.throwError('Source memory access out of bounds in memcpy');
                    return;
                }
                for (let i = 0; i < n; i++) {
                    this.memory[dest + i] = this.memory[src + i];
                }
            }
            this.stack[this.sp++] = dest;
        });
        this.variables.set('strlen', function () {
            const s = this.stack[--this.sp];
            if (typeof s === 'string') {
                this.stack[this.sp++] = s.length;
            } else {
                this.stack[this.sp++] = this.getString(s).length;
            }
        });
        this.variables.set('time', function () {
            this.stack[this.sp++] = Math.floor(Date.now() / 1000);
        });
        this.variables.set('ctime', function () {
            const t = this.stack[--this.sp];
            this.stack[this.sp++] = new Date(t * 1000).toString();
        });
    }

    // FEATURE: Help system
    static showHelp() {
        const help = `
SoulVM - Cross-platform Virtual Machine Runtime

Usage: node runtime.js [options] <bytecode_file>

Options:
  --ramfs          Use RAM filesystem instead of real filesystem
  --debug          Enable debug mode with execution tracing
  --no-validate    Skip bytecode validation (faster but unsafe)
  --max-memory N   Set maximum memory in bytes (default: 1048576)
  --stack-size N   Set stack size (default: 16384)
  --help           Show this help message

Examples:
  node runtime.js program.casm
  node runtime.js --debug --ramfs program.casm
  node runtime.js --max-memory 2097152 program.casm

For more information, visit: https://github.com/Sage563/Casm
`;
        console.log(help);
    }

    // BUG FIX: Better error handling with stack traces
    throwError(message) {
        this.lastError = {
            message,
            pc: this.pc,
            sp: this.sp,
            callStack: [...this.callStack],
            timestamp: Date.now()
        };
        this.errorStack.push(this.lastError);

        const errorMsg = `\n[RUNTIME ERROR] ${message}\n` +
            `  PC: ${this.pc}\n` +
            `  SP: ${this.sp}\n` +
            `  Call depth: ${this.callStack.length}\n`;

        if (this.config.debug) {
            console.error(errorMsg);
            console.error('  Call stack:', this.callStack);
        }

        throw new Error(message);
    }

    // OPTIMIZATION: String interning for frequently used strings
    internString(bytes, offset, length) {
        // Create a cache key from the byte sequence
        const key = `${offset}:${length}`;

        if (this.stringCache.has(key)) {
            this.stringCacheHits++;
            return this.stringCache.get(key);
        }

        const str = this.decoder.decode(bytes.subarray(offset, offset + length));

        // Only cache strings up to 64 chars to avoid memory bloat
        if (length <= 64 && this.stringCache.size < 1000) {
            this.stringCache.set(key, str);
        }

        this.stringCacheMisses++;
        return str;
    }

    // FEATURE: Get performance statistics
    getStats() {
        return {
            instructionCount: this.instructionCount,
            stringCacheHits: this.stringCacheHits,
            stringCacheMisses: this.stringCacheMisses,
            cacheHitRate: this.stringCacheHits / (this.stringCacheHits + this.stringCacheMisses),
            heapUsed: this.heapOffset - this.heapStart,
            stackDepth: this.sp,
            callDepth: this.callStack.length,
            allocatedBlocks: this.allocatedSizes.size
        };
    }

    static async runWithOutput(res, config = {}) {
        const vm = new SoulVM({ ...config, outputMode: true });
        await vm.load(res);
        const output = vm.run() || "";
        return { output, vm };
    }

    static get payloads() {
        return {
            cs: "534F554C010000001004044D61696E0A0000006D021B432320696E207468652042726F777365723A2053554343455353210100000001036002025C6E010000000103600219506F6C79676C6F7420506F77657220756E6C6561736865642E0100000001036002025C6E010000000103600D0C044D61696E00",
            c: "534F554C0509434F4C4F525F524544050B434F4C4F525F475245454E050A434F4C4F525F424C55450505666C6F617405016605076D6174685F666E010000004604036164640A0000004E0501610D0501620D010000005D04036D756C0A000000650501610D0501620D010000007604056170706C790A000000820501610501620C02666E0D0D010000009704096475706C69636174650A000000EB0501730C067374726C656E04036C656E010000000105036C656E0C066D616C6C6F6304036F75740B000000E705036F757405044E554C4C0D05036F757405017305036C656E0C066D656D63707905036F75740D0D0100000000040E676C6F62616C5F636F756572010000011004046D61696E0A000003820100000005040161010000000304016404026F6B050B434F4C4F525F475245454E04016301000000030403702E7801000000040403702E79020E506F696E743A2025642025645C6E0503702E780503702E7901000000030360010000002A0403752E69020F556E696F6E20696E743A2025645C6E0503752E6901000000020360010000000104066172725B305D010000000204066172725B315D010000000304066172725B325D010000000404066172725B335D010000000004016905016905036172720C0941525241595F4C454E050169020325642005036172720501690100000005036002025C6E0100000001036005016104027061010000000A0402706102094164643A2025645C6E0100000002010000000305036164640C056170706C790100000002036002094D756C3A2025645C6E0100000002010000000305036D756C0C056170706C7901000000020360020568656C6C6F0C096475706C69636174650404636F70790504636F70790B000002A9020A436F70793A2025735C6E0504636F7079010000000203600504636F70790C0466726565020A64656D6F5F632E747874020177010000000203700401660501660B000002EB050166020B432066696C6520494F5C6E010000000203710501660100000001037205044E554C4C0C0474696D6504036E6F77020854696D653A20257305036E6F770100000001038101000000020360010000000201000000030C034D415801000000030C06617373657274050E676C6F62616C5F636F756E746572020C476C6F62616C3A2025645C6E050E676C6F62616C5F636F756E746572010000000203600208446F6E6520435C6E0100000001036001000000000D0D0C046D61696E00"
        };
    }

    // OPTIMIZATION: Inlined malloc with better memory management and bounds checking
    malloc(size) {
        // BUG FIX: Validate size parameter
        if (size <= 0) {
            if (this.config.debug) console.warn('malloc called with invalid size:', size);
            return 0;
        }

        if (size > this.config.maxMemory) {
            this.throwError(`malloc size ${size} exceeds max memory ${this.config.maxMemory}`);
        }

        let prev = null;
        let curr = this.freeList;
        while (curr) {
            if (curr.size >= size) {
                const addr = curr.addr;
                if (curr.size > size) {
                    curr.addr += size;
                    curr.size -= size;
                } else {
                    if (prev) prev.next = curr.next;
                    else this.freeList = curr.next;
                }
                this.allocatedSizes.set(addr, size);
                if (this.config.debug) console.log(`malloc(${size}) = ${addr} [reused]`);
                return addr;
            }
            prev = curr;
            curr = curr.next;
        }
        const addr = this.heapOffset;
        this.heapOffset += size;
        if (this.heapOffset > this.config.maxMemory) {
            this.throwError(`Out of memory: tried to allocate ${size} bytes, heap at ${this.heapOffset}`);
        }
        this.allocatedSizes.set(addr, size);
        if (this.config.debug) console.log(`malloc(${size}) = ${addr} [new]`);
        return addr;
    }

    free(addr, size) {
        const block = new FreeBlock(addr, size, this.freeList);
        this.freeList = block;
        this.allocatedSizes.delete(addr);
    }

    freeByAddr(addr) {
        const size = this.allocatedSizes.get(addr);
        if (size != null) this.free(addr, size);
    }

    // OPTIMIZATION: Use subarray copy instead of loop
    realloc(ptr, newSize) {
        const oldSize = this.allocatedSizes.get(ptr) || 0;
        const newAddr = this.malloc(newSize);
        const copyLen = Math.min(oldSize, newSize);
        this.memory.set(this.memory.subarray(ptr, ptr + copyLen), newAddr);
        this.freeByAddr(ptr);
        return newAddr;
    }

    async load(res) {
        let buf;
        if (typeof res === 'string') {
            const upRes = res.toUpperCase();
            if (upRes.startsWith('534F554C') || upRes.startsWith('4341534D')) {
                buf = new Uint8Array(res.length / 2);
                for (let i = 0; i < res.length; i += 2) buf[i / 2] = parseInt(res.substr(i, 2), 16);
            } else if (this.isNode) {
                buf = this.fs.readFileSync(res);
            } else {
                const response = await fetch(res);
                buf = new Uint8Array(await response.arrayBuffer());
            }
        } else buf = res;

        // BUG FIX: Validate bytecode header
        if (buf.length < 4) {
            throw new Error('Invalid bytecode: file too small');
        }

        const header = String.fromCharCode(...buf.slice(0, 4));
        if (header !== 'SOUL' && header !== 'CASM') {
            throw new Error(`Invalid bytecode header: expected SOUL or CASM, got ${header}`);
        }

        this.bytecode = new Uint8Array(buf.slice(4));

        // FEATURE: Optional bytecode validation
        if (this.config.validateBytecode) {
            this.validateBytecode();
        }

        if (this.config.debug) {
            console.log(`Loaded bytecode: ${this.bytecode.length} bytes`);
        }
    }

    // FEATURE: Bytecode validation for safety
    validateBytecode() {
        const bc = this.bytecode;
        let pc = 0;
        const validOpcodes = new Set([
            0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09,
            0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10, 0x11, 0x12, 0x13,
            0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x1B, 0x1C, 0x1D,
            0x20, 0x21,
            0x45, 0x46, 0x47, 0x48, 0x49, 0x4A, 0x4B, 0x4C, 0x4D, 0x4E, 0x4F, // i32
            0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5A, // i64
            0x5B, 0x5C, 0x5D, 0x5E, 0x5F, 0x60, // f32
            0x61, 0x62, 0x63, 0x64, 0x65, 0x66, // f64
            0x90, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98,
            0xA0, 0xA1, 0xA2, 0xA3, 0xB0, 0xB1, 0xB2, 0xB3,
            0xC0, 0xC1, 0xC2,
            0xE0, 0xE1, 0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7
        ]);

        while (pc < bc.length) {
            const op = bc[pc++];

            // Check if opcode is valid or in extended range
            if (!validOpcodes.has(op) && op < 0xA8 && op > 0x21 && op < 0x50) {
                console.warn(`Warning: Unknown opcode 0x${op.toString(16)} at position ${pc - 1}`);
            }

            // Skip operands based on opcode
            if (op === 0x01) pc += 4; // PUSH_INT
            else if (op === 0x02 || op === 0x04 || op === 0x05 || op === 0x0C || op === 0x54) {
                if (pc >= bc.length) throw new Error('Bytecode validation failed: unexpected end');
                const len = bc[pc++];
                pc += len;
            }
            else if (op === 0x03) pc++; // SYSCALL
            else if (op === 0x0A || op === 0x0B || op === 0x0E || op === 0x0F) pc += 4; // Jumps
            else if (op === 0xE2 || op === 0xE3) pc++; // Memory ops with size

            if (pc > bc.length) {
                throw new Error(`Bytecode validation failed: PC ${pc} exceeds bytecode length ${bc.length}`);
            }
        }

        if (this.config.debug) {
            console.log('Bytecode validation passed');
        }
    }

    // OPTIMIZATION: Fully inlined execution loop with pre-allocated stack
    run() {
        this.running = true;
        this.pc = 0;
        const bc = this.bytecode;
        const len = bc.length;
        const stack = this.stack;
        const frames = this.frames;
        const variables = this.variables;
        const mem = this.memory;
        const view = new DataView(mem.buffer);
        let sp = this.sp;

        while (this.running && this.pc < len) {
            const op = bc[this.pc++];

            // FEATURE: Debug mode with instruction tracing
            if (this.config.debug && this.instructionCount % 1000 === 0) {
                console.log(`[${this.instructionCount}] PC:${this.pc - 1} OP:0x${op.toString(16)} SP:${sp}`);
            }
            this.instructionCount++;

            switch (op) {
                case 0x00: // HALT
                    this.running = false;
                    break;

                case 0x01: // PUSH_INT - Inlined for speed
                    stack[sp++] = (bc[this.pc++] << 24) | (bc[this.pc++] << 16) | (bc[this.pc++] << 8) | bc[this.pc++];
                    break;

                case 0x02: // PUSH_STR - Uses TextDecoder with string interning
                    {
                        const l = bc[this.pc++];
                        // OPTIMIZATION: Use string interning for better performance
                        stack[sp++] = this.internString(bc, this.pc, l);
                        this.pc += l;
                    }
                    break;

                case 0x03: // SYSCALL
                    this.sp = sp;
                    this.handleSyscall(bc[this.pc++]);
                    sp = this.sp;
                    break;

                case 0x04: // STORE
                    {
                        const l = bc[this.pc++];
                        const n = this.internString(bc, this.pc, l);
                        this.pc += l;
                        frames[frames.length - 1].set(n, stack[--sp]);
                    }
                    break;

                case 0x05: // LOAD
                    {
                        const l = bc[this.pc++];
                        const n = this.internString(bc, this.pc, l);
                        this.pc += l;
                        let val = undefined;
                        for (let i = frames.length - 1; i >= 0; i--) {
                            if (frames[i].has(n)) { val = frames[i].get(n); break; }
                        }
                        if (val === undefined) val = variables.get(n);
                        if (val === undefined && this.config.debug) {
                            console.warn(`Undefined variable: ${n}`);
                        }
                        stack[sp++] = val;
                    }
                    break;

                // OPTIMIZATION: In-place arithmetic operations
                case 0x06: // ADD
                    { const b = stack[--sp]; stack[sp - 1] += b; }
                    break;
                case 0x07: // SUB
                    { const b = stack[--sp]; stack[sp - 1] -= b; }
                    break;
                case 0x08: // MUL
                    { const b = stack[--sp]; stack[sp - 1] *= b; }
                    break;
                case 0x09: // DIV
                    {
                        const b = stack[--sp];
                        // BUG FIX: Better division by zero handling
                        if (b === 0) {
                            if (this.config.debug) console.warn('Division by zero at PC', this.pc);
                            stack[sp - 1] = 0;
                        } else {
                            stack[sp - 1] = Math.floor(stack[sp - 1] / b);
                        }
                    }
                    break;
                case 0x12: // MOD
                    { const b = stack[--sp]; stack[sp - 1] = b !== 0 ? stack[sp - 1] % b : 0; }
                    break;

                // WASM-like: Stack Manipulation Opcodes
                case 0x22: // NEG - Negate top of stack
                    stack[sp - 1] = -stack[sp - 1];
                    break;
                case 0x23: // INC - Increment top of stack
                    stack[sp - 1]++;
                    break;
                case 0x24: // DEC - Decrement top of stack
                    stack[sp - 1]--;
                    break;
                case 0x25: // ABS - Absolute value
                    stack[sp - 1] = Math.abs(stack[sp - 1]);
                    break;
                case 0x26: // MIN - Minimum of two values
                    { const b = stack[--sp]; stack[sp - 1] = Math.min(stack[sp - 1], b); }
                    break;
                case 0x27: // MAX - Maximum of two values
                    { const b = stack[--sp]; stack[sp - 1] = Math.max(stack[sp - 1], b); }
                    break;
                case 0x28: // CLAMP - Clamp value between min and max
                    {
                        const max = stack[--sp];
                        const min = stack[--sp];
                        const val = stack[sp - 1];
                        stack[sp - 1] = Math.max(min, Math.min(max, val));
                    }
                    break;

                // WASM-like: Type Conversion Opcodes
                case 0x29: // I32_TO_F32 - Int to float
                    stack[sp - 1] = parseFloat(stack[sp - 1]);
                    break;
                case 0x2A: // F32_TO_I32 - Float to int
                    stack[sp - 1] = Math.floor(stack[sp - 1]);
                    break;
                case 0x2B: // I32_TO_I64 - Int to long (stored as number in JS)
                    stack[sp - 1] = BigInt(Math.floor(stack[sp - 1]));
                    break;
                case 0x2C: // I64_TO_I32 - Long to int
                    stack[sp - 1] = Number(stack[sp - 1]) | 0;
                    break;

                // WASM-like: Stack Manipulation
                case 0x2D: // DUP - Duplicate top of stack
                    stack[sp] = stack[sp - 1];
                    sp++;
                    break;
                case 0x2E: // SWAP - Swap top two items
                    {
                        const tmp = stack[sp - 1];
                        stack[sp - 1] = stack[sp - 2];
                        stack[sp - 2] = tmp;
                    }
                    break;
                case 0x2F: // ROT - Rotate top three items (a b c -> b c a)
                    {
                        const c = stack[sp - 1];
                        const b = stack[sp - 2];
                        const a = stack[sp - 3];
                        stack[sp - 3] = b;
                        stack[sp - 2] = c;
                        stack[sp - 1] = a;
                    }
                    break;
                case 0x30: // DROP - Drop top of stack
                    sp--;
                    break;
                case 0x31: // PICK - Copy nth item to top (0 = top, 1 = second, etc.)
                    {
                        const n = stack[--sp];
                        if (n >= 0 && sp - n - 1 >= 0) {
                            stack[sp++] = stack[sp - n - 1];
                        } else {
                            if (this.config.debug) console.warn('PICK: invalid index', n);
                            stack[sp++] = 0;
                        }
                    }
                    break;

                case 0x0A: // JMP - Inlined
                    this.pc = (bc[this.pc] << 24) | (bc[this.pc + 1] << 16) | (bc[this.pc + 2] << 8) | bc[this.pc + 3];
                    break;

                case 0x0B: // JZ - Inlined
                    {
                        const cond = stack[--sp];
                        const target = (bc[this.pc] << 24) | (bc[this.pc + 1] << 16) | (bc[this.pc + 2] << 8) | bc[this.pc + 3];
                        this.pc = cond ? this.pc + 4 : target;
                    }
                    break;

                case 0x0C: // CALL
                    {
                        const l = bc[this.pc++];
                        const name = l > 0 ? this.internString(bc, this.pc, l) : '';
                        this.pc += l;
                        let target = undefined;

                        if (name === '') {
                            // Indirect call: function address is on stack
                            target = stack[--sp];
                        } else {
                            for (let i = frames.length - 1; i >= 0; i--) {
                                if (frames[i].has(name)) { target = frames[i].get(name); break; }
                            }
                            if (target === undefined) target = variables.get(name);
                        }

                        if (typeof target === 'function') {
                            this.sp = sp;
                            const r = target.call(this);
                            sp = this.sp;
                            if (r !== undefined) stack[sp++] = r;
                        } else if (target !== undefined) {
                            // BUG FIX: Stack overflow protection
                            if (this.callStack.length >= this.config.maxCallDepth) {
                                this.sp = sp;
                                this.throwError(`Stack overflow: call depth exceeded ${this.config.maxCallDepth}`);
                            }
                            frames.push(new Map());
                            this.callStack.push(this.pc);
                            this.pc = target;
                            if (this.config.debug) console.log(`CALL ${name} -> ${target}`);
                        } else {
                            this.sp = sp;
                            this.throwError("Undefined function: " + (name || '<indirect>'));
                        }
                    }
                    break;

                case 0x0D: // RET
                    frames.pop();
                    this.pc = this.callStack.pop();
                    break;

                case 0x0E: // FOR_ITER
                    {
                        const target = (bc[this.pc] << 24) | (bc[this.pc + 1] << 16) | (bc[this.pc + 2] << 8) | bc[this.pc + 3];
                        this.pc += 4;
                        let iter = stack[sp - 1];
                        if (!iter || typeof iter.next !== 'function') {
                            const val = stack[--sp];
                            iter = (Array.isArray(val) || typeof val === 'string') ? val[Symbol.iterator]() : val;
                            stack[sp++] = iter;
                        }
                        const r = iter.next();
                        if (!r.done) {
                            stack[sp++] = r.value;
                        } else {
                            sp--;
                            this.pc = target;
                        }
                    }
                    break;

                case 0x0F: // TRY_ENTER
                    {
                        const handler = (bc[this.pc] << 24) | (bc[this.pc + 1] << 16) | (bc[this.pc + 2] << 8) | bc[this.pc + 3];
                        this.pc += 4;
                        this.tryStack.push({ handler, sp });
                    }
                    break;

                case 0x10: // TRY_EXIT
                    this.tryStack.pop();
                    break;

                case 0x11: // RAISE
                    {
                        const err = stack[--sp];
                        if (this.tryStack.length) {
                            const h = this.tryStack.pop();
                            sp = h.sp;
                            stack[sp++] = err;
                            this.pc = h.handler;
                        } else {
                            console.error("Unhandled exception: " + err);
                            this.running = false;
                        }
                    }
                    break;

                // Bitwise operations - in-place
                case 0x13: { const b = stack[--sp]; stack[sp - 1] <<= b; } break; // LSHIFT
                case 0x14: { const b = stack[--sp]; stack[sp - 1] >>= b; } break; // RSHIFT
                case 0x15: { const b = stack[--sp]; stack[sp - 1] &= b; } break;  // BIT_AND
                case 0x16: { const b = stack[--sp]; stack[sp - 1] |= b; } break;  // BIT_OR
                case 0x17: { const b = stack[--sp]; stack[sp - 1] ^= b; } break;  // BIT_XOR
                case 0x18: stack[sp - 1] = ~stack[sp - 1]; break;                 // BIT_NOT

                // Comparison operations - in-place
                case 0x19: { const b = stack[--sp]; stack[sp - 1] = (stack[sp - 1] === b ? 1 : 0); } break; // EQ
                case 0x1A: { const b = stack[--sp]; stack[sp - 1] = (stack[sp - 1] !== b ? 1 : 0); } break; // NE
                case 0x1B: { const b = stack[--sp]; stack[sp - 1] = (stack[sp - 1] < b ? 1 : 0); } break;   // LT
                case 0x1C: { const b = stack[--sp]; stack[sp - 1] = (stack[sp - 1] <= b ? 1 : 0); } break;  // LE
                case 0x1D: { const b = stack[--sp]; stack[sp - 1] = (stack[sp - 1] > b ? 1 : 0); } break;   // GT
                case 0x1E: { const b = stack[--sp]; stack[sp - 1] = (stack[sp - 1] >= b ? 1 : 0); } break;  // GE

                // Logical operations - in-place
                case 0x1F: { const b = stack[--sp]; stack[sp - 1] = (stack[sp - 1] && b ? 1 : 0); } break;  // LOGIC_AND
                case 0x20: { const b = stack[--sp]; stack[sp - 1] = (stack[sp - 1] || b ? 1 : 0); } break;  // LOGIC_OR
                case 0x21: stack[sp - 1] = (stack[sp - 1] ? 0 : 1); break;                                  // LOGIC_NOT

                // WASM i32 Comparisons (0x45 range)
                case 0x45: // i32.eqz
                    stack[sp - 1] = ((stack[sp - 1] | 0) === 0) ? 1 : 0;
                    break;
                case 0x46: // i32.eq
                    { const b = stack[--sp] | 0; stack[sp - 1] = ((stack[sp - 1] | 0) === b) ? 1 : 0; }
                    break;
                case 0x47: // i32.ne
                    { const b = stack[--sp] | 0; stack[sp - 1] = ((stack[sp - 1] | 0) !== b) ? 1 : 0; }
                    break;
                case 0x48: // i32.lt_s
                    { const b = stack[--sp] | 0; stack[sp - 1] = ((stack[sp - 1] | 0) < b) ? 1 : 0; }
                    break;
                case 0x49: // i32.lt_u
                    { const b = stack[--sp] >>> 0; stack[sp - 1] = ((stack[sp - 1] >>> 0) < b) ? 1 : 0; }
                    break;
                case 0x4A: // i32.gt_s
                    { const b = stack[--sp] | 0; stack[sp - 1] = ((stack[sp - 1] | 0) > b) ? 1 : 0; }
                    break;
                case 0x4B: // i32.gt_u
                    { const b = stack[--sp] >>> 0; stack[sp - 1] = ((stack[sp - 1] >>> 0) > b) ? 1 : 0; }
                    break;
                case 0x4C: // i32.le_s
                    { const b = stack[--sp] | 0; stack[sp - 1] = ((stack[sp - 1] | 0) <= b) ? 1 : 0; }
                    break;
                case 0x4D: // i32.le_u
                    { const b = stack[--sp] >>> 0; stack[sp - 1] = ((stack[sp - 1] >>> 0) <= b) ? 1 : 0; }
                    break;
                case 0x4E: // i32.ge_s
                    { const b = stack[--sp] | 0; stack[sp - 1] = ((stack[sp - 1] | 0) >= b) ? 1 : 0; }
                    break;
                case 0x4F: // i32.ge_u
                    { const b = stack[--sp] >>> 0; stack[sp - 1] = ((stack[sp - 1] >>> 0) >= b) ? 1 : 0; }
                    break;

                // WASM i64 Comparisons (0x51 range)
                // Note: We treat stack values as Numbers or BigInts. 
                // JS Bitwise operators treat numbers as 32-bit ints, so we use BigInt for 64-bit safety.
                case 0x50: // i64.eqz
                    stack[sp - 1] = (BigInt(stack[sp - 1]) === 0n) ? 1 : 0;
                    break;
                case 0x51: // i64.eq
                    { const b = BigInt(stack[--sp]); const a = BigInt(stack[sp - 1]); stack[sp - 1] = (a === b) ? 1 : 0; }
                    break;
                case 0x52: // i64.ne
                    { const b = BigInt(stack[--sp]); const a = BigInt(stack[sp - 1]); stack[sp - 1] = (a !== b) ? 1 : 0; }
                    break;
                case 0x53: // i64.lt_s (signed)
                    { const b = BigInt(stack[--sp]); const a = BigInt(stack[sp - 1]); stack[sp - 1] = (a < b) ? 1 : 0; }
                    break;
                case 0x54: // i64.lt_u (unsigned)
                    {
                        const b = BigInt(stack[--sp]); const a = BigInt(stack[sp - 1]);
                        const ua = a >= 0n ? a : a + 0x10000000000000000n; // rudimentary unsigned cast for verification
                        const ub = b >= 0n ? b : b + 0x10000000000000000n;
                        stack[sp - 1] = (ua < ub) ? 1 : 0;
                    }
                    break;
                case 0x55: // i64.gt_s
                    { const b = BigInt(stack[--sp]); const a = BigInt(stack[sp - 1]); stack[sp - 1] = (a > b) ? 1 : 0; }
                    break;
                case 0x56: // i64.gt_u
                    {
                        const b = BigInt(stack[--sp]); const a = BigInt(stack[sp - 1]);
                        const ua = a >= 0n ? a : a + 0x10000000000000000n;
                        const ub = b >= 0n ? b : b + 0x10000000000000000n;
                        stack[sp - 1] = (ua > ub) ? 1 : 0;
                    }
                    break;
                case 0x57: // i64.le_s
                    { const b = BigInt(stack[--sp]); const a = BigInt(stack[sp - 1]); stack[sp - 1] = (a <= b) ? 1 : 0; }
                    break;
                case 0x58: // i64.le_u
                    {
                        const b = BigInt(stack[--sp]); const a = BigInt(stack[sp - 1]);
                        const ua = a >= 0n ? a : a + 0x10000000000000000n;
                        const ub = b >= 0n ? b : b + 0x10000000000000000n;
                        stack[sp - 1] = (ua <= ub) ? 1 : 0;
                    }
                    break;
                case 0x59: // i64.ge_s
                    { const b = BigInt(stack[--sp]); const a = BigInt(stack[sp - 1]); stack[sp - 1] = (a >= b) ? 1 : 0; }
                    break;
                case 0x5A: // i64.ge_u
                    {
                        const b = BigInt(stack[--sp]); const a = BigInt(stack[sp - 1]);
                        const ua = a >= 0n ? a : a + 0x10000000000000000n;
                        const ub = b >= 0n ? b : b + 0x10000000000000000n;
                        stack[sp - 1] = (ua >= ub) ? 1 : 0;
                    }
                    break;

                // WASM f32 Comparisons (0x5B range)
                case 0x5B: // f32.eq
                    { const b = Math.fround(stack[--sp]); stack[sp - 1] = (Math.fround(stack[sp - 1]) === b) ? 1 : 0; }
                    break;
                case 0x5C: // f32.ne
                    { const b = Math.fround(stack[--sp]); stack[sp - 1] = (Math.fround(stack[sp - 1]) !== b) ? 1 : 0; }
                    break;
                case 0x5D: // f32.lt
                    { const b = Math.fround(stack[--sp]); stack[sp - 1] = (Math.fround(stack[sp - 1]) < b) ? 1 : 0; }
                    break;
                case 0x5E: // f32.gt
                    { const b = Math.fround(stack[--sp]); stack[sp - 1] = (Math.fround(stack[sp - 1]) > b) ? 1 : 0; }
                    break;
                case 0x5F: // f32.le
                    { const b = Math.fround(stack[--sp]); stack[sp - 1] = (Math.fround(stack[sp - 1]) <= b) ? 1 : 0; }
                    break;
                case 0x60: // f32.ge
                    { const b = Math.fround(stack[--sp]); stack[sp - 1] = (Math.fround(stack[sp - 1]) >= b) ? 1 : 0; }
                    break;

                // WASM f64 Comparisons (0x61 range)
                case 0x61: // f64.eq
                    { const b = stack[--sp]; stack[sp - 1] = (stack[sp - 1] === b) ? 1 : 0; }
                    break;
                case 0x62: // f64.ne
                    { const b = stack[--sp]; stack[sp - 1] = (stack[sp - 1] !== b) ? 1 : 0; }
                    break;
                case 0x63: // f64.lt
                    { const b = stack[--sp]; stack[sp - 1] = (stack[sp - 1] < b) ? 1 : 0; }
                    break;
                case 0x64: // f64.gt
                    { const b = stack[--sp]; stack[sp - 1] = (stack[sp - 1] > b) ? 1 : 0; }
                    break;
                case 0x65: // f64.le
                    { const b = stack[--sp]; stack[sp - 1] = (stack[sp - 1] <= b) ? 1 : 0; }
                    break;
                case 0x66: // f64.ge
                    { const b = stack[--sp]; stack[sp - 1] = (stack[sp - 1] >= b) ? 1 : 0; }
                    break;

                // Memory operations (Relocated to 0xE0 range)
                case 0xE0: // MALLOC
                    stack[sp - 1] = this.malloc(stack[sp - 1]);
                    break;
                case 0xE1: // FREE
                    this.freeByAddr(stack[--sp]);
                    break;

                case 0xE2: // READ_ADDR
                    {
                        const sz = bc[this.pc++];
                        const idx = stack[--sp];
                        const a = stack[--sp];
                        if (typeof a === 'object' || Array.isArray(a) || typeof a === 'string') {
                            stack[sp++] = a[idx];
                        } else {
                            // BUG FIX: Memory bounds checking
                            const addr = sz === 1 ? a + idx : (sz === 8 ? a + idx * 8 : a + idx * 4);
                            if (addr < 0 || addr >= this.config.maxMemory) {
                                this.sp = sp;
                                this.throwError(`Memory read out of bounds: address ${addr}`);
                            }
                            if (sz === 1) {
                                stack[sp++] = mem[a + idx];
                            } else if (sz === 8) {
                                stack[sp++] = view.getFloat64(a + idx * 8, true);
                            } else {
                                stack[sp++] = view.getInt32(a + idx * 4, true);
                            }
                        }
                    }
                    break;

                case 0xE3: // WRITE_ADDR
                    {
                        const sz = bc[this.pc++];
                        const v = stack[--sp];
                        const idx = stack[--sp];
                        const a = stack[--sp];
                        if (typeof a === 'object' || Array.isArray(a)) {
                            a[idx] = v;
                        } else {
                            // BUG FIX: Memory bounds checking
                            const addr = sz === 1 ? a + idx : (sz === 8 ? a + idx * 8 : a + idx * 4);
                            if (addr < 0 || addr >= this.config.maxMemory) {
                                this.sp = sp;
                                this.throwError(`Memory write out of bounds: address ${addr}`);
                            }
                            if (sz === 1) {
                                mem[a + idx] = v & 0xFF;
                            } else if (sz === 8) {
                                view.setFloat64(a + idx * 8, v, true);
                            } else {
                                view.setInt32(a + idx * 4, v, true);
                            }
                        }
                    }
                    break;

                case 0xE4: // ADDR_OF
                    {
                        const l = bc[this.pc++];
                        stack[sp++] = this.decoder.decode(bc.subarray(this.pc, this.pc + l));
                        this.pc += l;
                    }
                    break;

                // WASM-like: Enhanced Memory Operations (Relocated)
                case 0xE5: // MEMORY_SIZE - Get memory size in pages (64KB pages)
                    stack[sp++] = Math.floor(this.config.maxMemory / 65536);
                    break;
                case 0xE6: // MEMORY_GROW - Grow memory by N pages
                    {
                        const pages = stack[--sp];
                        const oldPages = Math.floor(this.config.maxMemory / 65536);
                        const newSize = this.config.maxMemory + (pages * 65536);
                        if (newSize <= 16777216) { // Max 256 pages (16MB)
                            this.config.maxMemory = newSize;
                            const newMem = new Uint8Array(newSize);
                            newMem.set(this.memory);
                            this.memory = newMem;
                            stack[sp++] = oldPages;
                        } else {
                            stack[sp++] = -1; // Failed
                        }
                    }
                    break;
                case 0xE7: // MEMORY_COPY - Optimized memory copy (dest, src, n)
                    {
                        const n = stack[--sp];
                        const src = stack[--sp];
                        const dest = stack[--sp];
                        if (dest >= 0 && src >= 0 && dest + n <= this.config.maxMemory && src + n <= this.config.maxMemory) {
                            this.memory.copyWithin(dest, src, src + n);
                        } else if (this.config.debug) {
                            console.warn('MEMORY_COPY: out of bounds');
                        }
                    }
                    break;
                case 0x5E: // MEMORY_FILL - Fill memory with value (addr, value, n)
                    {
                        const n = stack[--sp];
                        const value = stack[--sp] & 0xFF;
                        const addr = stack[--sp];
                        if (addr >= 0 && addr + n <= this.config.maxMemory) {
                            this.memory.fill(value, addr, addr + n);
                        } else if (this.config.debug) {
                            console.warn('MEMORY_FILL: out of bounds');
                        }
                    }
                    break;

                // WASM-like: Typed Memory Access
                case 0x5F: // LOAD_I8 - Load signed 8-bit
                    {
                        const addr = stack[--sp];
                        if (addr >= 0 && addr < this.config.maxMemory) {
                            const val = mem[addr];
                            stack[sp++] = val > 127 ? val - 256 : val; // Sign extend
                        } else {
                            this.sp = sp;
                            this.throwError(`LOAD_I8: address ${addr} out of bounds`);
                        }
                    }
                    break;
                case 0x61: // LOAD_I16 - Load signed 16-bit
                    {
                        const addr = stack[--sp];
                        if (addr >= 0 && addr + 1 < this.config.maxMemory) {
                            stack[sp++] = view.getInt16(addr, true);
                        } else {
                            this.sp = sp;
                            this.throwError(`LOAD_I16: address ${addr} out of bounds`);
                        }
                    }
                    break;
                case 0x62: // LOAD_U16 - Load unsigned 16-bit
                    {
                        const addr = stack[--sp];
                        if (addr >= 0 && addr + 1 < this.config.maxMemory) {
                            stack[sp++] = view.getUint16(addr, true);
                        } else {
                            this.sp = sp;
                            this.throwError(`LOAD_U16: address ${addr} out of bounds`);
                        }
                    }
                    break;
                case 0x64: // LOAD_F32 - Load 32-bit float
                    {
                        const addr = stack[--sp];
                        if (addr >= 0 && addr + 3 < this.config.maxMemory) {
                            stack[sp++] = view.getFloat32(addr, true);
                        } else {
                            this.sp = sp;
                            this.throwError(`LOAD_F32: address ${addr} out of bounds`);
                        }
                    }
                    break;
                case 0x65: // LOAD_F64 - Load 64-bit float
                    {
                        const addr = stack[--sp];
                        if (addr >= 0 && addr + 7 < this.config.maxMemory) {
                            stack[sp++] = view.getFloat64(addr, true);
                        } else {
                            this.sp = sp;
                            this.throwError(`LOAD_F64: address ${addr} out of bounds`);
                        }
                    }
                    break;
                case 0x66: // STORE_I8 - Store 8-bit
                    {
                        const value = stack[--sp];
                        const addr = stack[--sp];
                        if (addr >= 0 && addr < this.config.maxMemory) {
                            mem[addr] = value & 0xFF;
                        } else {
                            this.sp = sp;
                            this.throwError(`STORE_I8: address ${addr} out of bounds`);
                        }
                    }
                    break;
                case 0x67: // STORE_I16 - Store 16-bit
                    {
                        const value = stack[--sp];
                        const addr = stack[--sp];
                        if (addr >= 0 && addr + 1 < this.config.maxMemory) {
                            view.setInt16(addr, value, true);
                        } else {
                            this.sp = sp;
                            this.throwError(`STORE_I16: address ${addr} out of bounds`);
                        }
                    }
                    break;
                case 0x68: // STORE_I32 - Store 32-bit
                    {
                        const value = stack[--sp];
                        const addr = stack[--sp];
                        if (addr >= 0 && addr + 3 < this.config.maxMemory) {
                            view.setInt32(addr, value, true);
                        } else {
                            this.sp = sp;
                            this.throwError(`STORE_I32: address ${addr} out of bounds`);
                        }
                    }
                    break;
                case 0x69: // STORE_F32 - Store 32-bit float
                    {
                        const value = stack[--sp];
                        const addr = stack[--sp];
                        if (addr >= 0 && addr + 3 < this.config.maxMemory) {
                            view.setFloat32(addr, value, true);
                        } else {
                            this.sp = sp;
                            this.throwError(`STORE_F32: address ${addr} out of bounds`);
                        }
                    }
                    break;
                case 0x6A: // STORE_F64 - Store 64-bit float
                    {
                        const value = stack[--sp];
                        const addr = stack[--sp];
                        if (addr >= 0 && addr + 7 < this.config.maxMemory) {
                            view.setFloat64(addr, value, true);
                        } else {
                            this.sp = sp;
                            this.throwError(`STORE_F64: address ${addr} out of bounds`);
                        }
                    }
                    break;

                // WASM-like: Advanced Control Flow
                case 0x6B: // JNZ - Jump if not zero
                    {
                        const cond = stack[--sp];
                        const target = (bc[this.pc] << 24) | (bc[this.pc + 1] << 16) | (bc[this.pc + 2] << 8) | bc[this.pc + 3];
                        this.pc = cond ? target : this.pc + 4;
                    }
                    break;
                case 0x6C: // JGT - Jump if greater than zero
                    {
                        const val = stack[--sp];
                        const target = (bc[this.pc] << 24) | (bc[this.pc + 1] << 16) | (bc[this.pc + 2] << 8) | bc[this.pc + 3];
                        this.pc = val > 0 ? target : this.pc + 4;
                    }
                    break;
                case 0x6D: // JLT - Jump if less than zero
                    {
                        const val = stack[--sp];
                        const target = (bc[this.pc] << 24) | (bc[this.pc + 1] << 16) | (bc[this.pc + 2] << 8) | bc[this.pc + 3];
                        this.pc = val < 0 ? target : this.pc + 4;
                    }
                    break;

                // WASM-like: Function Tables
                case 0x58: // TABLE_GET - Get function from table (index on stack)
                    {
                        const idx = stack[--sp];
                        if (idx >= 0 && idx < this.functionTable.length) {
                            stack[sp++] = this.functionTable[idx];
                        } else {
                            if (this.config.debug) console.warn('TABLE_GET: index out of bounds', idx);
                            stack[sp++] = null;
                        }
                    }
                    break;
                case 0x59: // TABLE_SET - Set function in table (index, funcAddr on stack)
                    {
                        const funcAddr = stack[--sp];
                        const idx = stack[--sp];
                        if (idx >= 0 && idx < this.tableSize) {
                            this.functionTable[idx] = funcAddr;
                        } else if (this.config.debug) {
                            console.warn('TABLE_SET: index out of bounds', idx);
                        }
                    }
                    break;
                case 0x5A: // CALL_INDIRECT - Call function via table index
                    {
                        const idx = stack[--sp];
                        if (idx >= 0 && idx < this.functionTable.length) {
                            const funcAddr = this.functionTable[idx];
                            if (typeof funcAddr === 'number') {
                                // Stack overflow protection
                                if (this.callStack.length >= this.config.maxCallDepth) {
                                    this.sp = sp;
                                    this.throwError(`Stack overflow: call depth exceeded ${this.config.maxCallDepth}`);
                                }
                                frames.push(new Map());
                                this.callStack.push(this.pc);
                                this.pc = funcAddr;
                                if (this.config.debug) console.log(`CALL_INDIRECT [${idx}] -> ${funcAddr}`);
                            } else if (this.config.debug) {
                                console.warn('CALL_INDIRECT: invalid function address', funcAddr);
                            }
                        } else if (this.config.debug) {
                            console.warn('CALL_INDIRECT: index out of bounds', idx);
                        }
                    }
                    break;

                // WASM-like: Module System
                case 0x55: // EXPORT - Mark function/variable for export (name on stack)
                    {
                        const l = bc[this.pc++];
                        const name = this.internString(bc, this.pc, l);
                        this.pc += l;
                        const value = stack[--sp];
                        this.exports.set(name, value);
                        if (this.config.debug) console.log(`EXPORT: ${name} = ${value}`);
                    }
                    break;
                case 0x56: // IMPORT - Import from module (module name, export name on stack)
                    {
                        const exportNameLen = bc[this.pc++];
                        const exportName = this.internString(bc, this.pc, exportNameLen);
                        this.pc += exportNameLen;
                        const moduleNameLen = bc[this.pc++];
                        const moduleName = this.internString(bc, this.pc, moduleNameLen);
                        this.pc += moduleNameLen;

                        const module = this.modules.get(moduleName);
                        if (module && module.exports.has(exportName)) {
                            stack[sp++] = module.exports.get(exportName);
                        } else {
                            if (this.config.debug) console.warn(`IMPORT: ${moduleName}.${exportName} not found`);
                            stack[sp++] = null;
                        }
                    }
                    break;
                case 0x57: // MODULE_GET - Get exported value from current exports
                    {
                        const l = bc[this.pc++];
                        const name = this.internString(bc, this.pc, l);
                        this.pc += l;
                        if (this.exports.has(name)) {
                            stack[sp++] = this.exports.get(name);
                        } else {
                            if (this.config.debug) console.warn(`MODULE_GET: ${name} not exported`);
                            stack[sp++] = null;
                        }
                    }
                    break;

                // WASM-like: Type System
                case 0x74: // TYPE_OF - Get type of value on stack
                    {
                        const val = stack[sp - 1];
                        let type = 'unknown';
                        if (typeof val === 'number') {
                            type = Number.isInteger(val) ? 'i32' : 'f64';
                        } else if (typeof val === 'bigint') {
                            type = 'i64';
                        } else if (typeof val === 'string') {
                            type = 'string';
                        } else if (typeof val === 'boolean') {
                            type = 'bool';
                        } else if (Array.isArray(val)) {
                            type = 'array';
                        } else if (typeof val === 'function') {
                            type = 'function';
                        } else if (val === null || val === undefined) {
                            type = 'null';
                        } else if (typeof val === 'object') {
                            type = 'object';
                        }
                        stack[sp - 1] = type;
                    }
                    break;
                case 0x75: // TYPE_CHECK - Assert type (type name as string operand)
                    {
                        const l = bc[this.pc++];
                        const expectedType = this.internString(bc, this.pc, l);
                        this.pc += l;
                        const val = stack[sp - 1];

                        let actualType = 'unknown';
                        if (typeof val === 'number') {
                            actualType = Number.isInteger(val) ? 'i32' : 'f64';
                        } else if (typeof val === 'bigint') {
                            actualType = 'i64';
                        } else if (typeof val === 'string') {
                            actualType = 'string';
                        } else if (typeof val === 'boolean') {
                            actualType = 'bool';
                        } else if (Array.isArray(val)) {
                            actualType = 'array';
                        }

                        if (actualType !== expectedType) {
                            this.sp = sp;
                            this.throwError(`Type check failed: expected ${expectedType}, got ${actualType}`);
                        }
                    }
                    break;
                case 0x76: // TYPE_CAST - Cast to type (type name as string operand)
                    {
                        const l = bc[this.pc++];
                        const targetType = this.internString(bc, this.pc, l);
                        this.pc += l;
                        const val = stack[sp - 1];

                        switch (targetType) {
                            case 'i32':
                                stack[sp - 1] = Math.floor(Number(val)) | 0;
                                break;
                            case 'i64':
                                stack[sp - 1] = BigInt(Math.floor(Number(val)));
                                break;
                            case 'f32':
                            case 'f64':
                                stack[sp - 1] = Number(val);
                                break;
                            case 'string':
                                stack[sp - 1] = String(val);
                                break;
                            case 'bool':
                                stack[sp - 1] = val ? 1 : 0;
                                break;
                            default:
                                if (this.config.debug) console.warn(`TYPE_CAST: unknown type ${targetType}`);
                        }
                    }
                    break;

                // WASM-like: Profiling and Debugging
                case 0x77: // PROFILE_START - Start profiling section (name as operand)
                    {
                        const l = bc[this.pc++];
                        const name = this.internString(bc, this.pc, l);
                        this.pc += l;
                        if (this.config.debug) {
                            console.log(`[PROFILE START] ${name} at PC ${this.pc}`);
                            stack[sp++] = Date.now(); // Push start time
                        }
                    }
                    break;
                case 0x78: // PROFILE_END - End profiling section (pops start time)
                    {
                        if (this.config.debug) {
                            const startTime = stack[--sp];
                            const elapsed = Date.now() - startTime;
                            console.log(`[PROFILE END] Elapsed: ${elapsed}ms`);
                        }
                    }
                    break;
                case 0x79: // BREAKPOINT - Debugger breakpoint
                    {
                        if (this.config.debug) {
                            console.log(`[BREAKPOINT] PC:${this.pc} SP:${sp} Stack:`, stack.slice(Math.max(0, sp - 5), sp));
                            debugger; // Triggers debugger if attached
                        }
                    }
                    break;
                case 0x7A: // TRACE - Trace execution (message as operand)
                    {
                        const l = bc[this.pc++];
                        const message = this.internString(bc, this.pc, l);
                        this.pc += l;
                        if (this.config.debug) {
                            console.log(`[TRACE] ${message} | PC:${this.pc} SP:${sp}`);
                        }
                    }
                    break;

                // WASM-like: Atomic Operations (for future multi-threading support)
                case 0x7B: // ATOMIC_LOAD - Atomic load (address on stack)
                    {
                        const addr = stack[--sp];
                        if (addr >= 0 && addr + 3 < this.config.maxMemory) {
                            // In single-threaded JS, this is just a regular load
                            stack[sp++] = view.getInt32(addr, true);
                        } else {
                            this.sp = sp;
                            this.throwError(`ATOMIC_LOAD: address ${addr} out of bounds`);
                        }
                    }
                    break;
                case 0x7C: // ATOMIC_STORE - Atomic store (addr, value on stack)
                    {
                        const value = stack[--sp];
                        const addr = stack[--sp];
                        if (addr >= 0 && addr + 3 < this.config.maxMemory) {
                            // In single-threaded JS, this is just a regular store
                            view.setInt32(addr, value, true);
                        } else {
                            this.sp = sp;
                            this.throwError(`ATOMIC_STORE: address ${addr} out of bounds`);
                        }
                    }
                    break;
                case 0x7D: // ATOMIC_ADD - Atomic add (addr, value on stack, returns old value)
                    {
                        const value = stack[--sp];
                        const addr = stack[--sp];
                        if (addr >= 0 && addr + 3 < this.config.maxMemory) {
                            const oldValue = view.getInt32(addr, true);
                            view.setInt32(addr, oldValue + value, true);
                            stack[sp++] = oldValue;
                        } else {
                            this.sp = sp;
                            this.throwError(`ATOMIC_ADD: address ${addr} out of bounds`);
                        }
                    }
                    break;

                // Collections
                case 0x90: stack[sp++] = new Set(); break; // SET_NEW
                case 0x91: { const v = stack[--sp]; const s = stack[sp - 1]; if (s instanceof Set) s.add(v); } break; // SET_ADD
                case 0x92: stack[sp++] = new Map(); break; // DICT_NEW
                case 0x93: { const v = stack[--sp]; const k = stack[--sp]; const d = stack[sp - 1]; if (d instanceof Map) d.set(k, v); } break; // DICT_SET
                case 0x94: { const k = stack[--sp]; const d = stack[--sp]; stack[sp++] = d instanceof Map ? d.get(k) : undefined; } break; // DICT_GET
                case 0x95: stack[sp++] = []; break; // LIST_NEW
                case 0x96: { const v = stack[--sp]; const l = stack[sp - 1]; if (Array.isArray(l)) l.push(v); } break; // LIST_APPEND
                case 0x97: { const l = stack[--sp]; stack[sp++] = Array.isArray(l) ? l.shift() : undefined; } break; // LIST_SHIFT
                case 0x98: { const l = stack[--sp]; stack[sp++] = Array.isArray(l) ? l.pop() : undefined; } break; // LIST_POP

                // Strings
                case 0xA0: stack[sp - 1] = String(stack[sp - 1]).toLowerCase(); break;
                case 0xA1: stack[sp - 1] = String(stack[sp - 1]).toUpperCase(); break;
                case 0xA2: { const s = stack[--sp]; const sep = stack[--sp]; stack[sp++] = String(s).split(sep); } break;
                case 0xA3: { const s = stack[--sp]; const list = stack[--sp]; stack[sp++] = Array.isArray(list) ? list.join(s) : s; } break;

                // Math - in-place where possible
                case 0xB0: stack[sp - 1] = Math.sqrt(stack[sp - 1]); break;
                case 0xB1: stack[sp - 1] = Math.abs(stack[sp - 1]); break;
                case 0xB2: stack[sp++] = Math.PI; break;
                case 0xB3: stack[sp++] = Math.E; break;

                // System
                case 0xC0: // exit
                    if (this.isNode) process.exit(stack[--sp] || 0);
                    else this.running = false;
                    break;
                case 0xC1: // system
                    {
                        this.sp = sp;
                        const cmd = this.getString(stack[--sp]);
                        if (this.isNode) {
                            try { require('child_process').execSync(cmd, { stdio: 'inherit' }); stack[sp++] = 0; }
                            catch (e) { stack[sp++] = 1; }
                        } else { this.print(`[OS SYSTEM] ${cmd}\n`); stack[sp++] = 0; }
                    }
                    break;
                case 0xC2: // sleep
                    { const ms = (stack[--sp] * 1000) | 0; const start = Date.now(); while (Date.now() - start < ms); }
                    break;

                default:
                    // Handle any remaining complex operations
                    this.sp = sp;
                    if (!this.executeComplex(op)) {
                        console.error("Unknown opcode: 0x" + op.toString(16) + " at PC " + (this.pc - 1));
                        this.running = false;
                    }
                    sp = this.sp;
                    break;
            }
        }

        this.sp = sp;
        if (this.config.outputMode) {
            return this.capturedOutput.join("");
        }
    }

    executeComplex(op) {
        const stack = this.stack;
        switch (op) {
            // C++ list methods
            case 0xA8: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const self = stack[--this.sp]; const other = a[0]; if (Array.isArray(self) && Array.isArray(other)) { self.length = 0; self.push(...other); } } break;
            case 0xA9: { const n = stack[--this.sp]; for (let i = 0; i < n; i++) this.sp--; const l = stack[--this.sp]; stack[this.sp++] = Array.isArray(l) && l.length ? l[0] : undefined; } break;
            case 0xAA: { const n = stack[--this.sp]; for (let i = 0; i < n; i++) this.sp--; const l = stack[--this.sp]; stack[this.sp++] = Array.isArray(l) && l.length ? l[l.length - 1] : undefined; } break;
            case 0xAB: { const n = stack[--this.sp]; for (let i = 0; i < n; i++) this.sp--; stack[--this.sp]; stack[this.sp++] = 0; } break;
            case 0xAC: { const n = stack[--this.sp]; for (let i = 0; i < n; i++) this.sp--; const l = stack[--this.sp]; stack[this.sp++] = Array.isArray(l) ? l.length : 0; } break;
            case 0xAD: { const n = stack[--this.sp]; for (let i = 0; i < n; i++) this.sp--; const l = stack[--this.sp]; stack[this.sp++] = Array.isArray(l) ? Math.max(0, l.length - 1) : 0; } break;
            case 0xAE: { const n = stack[--this.sp]; for (let i = 0; i < n; i++) this.sp--; const l = stack[--this.sp]; stack[this.sp++] = Array.isArray(l) ? l.length : 0; } break;
            case 0xAF: { const n = stack[--this.sp]; for (let i = 0; i < n; i++) this.sp--; const l = stack[--this.sp]; stack[this.sp++] = Array.isArray(l) && l.length === 0 ? 1 : 0; } break;
            case 0xB4: { const n = stack[--this.sp]; for (let i = 0; i < n; i++) this.sp--; this.sp--; stack[this.sp++] = 2147483647; } break;
            case 0xB5: { const n = stack[--this.sp]; for (let i = 0; i < n; i++) this.sp--; const l = stack[--this.sp]; if (Array.isArray(l)) l.length = 0; } break;
            case 0xB6: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const l = stack[--this.sp]; if (Array.isArray(l) && n >= 1) { const pos = a[0] | 0; for (let i = n - 1; i >= 1; i--) l.splice(pos, 0, a[i]); } } break;
            case 0xB7: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const l = stack[--this.sp]; if (Array.isArray(l) && n >= 1) l.splice(a[0] | 0, 1); } break;
            case 0xB8: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const l = stack[--this.sp]; if (Array.isArray(l) && n >= 1) l.unshift(a[0]); } break;
            case 0xB9: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const l = stack[--this.sp]; const r = a[0]; if (Array.isArray(l) && Array.isArray(r)) for (let i = r.length - 1; i >= 0; i--) l.unshift(r[i]); } break;
            case 0xBA: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const l = stack[--this.sp]; if (Array.isArray(l) && n >= 1) for (let i = 0; i < a[0].length; i++) l.push(a[0][i]); } break;
            case 0xBB: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const l = stack[--this.sp]; if (Array.isArray(l)) l.length = (a[0] | 0) >= 0 ? (a[0] | 0) : 0; } break;
            case 0xBC: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const l = stack[--this.sp]; const o = a[0]; if (Array.isArray(l) && Array.isArray(o)) { const t = l.slice(); l.length = 0; l.push(...o); o.length = 0; o.push(...t); } } break;
            case 0xBD: { const n = stack[--this.sp]; for (let i = 0; i < n; i++) this.sp--; const l = stack[--this.sp]; if (Array.isArray(l)) l.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); } break;
            case 0xBE: { const n = stack[--this.sp]; for (let i = 0; i < n; i++) this.sp--; const l = stack[--this.sp]; if (Array.isArray(l)) { let j = 0; for (let i = 1; i < l.length; i++) if (l[i] !== l[j]) l[++j] = l[i]; l.length = j + 1; } } break;
            case 0xBF: { const n = stack[--this.sp]; for (let i = 0; i < n; i++) this.sp--; const l = stack[--this.sp]; if (Array.isArray(l)) l.reverse(); } break;
            case 0xC3: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const l = stack[--this.sp]; const other = a[0]; if (Array.isArray(l) && Array.isArray(other)) { const merged = l.concat(other).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)); l.length = 0; l.push(...merged); } } break;
            case 0xC4: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const l = stack[--this.sp]; const other = a[0], pos = a[1] | 0; if (Array.isArray(l) && Array.isArray(other) && n >= 2) { const els = other.splice(0); for (let i = els.length - 1; i >= 0; i--) l.splice(pos, 0, els[i]); } } break;
            case 0xC5: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const l = stack[--this.sp]; const val = a[0]; if (Array.isArray(l)) { let j = 0; for (let i = 0; i < l.length; i++) if (l[i] !== val) l[j++] = l[i]; l.length = j; } } break;
            case 0xC6: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const l = stack[--this.sp]; const pred = a[0]; if (Array.isArray(l) && typeof pred === 'function') { let j = 0; for (let i = 0; i < l.length; i++) if (!pred(l[i])) l[j++] = l[i]; l.length = j; } } break;
            case 0xC7: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const l = stack[--this.sp]; const o = a[0]; const eq = Array.isArray(l) && Array.isArray(o) && l.length === o.length && l.every((x, i) => x === o[i]); stack[this.sp++] = eq ? 1 : 0; } break;
            case 0xC8: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const l = stack[--this.sp]; const o = a[0]; let cmp = 0; if (Array.isArray(l) && Array.isArray(o)) { for (let i = 0; i < Math.min(l.length, o.length); i++) { if (l[i] < o[i]) { cmp = -1; break; } if (l[i] > o[i]) { cmp = 1; break; } } if (cmp === 0) cmp = l.length < o.length ? -1 : l.length > o.length ? 1 : 0; } stack[this.sp++] = cmp; } break;
            case 0xC9: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const x = a[0]; stack[this.sp++] = Array.isArray(x) ? x.slice().reverse() : (typeof x === 'string' ? x.split('').reverse().join('') : []); } break;

            // Python / cross-language builtins
            case 0xE8: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const start = n === 1 ? 0 : (a[0] | 0); const stop = n === 1 ? (a[0] | 0) : (a[1] | 0); const step = n >= 3 ? (a[2] | 0) : 1; const st = step === 0 ? 1 : step; const out = []; for (let i = start; st > 0 ? i < stop : i > stop; i += st) out.push(i); stack[this.sp++] = out; } break;
            case 0xE9: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); stack[this.sp++] = n === 0 ? undefined : (Array.isArray(a[0]) ? Math.max(...a[0]) : (n === 1 ? a[0] : Math.max(...a))); } break;
            case 0xEA: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); stack[this.sp++] = n === 0 ? undefined : (Array.isArray(a[0]) ? Math.min(...a[0]) : (n === 1 ? a[0] : Math.min(...a))); } break;
            case 0xEB: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const x = a[0]; const arr = Array.isArray(x) ? x : []; stack[this.sp++] = arr.reduce((s, v) => s + (typeof v === 'number' ? v : 0), (n >= 2 ? (a[1] | 0) : 0)); } break;
            case 0xEC: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const x = a[0]; stack[this.sp++] = Array.isArray(x) ? x.slice().sort((p, q) => (p < q ? -1 : p > q ? 1 : 0)) : []; } break;
            case 0xED: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const v = n ? a[0] : 0; stack[this.sp++] = typeof v === 'number' ? (v | 0) : (typeof v === 'string' ? parseInt(v, 10) | 0 : (v ? 1 : 0)); } break;
            case 0xEE: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const v = n ? a[0] : 0; stack[this.sp++] = typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v) : (v ? 1 : 0)); } break;
            case 0xEF: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); stack[this.sp++] = String(a[0] != null ? a[0] : ''); } break;
            case 0xF0: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const v = a[0]; stack[this.sp++] = v ? 1 : 0; } break;
            case 0xF1: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); stack[this.sp++] = Array.isArray(a[0]) ? a[0].slice() : (n ? [a[0]] : []); } break;
            case 0xF2: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); stack[this.sp++] = String.fromCharCode((a[0] | 0) & 0xFFFF); } break;
            case 0xF3: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const s = typeof a[0] === 'string' ? a[0] : this.getString(a[0]); stack[this.sp++] = s.length ? s.charCodeAt(0) : 0; } break;
            case 0xF4: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const nd = n >= 2 ? (a[1] | 0) : 0; stack[this.sp++] = nd >= 0 ? Math.round(a[0] * Math.pow(10, nd)) / Math.pow(10, nd) : Math.round(a[0]); } break;
            case 0xF5: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const x = a[0] | 0, y = a[1] | 0; stack[this.sp++] = y !== 0 ? Math.floor(x / y) : 0; stack[this.sp++] = y !== 0 ? x % y : 0; } break;
            case 0xF6: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const base = a[0], exp = a[1], mod = n >= 3 ? a[2] : undefined; stack[this.sp++] = mod != null ? (Math.pow(base, exp) % mod) : Math.pow(base, exp); } break;
            case 0xF7: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const it = Array.isArray(a[0]) ? a[0] : []; stack[this.sp++] = it.length ? (it.every(x => x) ? 1 : 0) : 1; } break;
            case 0xF8: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const it = Array.isArray(a[0]) ? a[0] : []; stack[this.sp++] = it.some(x => x) ? 1 : 0; } break;
            case 0xF9: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); stack[this.sp++] = JSON.stringify(a[0]); } break;
            case 0xFA: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); stack[this.sp++] = (a[0] | 0).toString(2); } break;
            case 0xFB: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); stack[this.sp++] = (a[0] | 0).toString(16); } break;
            case 0xFC: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); stack[this.sp++] = (a[0] | 0).toString(8); } break;
            case 0xFD: { this.sp--; stack[this.sp++] = this.config.prompt ? this.config.prompt() : ''; } break;
            case 0xFE: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const lists = a; const len = Math.min(...lists.map(l => Array.isArray(l) ? l.length : 0)); const out = []; for (let i = 0; i < len; i++) out.push(lists.map(l => l[i])); stack[this.sp++] = out; } break;
            case 0xFF: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const it = Array.isArray(a[0]) ? a[0] : []; const start = n >= 2 ? (a[1] | 0) : 0; stack[this.sp++] = it.map((v, i) => [start + i, v]); } break;
            case 0xCA: { const n = stack[--this.sp]; const a = []; for (let i = 0; i < n; i++) a.unshift(stack[--this.sp]); const lo = (n >= 2 ? a[0] : 0) | 0; const hi = (n >= 2 ? a[1] : (a[0] | 0)) | 0; const range = hi - lo; stack[this.sp++] = range <= 0 ? lo : lo + Math.floor(Math.random() * range); } break;

            // C memory syscalls
            case 0xD0: { this.sp--; stack[this.sp - 1] = this.malloc(stack[this.sp - 1]); } break;
            case 0xD1: { this.sp--; const sz = stack[--this.sp]; const nm = stack[--this.sp]; const a = this.malloc(nm * sz); for (let i = 0; i < nm * sz; i++) this.memory[a + i] = 0; stack[this.sp++] = a; } break;
            case 0xD2: { this.sp--; const nsz = stack[--this.sp]; const ptr = stack[--this.sp]; stack[this.sp++] = this.realloc(ptr, nsz); } break;
            case 0xD3: { this.sp--; this.freeByAddr(stack[--this.sp]); } break;
            case 0xD4: case 0xD5: case 0xD6: case 0xD7: case 0xD8: case 0xD9: case 0xDA: case 0xDB: case 0xDC: case 0xDD: case 0xDE: {
                this.sp--;
                const s = stack[--this.sp];
                const str = typeof s === 'string' ? s : this.getString(s);
                const isFloat = (op === 0xD4 || op === 0xD8 || op === 0xD9 || op === 0xDB);
                stack[this.sp++] = isFloat ? parseFloat(str) : (parseInt(str, 10) | 0);
            } break;
            case 0xE0: if (this.isNode) process.exit(1); else this.running = false; break;
            case 0xE1: if (this.isNode) process.exit(stack[--this.sp] || 0); break;
            case 0xE2: { this.sp--; const fn = stack[--this.sp]; if (typeof fn === 'number') this.atexitHandlers.push(fn); } break;
            case 0xE3: { this.sp--; const fn = stack[--this.sp]; if (typeof fn === 'number') this.atQuickExitHandlers.push(fn); } break;
            case 0xE4: if (this.isNode) { while (this.atQuickExitHandlers.length) this.atQuickExitHandlers.pop(); process.exit(stack[--this.sp] || 0); } break;
            case 0xE5: { this.sp--; const k = this.getString(stack[--this.sp]); stack[this.sp++] = this.isNode && process.env ? (process.env[k] || 0) : 0; } break;
            case 0xE6: { // bsearch
                this.sp--;
                const comparFn = stack[--this.sp];
                const elemSize = stack[--this.sp];
                const nnmemb = stack[--this.sp];
                const baseArr = stack[--this.sp];
                const key = stack[--this.sp];
                const arr = Array.isArray(baseArr) ? baseArr : [];
                let lo = 0, hi = nnmemb - 1;
                while (lo <= hi) {
                    const mid = (lo + hi) >>> 1;
                    const elem = arr[mid];
                    const cmp = typeof comparFn === 'function' ? comparFn.call(this, key, elem) : (key < elem ? -1 : key > elem ? 1 : 0);
                    if (cmp === 0) { stack[this.sp++] = mid; break; }
                    if (cmp < 0) hi = mid - 1; else lo = mid + 1;
                }
                if (lo > hi) stack[this.sp++] = -1;
            } break;
            case 0xE7: { // qsort
                this.sp--;
                const comparFn = stack[--this.sp];
                stack[--this.sp]; // elemSize
                stack[--this.sp]; // nmemb
                const baseArr = stack[--this.sp];
                if (Array.isArray(baseArr)) baseArr.sort(typeof comparFn === 'function' ? (a, b) => comparFn.call(this, a, b) : (a, b) => a - b);
            } break;

            default: return false;
        }
        return true;
    }

    print(text) {
        if (this.config.outputMode) {
            this.capturedOutput.push(text);
        } else {
            if (this.isNode) process.stdout.write(text);
            else console.log(text);
        }
    }

    getString(a) {
        if (typeof a === 'string') return a;
        if (a === undefined || a === null) return "";
        let end = a;
        while (this.memory[end] !== 0) end++;
        return this.decoder.decode(this.memory.subarray(a, end));
    }

    handleSyscall(id) {
        const stack = this.stack;
        switch (id) {
            case 0x60: // printf/print
                {
                    const count = stack[--this.sp];
                    const args = [];
                    for (let i = 0; i < count; i++) args.push(stack[--this.sp]);
                    args.reverse();
                    if (args.length === 0) { this.print("\n"); break; }
                    const arg0 = args.shift();
                    const fmt = this.getString(arg0);
                    if (typeof fmt === 'string' && (fmt.includes('%s') || fmt.includes('%d'))) {
                        const out = fmt.replace(/%d|%s|%f/g, (m) => {
                            const v = args.shift();
                            return (m === "%s") ? this.getString(v) : v;
                        }).replace(/\\n/g, '\n');
                        this.print(out);
                    } else {
                        const out = [fmt, ...args.map(a => (typeof a === 'object' ? JSON.stringify(a) : this.getString(a)))].join(" ") + "\n";
                        this.print(out);
                    }
                } break;
            case 0x61: // puts
                { const count = stack[--this.sp]; const args = []; for (let i = 0; i < count; i++) args.unshift(stack[--this.sp]); const s = args[0]; this.print(this.getString(s) + '\n'); } break;
            case 0x70: // fopen
                {
                    stack[--this.sp];
                    const mode = this.getString(stack[--this.sp]);
                    const path = this.getString(stack[--this.sp]);
                    if (this.isNode && !this.config.useRamFS) {
                        try {
                            const fd = this.fs.openSync(path, mode);
                            const vmFD = this.nextFD++;
                            this.handles.set(vmFD, { fd, node: true });
                            stack[this.sp++] = vmFD;
                        } catch (e) { stack[this.sp++] = 0; }
                        return;
                    }
                    let file = this.ramFS.get(path);
                    if (mode.includes('w')) { file = new VirtualFile(); this.ramFS.set(path, file); }
                    else if (!file) { if (mode.includes('r')) { stack[this.sp++] = 0; return; } else { file = new VirtualFile(); this.ramFS.set(path, file); } }
                    const vmFD = this.nextFD++;
                    const cursor = mode.includes('a') ? file.size : 0;
                    this.handles.set(vmFD, { path, mode, node: false, file, cursor });
                    stack[this.sp++] = vmFD;
                } break;
            case 0x71: // fprintf
                {
                    const count = stack[--this.sp];
                    const args = [];
                    for (let i = 0; i < count; i++) args.push(stack[--this.sp]);
                    args.reverse();
                    const fd = args.shift();
                    const fmt = this.getString(args.shift());
                    const out = fmt.replace(/%d|%s/g, (m) => { const v = args.shift(); return (m === "%s") ? this.getString(v) : v; }).replace(/\\n/g, '\n');
                    const h = this.handles.get(fd);
                    if (!h) return;
                    if (h.node) this.fs.writeSync(h.fd, out);
                    else { const bytes = new TextEncoder().encode(out); h.cursor += h.file.write(bytes, h.cursor); }
                } break;
            case 0x72: // fclose
                { stack[--this.sp]; const fd = stack[--this.sp]; const h = this.handles.get(fd); if (h && h.node) this.fs.closeSync(h.fd); this.handles.delete(fd); } break;
            case 0x62: stack[this.sp - 1] = this.getString(stack[this.sp - 1]).length; break;
            case 0x63: // len
                {
                    const count = stack[--this.sp];
                    let v;
                    if (count === 0) { v = stack[--this.sp]; } else { const args = []; for (let i = 0; i < count; i++) args.unshift(stack[--this.sp]); v = args[0]; }
                    if (typeof v === 'string') stack[this.sp++] = v.length;
                    else if (Array.isArray(v)) stack[this.sp++] = v.length;
                    else if (v instanceof Set) stack[this.sp++] = v.size;
                    else if (v instanceof Map) stack[this.sp++] = v.size;
                    else stack[this.sp++] = 0;
                } break;
            case 0x80: stack[this.sp++] = Math.floor(Date.now() / 1000); break;
            case 0x81: this.sp--; stack[this.sp++] = new Date().toLocaleString(); break;
            case 0xB0: stack[this.sp - 1] = Math.sqrt(stack[this.sp - 1]); break;
            case 0xB1: stack[this.sp - 1] = Math.abs(stack[this.sp - 1]); break;
            case 0xB2: stack[this.sp++] = Math.PI; break;
            case 0xB3: stack[this.sp++] = Math.E; break;
            case 0xC0: if (this.isNode) process.exit(stack[--this.sp] || 0); else this.running = false; break;
            case 0xC1: {
                const cmd = this.getString(stack[--this.sp]);
                if (this.isNode) {
                    try { require('child_process').execSync(cmd, { stdio: 'inherit' }); stack[this.sp++] = 0; }
                    catch (e) { stack[this.sp++] = 1; }
                } else { this.print(`[OS SYSTEM] ${cmd}\n`); stack[this.sp++] = 0; }
            } break;
            case 0xC2: { const s = stack[--this.sp]; const end = Date.now() + (s * 1000); while (Date.now() < end); stack[this.sp++] = null; } break;
            case 0xD0: { this.sp--; stack[this.sp - 1] = this.malloc(stack[this.sp - 1]); } break;
            case 0xD3: { this.sp--; this.freeByAddr(stack[--this.sp]); } break;
            case 0xEF: { this.sp--; stack[this.sp - 1] = String(stack[this.sp - 1]); } break;
            default:
                if (!this.executeComplex(id)) {
                    // Silently ignore unknown syscalls for compatibility
                }
                break;
        }
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = SoulVM;
else if (typeof window !== 'undefined') window.SoulVM = SoulVM;

if (typeof process !== 'undefined' && process.argv && process.argv.length > 2) {
    // Parse command-line arguments
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        SoulVM.showHelp();
        process.exit(0);
    }

    const config = {
        useRamFS: args.includes('--ramfs'),
        debug: args.includes('--debug'),
        validateBytecode: !args.includes('--no-validate')
    };

    // Parse --max-memory
    const memIdx = args.findIndex(a => a === '--max-memory');
    if (memIdx !== -1 && memIdx + 1 < args.length) {
        config.maxMemory = parseInt(args[memIdx + 1], 10);
    }

    // Parse --stack-size
    const stackIdx = args.findIndex(a => a === '--stack-size');
    if (stackIdx !== -1 && stackIdx + 1 < args.length) {
        config.stackSize = parseInt(args[stackIdx + 1], 10);
    }

    const vm = new SoulVM(config);
    const fileArg = args.find(arg => !arg.startsWith('--') && !arg.match(/^\d+$/));

    if (fileArg) {
        vm.load(fileArg)
            .then(() => {
                try {
                    const startTime = Date.now();
                    vm.run();
                    const endTime = Date.now();

                    if (config.debug) {
                        console.log('\n--- Execution Statistics ---');
                        const stats = vm.getStats();
                        console.log(`Execution time: ${endTime - startTime}ms`);
                        console.log(`Instructions executed: ${stats.instructionCount}`);
                        console.log(`String cache hit rate: ${(stats.cacheHitRate * 100).toFixed(2)}%`);
                        console.log(`Heap used: ${stats.heapUsed} bytes`);
                        console.log(`Max stack depth: ${stats.stackDepth}`);
                        console.log(`Max call depth: ${stats.callDepth}`);
                        console.log(`Allocated blocks: ${stats.allocatedBlocks}`);
                    }
                } catch (e) {
                    console.error("Runtime Error:", e.message);
                    if (config.debug) console.error(e.stack);
                    process.exit(1);
                }
            })
            .catch(e => {
                console.error("Load Error:", e.message);
                if (config.debug) console.error(e.stack);
                process.exit(1);
            });
    } else {
        console.error('Error: No bytecode file specified');
        SoulVM.showHelp();
        process.exit(1);
    }
}
