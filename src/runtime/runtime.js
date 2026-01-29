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
            useRamFS: config.useRamFS || false,
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

        // Improved RAM FS
        this.ramFS = new Map();

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
                return addr;
            }
            prev = curr;
            curr = curr.next;
        }
        const addr = this.heapOffset;
        this.heapOffset += size;
        if (this.heapOffset > this.config.maxMemory) throw new Error("Out of memory");
        return addr;
    }

    free(addr, size) {
        const block = new FreeBlock(addr, size, this.freeList);
        this.freeList = block;
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
                    } break;
                case 0x0D: this.pc = this.callStack.pop(); break;

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
        // ... (Copy of logic for 0x52-0xC2 from previous implementation) ...
        // Re-implementing essential logic here to ensure it works.
        switch (op) {
            case 0x52: {
                const sz = this.bytecode[this.pc++]; const a = this.stack.pop();
                if (sz === 1) this.stack.push(this.memory[a]);
                else this.stack.push(new DataView(this.memory.buffer).getInt32(a, true));
            } break;
            case 0x53: {
                const sz = this.bytecode[this.pc++]; const v = this.stack.pop(); const a = this.stack.pop();
                if (sz === 1) this.memory[a] = v & 0xFF;
                else new DataView(this.memory.buffer).setInt32(a, v, true);
            } break;
            case 0x54: this.readString(); this.stack.push(this.malloc(16)); break;
            // ... (Includes logic for 0x90-0xC2)
            // Advanced Data Structures
            case 0x90: this.stack.push(new Set()); break;
            case 0x91: { const s = this.stack.pop(); const v = this.stack.pop(); s.add(v); this.stack.push(null); } break;
            case 0x92: this.stack.push(new Map()); break;
            case 0x93: { const m = this.stack.pop(); const v = this.stack.pop(); const k = this.stack.pop(); m.set(k, v); this.stack.push(null); } break;
            case 0x94: { const m = this.stack.pop(); const k = this.stack.pop(); this.stack.push(m.get(k)); } break;
            case 0x95: this.stack.push([]); break;
            case 0x96: { const l = this.stack.pop(); const v = this.stack.pop(); l.push(v); this.stack.push(null); } break;
            case 0x97: { const l = this.stack.pop(); this.stack.push(l.shift()); } break;
            case 0x98: { const l = this.stack.pop(); this.stack.push(l.pop()); } break;

            // Strings
            case 0xA0: this.stack.push(this.stack.pop().toLowerCase()); break;
            case 0xA1: this.stack.push(this.stack.pop().toUpperCase()); break;
            case 0xA2: { const s = this.stack.pop(); const sep = this.stack.pop(); this.stack.push(s.split(sep)); } break;
            case 0xA3: { const s = this.stack.pop(); const list = this.stack.pop(); if (Array.isArray(list)) this.stack.push(list.join(s)); else this.stack.push(s); } break;
            case 0xA4: { const s = this.stack.pop(); const b = this.stack.pop(); const a = this.stack.pop(); this.stack.push(s.replace(a, b)); } break;
            case 0xA5: { const s = this.stack.pop(); const sub = this.stack.pop(); this.stack.push(s.indexOf(sub)); } break;
            case 0xA6: { const s = this.stack.pop(); const sub = this.stack.pop(); this.stack.push(s.startsWith(sub)); } break;
            case 0xA7: this.stack.push(this.stack.pop().trim()); break;

            // Math
            case 0xB0: this.stack.push(Math.sqrt(this.stack.pop())); break;
            case 0xB1: this.stack.push(Math.abs(this.stack.pop())); break;
            case 0xB2: this.stack.push(Math.PI); break;
            case 0xB3: this.stack.push(Math.E); break;

            // System
            case 0xC0: if (this.isNode) process.exit(this.stack.pop()); break;
            case 0xC1: if (this.isNode) { try { require('child_process').execSync(this.stack.pop(), { stdio: 'inherit' }); this.stack.push(0); } catch (e) { this.stack.push(1); } } else this.stack.push(-1); break;
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
            // ... (Other syscalls simpler)
            case 0x62: this.stack.push(this.getString(this.stack.pop()).length); break;
            case 0x80: this.stack.push(Math.floor(Date.now() / 1000)); break;
            case 0x81: this.stack.pop(); this.stack.push(new Date().toLocaleString()); break;
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
