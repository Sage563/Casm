// Cross-platform Soul VM Runtime
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
            useRamFS: config.useRamFS !== undefined ? config.useRamFS : (typeof window !== 'undefined'),
            outputMode: config.outputMode || false, // Capture output instead of logging
            ...config
        };
        this.stack = []; this.callStack = []; this.variables = new Map();
        this.variables.set('True', true); this.variables.set('False', false); this.variables.set('None', null);
        this.memory = new Uint8Array(this.config.maxMemory);
        this.heapStart = Math.floor(this.config.maxMemory / 2); this.heapOffset = this.heapStart;
        this.pc = 0; this.running = false;
        this.handles = new Map(); this.nextFD = 3;

        // Output Buffer for Output Mode
        this.capturedOutput = [];

        // Memory Management
        this.freeList = null;
        this.allocatedSizes = new Map(); // addr -> size for free(ptr)

        // Improved RAM FS
        this.ramFS = new Map();
        this.atexitHandlers = [];
        this.atQuickExitHandlers = [];

        // Detect Environment
        this.isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
        if (this.isNode) this.fs = require('fs');
    }

    /**
     * Convenience helper: run a CASM payload and capture all textual output.
     * - `res` can be a hex string, path to a `.casm` file, or Uint8Array/Buffer.
     * - Returns `{ output, vm }` so callers can also inspect VM state.
     */
    static async runWithOutput(res, config = {}) {
        const vm = new SoulVM({ ...config, outputMode: true });
        await vm.load(res);
        const output = vm.run() || "";
        return { output, vm };
    }

    // Built-in demo payloads (hex-encoded CASM), shared with the browser host.
    // These are safe, tiny programs useful for smoke tests or embedding.
    static get payloads() {
        return {
            // C# demo: simple Console.WriteLine-style program.
            cs: "534F554C010000001004044D61696E0A0000006D021B432320696E207468652042726F777365723A2053554343455353210100000001036002025C6E010000000103600219506F6C79676C6F7420506F77657220756E6C6561736865642E0100000001036002025C6E010000000103600D0C044D61696E00",
            // C demo: kitchen-sink style test (types, IO, time, etc.).
            c: "534F554C0509434F4C4F525F524544050B434F4C4F525F475245454E050A434F4C4F525F424C55450505666C6F617405016605076D6174685F666E010000004604036164640A0000004E0501610D0501620D010000005D04036D756C0A000000650501610D0501620D010000007604056170706C790A000000820501610501620C02666E0D0D010000009704096475706C69636174650A000000EB0501730C067374726C656E04036C656E010000000105036C656E0C066D616C6C6F6304036F75740B000000E705036F757405044E554C4C0D05036F757405017305036C656E0C066D656D63707905036F75740D0D0100000000040E676C6F62616C5F636F756572010000011004046D61696E0A000003820100000005040161010000000304016404026F6B050B434F4C4F525F475245454E04016301000000030403702E7801000000040403702E79020E506F696E743A2025642025645C6E0503702E780503702E7901000000030360010000002A0403752E69020F556E696F6E20696E743A2025645C6E0503752E6901000000020360010000000104066172725B305D010000000204066172725B315D010000000304066172725B325D010000000404066172725B335D010000000004016905016905036172720C0941525241595F4C454E050169020325642005036172720501690100000005036002025C6E0100000001036005016104027061010000000A0402706102094164643A2025645C6E0100000002010000000305036164640C056170706C790100000002036002094D756C3A2025645C6E0100000002010000000305036D756C0C056170706C7901000000020360020568656C6C6F0C096475706C69636174650404636F70790504636F70790B000002A9020A436F70793A2025735C6E0504636F7079010000000203600504636F70790C0466726565020A64656D6F5F632E747874020177010000000203700401660501660B000002EB050166020B432066696C6520494F5C6E010000000203710501660100000001037205044E554C4C0C0474696D6504036E6F77020854696D653A20257305036E6F770100000001038101000000020360010000000201000000030C034D415801000000030C06617373657274050E676C6F62616C5F636F756E746572020C476C6F62616C3A2025645C6E050E676C6F62616C5F636F756E746572010000000203600208446F6E6520435C6E0100000001036001000000000D0D0C046D61696E00"
        };
    }

    malloc(size) {
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
                return addr;
            }
            prev = curr;
            curr = curr.next;
        }
        const addr = this.heapOffset;
        this.heapOffset += size;
        if (this.heapOffset > this.config.maxMemory) throw new Error("Out of memory");
        this.allocatedSizes.set(addr, size);
        return addr;
    }

    free(addr, size) {
        const block = new FreeBlock(addr, size, this.freeList);
        this.freeList = block;
        this.allocatedSizes.delete(addr);
    }

    freeByAddr(addr) {
        const size = this.allocatedSizes.get(addr);
        if (size != null) {
            this.free(addr, size);
        }
    }

    realloc(ptr, newSize) {
        const oldSize = this.allocatedSizes.get(ptr) || 0;
        const newAddr = this.malloc(newSize);
        const copyLen = Math.min(oldSize, newSize);
        for (let i = 0; i < copyLen; i++) this.memory[newAddr + i] = this.memory[ptr + i];
        this.freeByAddr(ptr);
        return newAddr;
    }

    async load(res) {
        let buf;
        if (typeof res === 'string') {
            if (res.startsWith('534f554c') || res.startsWith('534F554C') ||
                res.startsWith('4341534d') || res.startsWith('4341534D')) {
                const b = new Uint8Array(res.length / 2);
                for (let i = 0; i < res.length; i += 2) b[i / 2] = parseInt(res.substr(i, 2), 16);
                buf = b;
            } else if (this.isNode) {
                buf = this.fs.readFileSync(res);
            } else {
                const response = await fetch(res);
                buf = new Uint8Array(await response.arrayBuffer());
            }
        } else buf = res;
        this.bytecode = new Uint8Array(buf.slice(4));
    }

    // --- Fast Execution Loop (Inlined) ---
    run() {
        this.running = true;
        this.pc = 0;
        const bc = this.bytecode; // Cache reference
        const len = bc.length;

        while (this.running && this.pc < len) {
            const op = bc[this.pc++];
            // INLINED EXECUTE
            switch (op) {
                case 0x00: this.running = false; break;
                case 0x01: // READ INT (Inlined)
                    this.stack.push((bc[this.pc++] << 24) | (bc[this.pc++] << 16) | (bc[this.pc++] << 8) | (bc[this.pc++]));
                    break;
                case 0x02: this.stack.push(this.readString()); break;
                case 0x03: this.handleSyscall(bc[this.pc++]); break;
                case 0x04: { const n = this.readString(); this.variables.set(n, this.stack.pop()); } break;
                case 0x05: this.stack.push(this.variables.get(this.readString())); break;
                case 0x06: this.stack.push(this.stack.pop() + this.stack.pop()); break;
                case 0x07: { const b = this.stack.pop(); this.stack.push(this.stack.pop() - b); } break;
                case 0x08: this.stack.push(this.stack.pop() * this.stack.pop()); break;
                case 0x09: { const b = this.stack.pop(); const a = this.stack.pop(); this.stack.push(b !== 0 ? Math.floor(a / b) : 0); } break;
                case 0x0A: // JMP (Inlined)
                    this.pc = (bc[this.pc++] << 24) | (bc[this.pc++] << 16) | (bc[this.pc++] << 8) | (bc[this.pc++]);
                    break;
                case 0x0B: // JZ (Inlined)
                    {
                        const c = this.stack.pop();
                        const t = (bc[this.pc++] << 24) | (bc[this.pc++] << 16) | (bc[this.pc++] << 8) | (bc[this.pc++]);
                        if (!c) this.pc = t;
                    } break;
                // ... (Common Ops inlined for speed, others function call overhead is negligible relative to logic)
                case 0x0C: // CALL
                    {
                        const name = this.readString(); const target = this.variables.get(name);
                        if (typeof target === 'function') { const r = target.call(this); if (r !== undefined) this.stack.push(r); }
                        else if (target !== undefined) { this.callStack.push(this.pc); this.pc = target; }
                        else { console.error("Undefined function: " + name); this.running = false; }
                    } break;
                case 0x0D: this.pc = this.callStack.pop(); break;
                case 0x0E: // FOR_ITER (target)
                    {
                        const target = (bc[this.pc++] << 24) | (bc[this.pc++] << 16) | (bc[this.pc++] << 8) | (bc[this.pc++]);
                        const iter = this.stack[this.stack.length - 1]; // Peak iterator
                        if (!iter || typeof iter.next !== 'function') {
                            const val = this.stack.pop();
                            const actualIter = (Array.isArray(val) || typeof val === 'string') ? val[Symbol.iterator]() : val;
                            this.stack.push(actualIter);
                        }
                        const currentIter = this.stack[this.stack.length - 1];
                        const next = currentIter.next();
                        if (!next.done) {
                            this.stack.push(next.value);
                        } else {
                            this.stack.pop(); // Remove iterator
                            this.pc = target;
                        }
                    } break;
                case 0x0F: // TRY_ENTER (handler_pc)
                    {
                        const handler = (bc[this.pc++] << 24) | (bc[this.pc++] << 16) | (bc[this.pc++] << 8) | (bc[this.pc++]);
                        this.tryStack = this.tryStack || [];
                        this.tryStack.push({ handler, stackLen: this.stack.length });
                    } break;
                case 0x10: // TRY_EXIT
                    this.tryStack.pop();
                    break;
                case 0x11: // RAISE
                    {
                        const err = this.stack.pop();
                        if (this.tryStack && this.tryStack.length) {
                            const handlerInfo = this.tryStack.pop();
                            this.stack.length = handlerInfo.stackLen;
                            this.stack.push(err);
                            this.pc = handlerInfo.handler;
                        } else {
                            console.error("Unhandled exception: " + err);
                            this.running = false;
                        }
                    } break;

                // Standardized Binary Ops for performance
                case 0x12: { const b = this.stack.pop(); const a = this.stack.pop(); this.stack.push(b !== 0 ? a % b : 0); } break;
                case 0x13: { const b = this.stack.pop(); this.stack.push(this.stack.pop() << b); } break;
                case 0x14: { const b = this.stack.pop(); this.stack.push(this.stack.pop() >> b); } break;
                case 0x15: this.stack.push(this.stack.pop() & this.stack.pop()); break;
                case 0x16: this.stack.push(this.stack.pop() | this.stack.pop()); break;
                case 0x17: this.stack.push(this.stack.pop() ^ this.stack.pop()); break;
                case 0x18: this.stack.push(~this.stack.pop()); break;
                case 0x19: this.stack.push(this.stack.pop() === this.stack.pop() ? 1 : 0); break;
                case 0x1A: this.stack.push(this.stack.pop() !== this.stack.pop() ? 1 : 0); break;
                case 0x1B: { const b = this.stack.pop(); this.stack.push(this.stack.pop() < b ? 1 : 0); } break;
                case 0x1C: { const b = this.stack.pop(); this.stack.push(this.stack.pop() <= b ? 1 : 0); } break;
                case 0x1D: { const b = this.stack.pop(); this.stack.push(this.stack.pop() > b ? 1 : 0); } break;
                case 0x1E: { const b = this.stack.pop(); this.stack.push(this.stack.pop() >= b ? 1 : 0); } break;
                case 0x1F: this.stack.push(this.stack.pop() && this.stack.pop() ? 1 : 0); break;
                case 0x20: this.stack.push(this.stack.pop() || this.stack.pop() ? 1 : 0); break;
                case 0x21: this.stack.push(this.stack.pop() ? 0 : 1); break;

                // Advanced Ops delegating to handlers to keep switch manageable SIZE-wise for V8 optimization?
                // Actually, V8 handles large switches well. Let's keep common ones here.

                default:
                    // Fallback to method-based dispatch for less common ops to de-clutter generic loop? 
                    // No, for "FAST" we should just handle them or delegate.
                    // Re-implementing delegation for complex ops to avoid code duplication in this file updates.
                    this.executeComplex(op);
                    break;
            }
        }

        if (this.config.outputMode) {
            return this.capturedOutput.join("");
        }
    }

    executeComplex(op) {
        switch (op) {
            case 0x52: { // READ_ADDR (sz, addr)
                const sz = this.bytecode[this.pc++]; const a = this.stack.pop();
                if (sz === 1) this.stack.push(this.memory[a]);
                else if (sz === 8) this.stack.push(new DataView(this.memory.buffer).getFloat64(a, true));
                else this.stack.push(new DataView(this.memory.buffer).getInt32(a, true));
            } break;
            case 0x53: { // WRITE_ADDR (sz, val, addr)
                const sz = this.bytecode[this.pc++]; const v = this.stack.pop(); const a = this.stack.pop();
                if (sz === 1) this.memory[a] = v & 0xFF;
                else if (sz === 8) new DataView(this.memory.buffer).setFloat64(a, v, true);
                else new DataView(this.memory.buffer).setInt32(a, v, true);
            } break;
            case 0x50: this.stack.push(this.malloc(this.stack.pop())); break; // MALLOC
            case 0x51: this.freeByAddr(this.stack.pop()); break; // FREE
            case 0x54: // ADDR_OF
                {
                    const n = this.readString();
                    this.stack.push(n);
                } break;

            // Advanced Data Structures (0x90+)
            case 0x90: this.stack.push(new Set()); break;
            case 0x91: { const val = this.stack.pop(); const s = this.stack.pop(); if (s instanceof Set) s.add(val); } break;
            case 0x92: this.stack.push(new Map()); break;
            case 0x93: { const val = this.stack.pop(); const key = this.stack.pop(); const m = this.stack.pop(); if (m instanceof Map) m.set(key, val); } break;
            case 0x94: { const key = this.stack.pop(); const m = this.stack.pop(); this.stack.push(m instanceof Map ? m.get(key) : undefined); } break;
            case 0x95: this.stack.push([]); break;
            case 0x96: { const val = this.stack.pop(); const l = this.stack.pop(); if (Array.isArray(l)) l.push(val); } break;
            case 0x97: { const l = this.stack.pop(); this.stack.push(Array.isArray(l) ? l.shift() : undefined); } break;
            case 0x98: { const l = this.stack.pop(); this.stack.push(Array.isArray(l) ? l.pop() : undefined); } break;

            // Strings (0xA0+)
            case 0xA0: this.stack.push(this.stack.pop().toLowerCase()); break;
            case 0xA1: this.stack.push(this.stack.pop().toUpperCase()); break;
            case 0xA2: { const s = this.stack.pop(); const sep = this.stack.pop(); this.stack.push(s.split(sep)); } break;
            case 0xA3: { const s = this.stack.pop(); const list = this.stack.pop(); if (Array.isArray(list)) this.stack.push(list.join(s)); else this.stack.push(s); } break;

            // Math (0xB0+)
            case 0xB0: this.stack.push(Math.sqrt(this.stack.pop())); break;
            case 0xB1: this.stack.push(Math.abs(this.stack.pop())); break;
            case 0xB2: this.stack.push(Math.PI); break;
            case 0xB3: this.stack.push(Math.E); break;

            // System (0xC0+)
            case 0xC0: if (this.isNode) process.exit(this.stack.pop() || 0); else this.running = false; break;
            case 0xC1: // os.system
                {
                    const cmd = this.getString(this.stack.pop());
                    if (this.isNode) {
                        try { require('child_process').execSync(cmd, { stdio: 'inherit' }); this.stack.push(0); }
                        catch (e) { this.stack.push(1); }
                    } else { this.print(`[OS SYSTEM] ${cmd}\n`); this.stack.push(0); }
                } break;
            case 0xC2: { const s = this.stack.pop(); const end = Date.now() + (s * 1000); while (Date.now() < end); this.stack.push(null); } break;

            default: this.running = false;
        }
    }

    // Helper to print output
    print(text) {
        if (this.config.outputMode) {
            this.capturedOutput.push(text);
        } else {
            if (this.isNode) process.stdout.write(text); else console.log(text);
        }
    }

    readString() { const l = this.bytecode[this.pc++]; let s = ""; for (let i = 0; i < l; i++) s += String.fromCharCode(this.bytecode[this.pc++]); return s; }
    readInt() { return (this.bytecode[this.pc++] << 24) | (this.bytecode[this.pc++] << 16) | (this.bytecode[this.pc++] << 8) | (this.bytecode[this.pc++]); }
    getString(a) { if (typeof a === 'string') return a; if (a === undefined) return ""; let s = ""; for (let i = a; this.memory[i] !== 0; i++) s += String.fromCharCode(this.memory[i]); return s; }

    handleSyscall(id) {
        switch (id) {
            case 0x60: // printf
                {
                    const count = this.stack.pop();
                    const args = []; for (let i = 0; i < count; i++) args.push(this.stack.pop());
                    args.reverse();
                    const arg0 = args.shift();
                    let out;
                    if (typeof arg0 !== 'string' && typeof arg0 !== 'number') {
                        out = String(arg0);
                        if (args.length > 0) out += " " + args.join(" ");
                    } else {
                        const fmt = this.getString(arg0);
                        out = fmt.replace(/%d|%s|%f/g, (m) => {
                            const v = args.shift();
                            return (m === "%s") ? this.getString(v) : v;
                        }).replace(/\\n/g, '\n');
                    }
                    this.print(out);
                } break;
            case 0x61: // puts(s) — C: print string + newline
                { const count = this.stack.pop(); const args = []; for (let i = 0; i < count; i++) args.unshift(this.stack.pop()); const s = args[0]; this.print(this.getString(s) + '\n'); } break;
            case 0x70: // fopen
                {
                    this.stack.pop(); const mode = this.getString(this.stack.pop()); const path = this.getString(this.stack.pop());
                    if (this.isNode && !this.config.useRamFS) {
                        try {
                            const fd = this.fs.openSync(path, mode);
                            const vmFD = this.nextFD++;
                            this.handles.set(vmFD, { fd, node: true });
                            this.stack.push(vmFD);
                        } catch (e) { this.stack.push(0); }
                        return;
                    }
                    let file = this.ramFS.get(path);
                    if (mode.includes('w')) { file = new VirtualFile(); this.ramFS.set(path, file); }
                    else if (!file) { if (mode.includes('r')) { this.stack.push(0); return; } else { file = new VirtualFile(); this.ramFS.set(path, file); } }
                    const vmFD = this.nextFD++; const cursor = mode.includes('a') ? file.size : 0;
                    this.handles.set(vmFD, { path, mode, node: false, file, cursor });
                    this.stack.push(vmFD);
                } break;
            case 0x71: // fprintf
                {
                    const count = this.stack.pop(); const args = []; for (let i = 0; i < count; i++) args.push(this.stack.pop()); args.reverse();
                    const fd = args.shift(); const fmt = this.getString(args.shift());
                    const out = fmt.replace(/%d|%s/g, (m) => { const v = args.shift(); return (m === "%s") ? this.getString(v) : v; }).replace(/\\n/g, '\n');
                    const h = this.handles.get(fd);
                    if (!h) return;
                    if (h.node) this.fs.writeSync(h.fd, out);
                    else { const bytes = new TextEncoder().encode(out); h.cursor += h.file.write(bytes, h.cursor); }
                } break;
            case 0x72: // fclose
                { this.stack.pop(); const fd = this.stack.pop(); const h = this.handles.get(fd); if (h && h.node) this.fs.closeSync(h.fd); this.handles.delete(fd); } break;
            case 0x62: this.stack.push(this.getString(this.stack.pop()).length); break;
            case 0x63: // len(x) or obj.size(): string, array, Set, Map
                {
                    const count = this.stack.pop();
                    let v;
                    if (count === 0) { v = this.stack.pop(); } else { const args = []; for (let i = 0; i < count; i++) args.unshift(this.stack.pop()); v = args[0]; }
                    if (typeof v === 'string') this.stack.push(v.length);
                    else if (Array.isArray(v)) this.stack.push(v.length);
                    else if (v instanceof Set) this.stack.push(v.size);
                    else if (v instanceof Map) this.stack.push(v.size);
                    else this.stack.push(0);
                } break;
            case 0x80: this.stack.push(Math.floor(Date.now() / 1000)); break;
            case 0x81: this.stack.pop(); this.stack.push(new Date().toLocaleString()); break;

            // C++ list methods (stack: ...args, obj, count -> pop count, pop args, pop obj)
            case 0xA8: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const self = this.stack.pop(); const other = a[0]; if (Array.isArray(self) && Array.isArray(other)) { self.length = 0; self.push(...other); } } break;
            case 0xA9: { const n = this.stack.pop(); for (let i = 0; i < n; i++) this.stack.pop(); const l = this.stack.pop(); this.stack.push(Array.isArray(l) && l.length ? l[0] : undefined); } break;
            case 0xAA: { const n = this.stack.pop(); for (let i = 0; i < n; i++) this.stack.pop(); const l = this.stack.pop(); this.stack.push(Array.isArray(l) && l.length ? l[l.length - 1] : undefined); } break;
            case 0xAB: { const n = this.stack.pop(); for (let i = 0; i < n; i++) this.stack.pop(); const l = this.stack.pop(); this.stack.push(0); } break;
            case 0xAC: { const n = this.stack.pop(); for (let i = 0; i < n; i++) this.stack.pop(); const l = this.stack.pop(); this.stack.push(Array.isArray(l) ? l.length : 0); } break;
            case 0xAD: { const n = this.stack.pop(); for (let i = 0; i < n; i++) this.stack.pop(); const l = this.stack.pop(); this.stack.push(Array.isArray(l) ? Math.max(0, l.length - 1) : 0); } break;
            case 0xAE: { const n = this.stack.pop(); for (let i = 0; i < n; i++) this.stack.pop(); const l = this.stack.pop(); this.stack.push(Array.isArray(l) ? l.length : 0); } break;
            case 0xAF: { const n = this.stack.pop(); for (let i = 0; i < n; i++) this.stack.pop(); const l = this.stack.pop(); this.stack.push(Array.isArray(l) && l.length === 0 ? 1 : 0); } break;
            case 0xB4: { const n = this.stack.pop(); for (let i = 0; i < n; i++) this.stack.pop(); this.stack.pop(); this.stack.push(2147483647); } break;
            case 0xB5: { const n = this.stack.pop(); for (let i = 0; i < n; i++) this.stack.pop(); const l = this.stack.pop(); if (Array.isArray(l)) l.length = 0; } break;
            case 0xB6: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const l = this.stack.pop(); if (Array.isArray(l) && n >= 1) { const pos = a[0] | 0; for (let i = n - 1; i >= 1; i--) l.splice(pos, 0, a[i]); } } break;
            case 0xB7: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const l = this.stack.pop(); if (Array.isArray(l) && n >= 1) l.splice(a[0] | 0, 1); } break;
            case 0xB8: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const l = this.stack.pop(); if (Array.isArray(l) && n >= 1) l.unshift(a[0]); } break;
            case 0xB9: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const l = this.stack.pop(); const r = a[0]; if (Array.isArray(l) && Array.isArray(r)) for (let i = r.length - 1; i >= 0; i--) l.unshift(r[i]); } break;
            case 0xBA: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const l = this.stack.pop(); if (Array.isArray(l) && n >= 1) for (let i = 0; i < a[0].length; i++) l.push(a[0][i]); } break;
            case 0xBB: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const l = this.stack.pop(); if (Array.isArray(l)) l.length = (a[0] | 0) >= 0 ? (a[0] | 0) : 0; } break;
            case 0xBC: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const l = this.stack.pop(); const o = a[0]; if (Array.isArray(l) && Array.isArray(o)) { const t = l.slice(); l.length = 0; l.push(...o); o.length = 0; o.push(...t); } } break;
            case 0xBD: { const n = this.stack.pop(); for (let i = 0; i < n; i++) this.stack.pop(); const l = this.stack.pop(); if (Array.isArray(l)) l.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); } break;
            case 0xBE: { const n = this.stack.pop(); for (let i = 0; i < n; i++) this.stack.pop(); const l = this.stack.pop(); if (Array.isArray(l)) { let j = 0; for (let i = 1; i < l.length; i++) if (l[i] !== l[j]) l[++j] = l[i]; l.length = j + 1; } } break;
            case 0xBF: { const n = this.stack.pop(); for (let i = 0; i < n; i++) this.stack.pop(); const l = this.stack.pop(); if (Array.isArray(l)) l.reverse(); } break;
            case 0xC3: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const l = this.stack.pop(); const other = a[0]; if (Array.isArray(l) && Array.isArray(other)) { const merged = l.concat(other).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)); l.length = 0; l.push(...merged); } } break;
            case 0xC4: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const l = this.stack.pop(); const other = a[0], pos = a[1] | 0; if (Array.isArray(l) && Array.isArray(other) && n >= 2) { const els = other.splice(0); for (let i = els.length - 1; i >= 0; i--) l.splice(pos, 0, els[i]); } } break;
            case 0xC5: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const l = this.stack.pop(); const val = a[0]; if (Array.isArray(l)) { let j = 0; for (let i = 0; i < l.length; i++) if (l[i] !== val) l[j++] = l[i]; l.length = j; } } break;
            case 0xC6: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const l = this.stack.pop(); const pred = a[0]; if (Array.isArray(l) && typeof pred === 'function') { let j = 0; for (let i = 0; i < l.length; i++) if (!pred(l[i])) l[j++] = l[i]; l.length = j; } } break;
            case 0xC7: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const l = this.stack.pop(); const o = a[0]; const eq = Array.isArray(l) && Array.isArray(o) && l.length === o.length && l.every((x, i) => x === o[i]); this.stack.push(eq ? 1 : 0); } break;
            case 0xC8: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const l = this.stack.pop(); const o = a[0]; let cmp = 0; if (Array.isArray(l) && Array.isArray(o)) { for (let i = 0; i < Math.min(l.length, o.length); i++) { if (l[i] < o[i]) { cmp = -1; break; } if (l[i] > o[i]) { cmp = 1; break; } } if (cmp === 0) cmp = l.length < o.length ? -1 : l.length > o.length ? 1 : 0; } this.stack.push(cmp); } break;
            case 0x96: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const l = this.stack.pop(); if (Array.isArray(l) && n >= 1) l.push(a[0]); } break;
            case 0x97: { const n = this.stack.pop(); for (let i = 0; i < n; i++) this.stack.pop(); const l = this.stack.pop(); this.stack.push(Array.isArray(l) && l.length ? l.shift() : undefined); } break;
            case 0x98: { const n = this.stack.pop(); for (let i = 0; i < n; i++) this.stack.pop(); const l = this.stack.pop(); this.stack.push(Array.isArray(l) && l.length ? l.pop() : undefined); } break;

            // C memory
            case 0xD0: { this.stack.pop(); const n = this.stack.pop(); this.stack.push(this.malloc(n)); } break;
            case 0xD1: { this.stack.pop(); const sz = this.stack.pop(); const nm = this.stack.pop(); const a = this.malloc(nm * sz); for (let i = 0; i < nm * sz; i++) this.memory[a + i] = 0; this.stack.push(a); } break;
            case 0xD2: { this.stack.pop(); const nsz = this.stack.pop(); const ptr = this.stack.pop(); this.stack.push(this.realloc(ptr, nsz)); } break;
            case 0xD3: { this.stack.pop(); const ptr = this.stack.pop(); this.freeByAddr(ptr); } break;
            // C string conversions (arg = string or address)
            case 0xD4: case 0xD5: case 0xD6: case 0xD7: case 0xD8: case 0xD9: case 0xDA: case 0xDB: case 0xDC: case 0xDD: case 0xDE: {
                this.stack.pop();
                const s = this.stack.pop();
                const str = typeof s === 'string' ? s : this.getString(s);
                const isFloat = (id === 0xD4 || id === 0xD8 || id === 0xD9 || id === 0xDB);
                this.stack.push(isFloat ? parseFloat(str) : (parseInt(str, 10) | 0));
            } break;
            // C process control
            case 0xE0: if (this.isNode) process.exit(1); else this.running = false; break;
            case 0xE1: if (this.isNode) process.exit(this.stack.pop() || 0); break;
            case 0xE2: { this.stack.pop(); const fn = this.stack.pop(); if (typeof fn === 'number' && this.variables) this.atexitHandlers.push(fn); } break;
            case 0xE3: { this.stack.pop(); const fn = this.stack.pop(); if (typeof fn === 'number') this.atQuickExitHandlers.push(fn); } break;
            case 0xE4: if (this.isNode) { while (this.atQuickExitHandlers.length) this.atQuickExitHandlers.pop(); process.exit(this.stack.pop() || 0); } break;
            case 0xE5: { this.stack.pop(); const k = this.getString(this.stack.pop()); this.stack.push(this.isNode && process.env ? (process.env[k] || 0) : 0); } break;
            case 0xE6: { // bsearch: key, base (array), nmemb, size, compar -> index or 0
                this.stack.pop();
                const comparFn = this.stack.pop();
                const elemSize = this.stack.pop();
                const nnmemb = this.stack.pop();
                const baseArr = this.stack.pop();
                const key = this.stack.pop();
                const arr = Array.isArray(baseArr) ? baseArr : [];
                let lo = 0, hi = nnmemb - 1;
                while (lo <= hi) {
                    const mid = (lo + hi) >>> 1;
                    const elem = arr[mid];
                    const cmp = typeof comparFn === 'function' ? comparFn.call(this, key, elem) : (key < elem ? -1 : key > elem ? 1 : 0);
                    if (cmp === 0) { this.stack.push(mid); break; }
                    if (cmp < 0) hi = mid - 1; else lo = mid + 1;
                }
                if (lo > hi) this.stack.push(-1);
            } break;
            case 0xE7: { // qsort: base, nmemb, size, compar (sorts array in place)
                this.stack.pop();
                const comparFn = this.stack.pop();
                const elemSize = this.stack.pop();
                const nmemb = this.stack.pop();
                const baseArr = this.stack.pop();
                if (Array.isArray(baseArr)) baseArr.sort(typeof comparFn === 'function' ? (a, b) => comparFn.call(this, a, b) : (a, b) => a - b);
            } break;

            // Python / cross-language builtins (stack: args..., count)
            case 0xC9: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const x = a[0]; this.stack.push(Array.isArray(x) ? x.slice().reverse() : (typeof x === 'string' ? x.split('').reverse().join('') : [])); } break;
            case 0xE8: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const start = n === 1 ? 0 : (a[0] | 0); const stop = n === 1 ? (a[0] | 0) : (a[1] | 0); const step = n >= 3 ? (a[2] | 0) : 1; const st = step === 0 ? 1 : step; const out = []; for (let i = start; st > 0 ? i < stop : i > stop; i += st) out.push(i); this.stack.push(out); } break;
            case 0xE9: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); this.stack.push(n === 0 ? undefined : (Array.isArray(a[0]) ? Math.min(...a[0]) : (n === 1 ? a[0] : Math.min(...a)))); } break;
            case 0xEA: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); this.stack.push(n === 0 ? undefined : (Array.isArray(a[0]) ? Math.max(...a[0]) : (n === 1 ? a[0] : Math.max(...a)))); } break;
            case 0xEB: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const x = a[0]; const arr = Array.isArray(x) ? x : []; this.stack.push(arr.reduce((s, v) => s + (typeof v === 'number' ? v : 0), (n >= 2 ? (a[1] | 0) : 0))); } break;
            case 0xEC: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const x = a[0]; this.stack.push(Array.isArray(x) ? x.slice().sort((p, q) => (p < q ? -1 : p > q ? 1 : 0)) : []); } break;
            case 0xED: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const v = n ? a[0] : 0; this.stack.push(typeof v === 'number' ? (v | 0) : (typeof v === 'string' ? parseInt(v, 10) | 0 : (v ? 1 : 0))); } break;
            case 0xEE: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const v = n ? a[0] : 0; this.stack.push(typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v) : (v ? 1 : 0))); } break;
            case 0xEF: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); this.stack.push(String(a[0] != null ? a[0] : '')); } break;
            case 0xF0: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const v = a[0]; this.stack.push(v ? 1 : 0); } break;
            case 0xF1: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); this.stack.push(Array.isArray(a[0]) ? a[0].slice() : (n ? [a[0]] : [])); } break;
            case 0xF2: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); this.stack.push(String.fromCharCode((a[0] | 0) & 0xFFFF)); } break;
            case 0xF3: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const s = typeof a[0] === 'string' ? a[0] : this.getString(a[0]); this.stack.push(s.length ? s.charCodeAt(0) : 0); } break;
            case 0xF4: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const nd = n >= 2 ? (a[1] | 0) : 0; this.stack.push(nd >= 0 ? Math.round(a[0] * Math.pow(10, nd)) / Math.pow(10, nd) : Math.round(a[0])); } break;
            case 0xF5: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const x = a[0] | 0, y = a[1] | 0; this.stack.push(y !== 0 ? Math.floor(x / y) : 0); this.stack.push(y !== 0 ? x % y : 0); } break;
            case 0xF6: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const base = a[0], exp = a[1], mod = n >= 3 ? a[2] : undefined; this.stack.push(mod != null ? (Math.pow(base, exp) % mod) : Math.pow(base, exp)); } break;
            case 0xF7: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const it = Array.isArray(a[0]) ? a[0] : []; this.stack.push(it.length ? (it.every(x => x) ? 1 : 0) : 1); } break;
            case 0xF8: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const it = Array.isArray(a[0]) ? a[0] : []; this.stack.push(it.some(x => x) ? 1 : 0); } break;
            case 0xF9: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); this.stack.push(JSON.stringify(a[0])); } break;
            case 0xFA: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); this.stack.push((a[0] | 0).toString(2)); } break;
            case 0xFB: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); this.stack.push((a[0] | 0).toString(16)); } break;
            case 0xFC: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); this.stack.push((a[0] | 0).toString(8)); } break;
            case 0xFD: { this.stack.pop(); this.stack.push(this.config.prompt ? this.config.prompt() : ''); } break;
            case 0xFE: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const lists = a; const len = Math.min(...lists.map(l => Array.isArray(l) ? l.length : 0)); const out = []; for (let i = 0; i < len; i++) out.push(lists.map(l => l[i])); this.stack.push(out); } break;
            case 0xFF: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const it = Array.isArray(a[0]) ? a[0] : []; const start = n >= 2 ? (a[1] | 0) : 0; this.stack.push(it.map((v, i) => [start + i, v])); } break;
            case 0xCA: { const n = this.stack.pop(); const a = []; for (let i = 0; i < n; i++) a.unshift(this.stack.pop()); const lo = (n >= 2 ? a[0] : 0) | 0; const hi = (n >= 2 ? a[1] : (a[0] | 0)) | 0; const range = hi - lo; this.stack.push(range <= 0 ? lo : lo + Math.floor(Math.random() * range)); } break;

            // --- Missing Math Syscalls ---
            case 0xB0: this.stack.push(Math.sqrt(this.stack.pop())); break; // math.sqrt
            case 0xB1: this.stack.push(Math.abs(this.stack.pop())); break;  // abs
            case 0xB2: this.stack.push(Math.PI); break;                   // math.pi
            case 0xB3: this.stack.push(Math.E); break;                    // math.e

            // --- Missing System Syscalls ---
            case 0xC0: if (this.isNode) process.exit(this.stack.pop() || 0); else this.running = false; break; // sys.exit
            case 0xC1: // os.system
                {
                    const cmd = this.getString(this.stack.pop());
                    if (this.isNode) {
                        try { require('child_process').execSync(cmd, { stdio: 'inherit' }); this.stack.push(0); }
                        catch (e) { this.stack.push(1); }
                    } else { this.print(`[OS SYSTEM] ${cmd}\n`); this.stack.push(0); }
                } break;
            case 0xC2: // time.sleep
                { const ms = (this.stack.pop() * 1000) | 0; const start = Date.now(); while (Date.now() - start < ms); } break;

            // --- Collections: set, dict, list constructors ---
            case 0x90: this.stack.push(new Set()); break;
            case 0x91: { const val = this.stack.pop(); const s = this.stack.pop(); if (s instanceof Set) s.add(val); } break;
            case 0x92: this.stack.push(new Map()); break;
            case 0x94: { const key = this.stack.pop(); const d = this.stack.pop(); this.stack.push(d instanceof Map ? d.get(key) : undefined); } break;
            case 0x95: this.stack.push([]); break;
        }
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = SoulVM;
else window.SoulVM = SoulVM;

if (typeof process !== 'undefined' && process.argv && process.argv.length > 2) {
    const useRamFS = process.argv.includes('--ramfs');

    // Command line output capture not relevant for CLI unless requested?
    // CLI users usually want stdout. 
    // We only enable outputMode via config, CLI default is logs to stdout.

    const vm = new SoulVM({ useRamFS });
    const fileArg = process.argv.find((arg, i) => i > 1 && !arg.startsWith('--'));
    if (fileArg) vm.load(fileArg).then(() => vm.run());
}
