#include <iostream>
#include <vector>
#include <string>
#include <fstream>
#include <set>
#include <algorithm>
#include <sstream>
#include <cstdio>
#include "lexer.hpp"

// Forward declaration
std::string preprocess(const std::string& source, const std::string& currentDir = "", const std::vector<std::string>& includePaths = {});

enum OpCode {
    HALT = 0x00, PUSH_INT = 0x01, PUSH_STR = 0x02, SYSCALL = 0x03, 
    STORE = 0x04, LOAD = 0x05, ADD = 0x06, SUB = 0x07, MUL = 0x08, DIV = 0x09,
    JMP = 0x0A, JZ = 0x0B, CALL = 0x0C, RET = 0x0D,
    FOR_ITER = 0x0E, TRY_ENTER = 0x0F, TRY_EXIT = 0x10, RAISE = 0x11,
    MOD = 0x12, LSHIFT = 0x13, RSHIFT = 0x14, BIT_AND = 0x15, BIT_OR = 0x16, BIT_XOR = 0x17, BIT_NOT = 0x18,
    EQ = 0x19, NE = 0x1A, LT = 0x1B, LE = 0x1C, GT = 0x1D, GE = 0x1E,
    LOGIC_AND = 0x1F, LOGIC_OR = 0x20, LOGIC_NOT = 0x21,
    
    // WASM-like: Stack Manipulation & Arithmetic
    NEG = 0x22, INC = 0x23, DEC = 0x24, ABS = 0x25,
    MIN = 0x26, MAX = 0x27, CLAMP = 0x28,
    I32_TO_F32 = 0x29, F32_TO_I32 = 0x2A, I32_TO_I64 = 0x2B, I64_TO_I32 = 0x2C,
    DUP = 0x2D, SWAP = 0x2E, ROT = 0x2F, DROP = 0x30, PICK = 0x31,
    
    // Memory operations (Relocated)
    MALLOC = 0xE0, FREE = 0xE1, READ_ADDR = 0xE2, WRITE_ADDR = 0xE3, ADDR_OF = 0xE4,
    
    // WASM-like: Module System & Function Tables
    EXPORT = 0x5B, IMPORT = 0x5C, MODULE_GET = 0x5D, // Re-assigned from conflicting range
    TABLE_GET = 0x58, TABLE_SET = 0x59, CALL_INDIRECT = 0x5A,
    
    // WASM-like: Enhanced Memory Operations (Relocated)
    MEMORY_SIZE = 0xE5, MEMORY_GROW = 0xE6, MEMORY_COPY = 0xE7, MEMORY_FILL = 0xE8,
    
    // WASM-like: Standard I32 Opcodes (New)
    I32_EQZ = 0x45, I32_EQ = 0x46, I32_NE = 0x47, I32_LT_S = 0x48, I32_LT_U = 0x49,
    I32_GT_S = 0x4A, I32_GT_U = 0x4B, I32_LE_S = 0x4C, I32_LE_U = 0x4D, I32_GE_S = 0x4E, I32_GE_U = 0x4F,
    
    // WASM-like: Standard I64 Opcodes
    I64_EQZ = 0x50, I64_EQ = 0x51, I64_NE = 0x52, I64_LT_S = 0x53, I64_LT_U = 0x54,
    I64_GT_S = 0x55, I64_GT_U = 0x56, I64_LE_S = 0x57, I64_LE_U = 0x58, I64_GE_S = 0x59, I64_GE_U = 0x5A,
    
    // WASM-like: Standard F32 Opcodes (New)
    F32_EQ = 0x5B, F32_NE = 0x5C, F32_LT = 0x5D, F32_GT = 0x5E, F32_LE = 0x5F, F32_GE = 0x60,
    
    // WASM-like: Standard F64 Opcodes (New)
    F64_EQ = 0x61, F64_NE = 0x62, F64_LT = 0x63, F64_GT = 0x64, F64_LE = 0x65, F64_GE = 0x66,
    
    // WASM-like: Memory Operations (Relocated)
    
    LOAD_I8 = 0x5F, LOAD_I16 = 0x61, LOAD_U16 = 0x62,
    LOAD_F32 = 0x64, LOAD_F64 = 0x65,
    STORE_I8 = 0x66, STORE_I16 = 0x67, STORE_I32 = 0x68,
    STORE_F32 = 0x69, STORE_F64 = 0x6A,
    JNZ = 0x6B, JGT = 0x6C, JLT = 0x6D,
    
    // WASM-like: Type System
    TYPE_OF = 0x74, TYPE_CHECK = 0x75, TYPE_CAST = 0x76,
    
    // WASM-like: Profiling & Debugging
    PROFILE_START = 0x77, PROFILE_END = 0x78, BREAKPOINT = 0x79, TRACE = 0x7A,
    
    // WASM-like: Atomic Operations
    ATOMIC_LOAD = 0x7B, ATOMIC_STORE = 0x7C, ATOMIC_ADD = 0x7D
};

struct Field { std::string name; int offset; };
struct Type { std::string name; int size; bool isPointer; std::vector<Field> fields; };

class Compiler {
public:
    Compiler(const std::vector<Token>& tokens, bool verbose = false, bool pythonMode = false) : tokens(tokens), pos(0), verbose(verbose), pythonMode(pythonMode) {
        types["int"] = {"int", 4, false};
        types["char"] = {"char", 1, false};
        types["void"] = {"void", 0, false};
        types["FILE"] = {"void*", 4, true};
        types["const"] = {"void", 0, false};
        types["size_t"] = {"int", 4, false};
        types["string"] = {"string", 4, false};
        types["Task"] = {"void", 0, false};
        types["var"] = {"void", 0, false};
        types["bool"] = {"bool", 1, false};
        types["_Bool"] = {"bool", 1, false};
        types["double"] = {"double", 8, false};
        types["float"] = {"float", 4, false};
        types["time_t"] = {"int", 4, false};
        types["Point"] = {"Point", 8, false, {{"x", 0}, {"y", 4}}};
        types["IntFloat"] = {"IntFloat", 4, false, {{"i", 0}, {"f", 0}}};
        types["Color"] = {"int", 4, false};
        // C++ scalar types
        types["short"] = {"short", 2, false};
        types["long"] = {"long", 4, false};
        types["signed"] = {"int", 4, false};
        types["unsigned"] = {"unsigned", 4, false};
        types["wchar_t"] = {"wchar_t", 2, false};
        types["char8_t"] = {"char8_t", 1, false};
        types["char16_t"] = {"char16_t", 2, false};
        types["char32_t"] = {"char32_t", 4, false};
        // Advanced Data Structures
        types["set"] = {"set", 4, true};
        types["dict"] = {"dict", 4, true};
        types["deque"] = {"deque", 4, true};
        types["queue"] = {"queue", 4, true};
        types["heap"] = {"heap", 4, true};
        types["tuple"] = {"tuple", 4, true};
    }

    std::vector<uint8_t> compile() {
        if (verbose) std::cout << "Starting compilation..." << std::endl;
        while (pos < tokens.size() && tokens[pos].type != TokenType::END_OF_FILE) {
            parseTopLevel();
        }
        std::string entry = symbolTable.count("main") ? "main" : (symbolTable.count("Main") ? "Main" : "");
        if (entry != "") { 
            if (verbose) std::cout << "Entry point found: " << entry << std::endl;
            emitOp(CALL); emitString(entry); 
        }
        emitOp(HALT);
        return bytecode;
    }

private:
    std::vector<Token> tokens;
    size_t pos;
    std::vector<uint8_t> bytecode;
    std::map<std::string, int> symbolTable;
    std::map<std::string, Type> types;
    std::string modulePrefix; 
    bool verbose;
    bool pythonMode;

    bool isDeclModifier(const std::string& v) {
        static const std::set<std::string> modifiers = {
            "static", "extern", "public", "private", "protected", "async", "readonly", "sealed", "typedef",
            "alignas", "alignof", "asm", "auto", "const", "consteval", "constexpr", "constinit",
            "explicit", "export", "inline", "mutable", "register", "thread_local", "virtual", "volatile",
            "template", "typename", "concept", "requires", "noexcept", "friend", "restrict", "override", "final",
            "operator", "this", "new", "delete", "throw", "co_await", "co_return", "co_yield", "decltype",
            "_Alignas", "_Alignof", "_Atomic", "_Bool", "_Complex", "_Generic", "_Imaginary",
            "_Noreturn", "_Static_assert", "_Thread_local", "typeof", "typeof_unqual"
        };
        return modifiers.count(v);
    }

    void skipAlignasAlignof() {
        if (pos >= tokens.size()) return;
        const std::string& v = tokens[pos].value;
        if (v != "alignas" && v != "alignof" && v != "_Alignas" && v != "_Alignof") return;
        pos++;
        if (pos < tokens.size() && tokens[pos].type == TokenType::LPAREN) {
            pos++; int depth = 1;
            while (pos < tokens.size() && depth > 0) {
                if (tokens[pos].type == TokenType::LPAREN) depth++;
                else if (tokens[pos].type == TokenType::RPAREN) depth--;
                pos++;
            }
        }
    }

    void skipStaticAssert() {
        if (pos >= tokens.size()) return;
        const std::string& v = tokens[pos].value;
        if (v != "static_assert" && v != "_Static_assert") return;
        pos++;
        if (pos < tokens.size() && tokens[pos].type == TokenType::LPAREN) {
            pos++; int depth = 1;
            while (pos < tokens.size() && depth > 0) {
                if (tokens[pos].type == TokenType::LPAREN) depth++;
                else if (tokens[pos].type == TokenType::RPAREN) depth--;
                pos++;
            }
            if (pos < tokens.size() && tokens[pos].type == TokenType::SEMICOLON) pos++;
        }
    }

    void skipTypeof() {
        if (pos >= tokens.size()) return;
        const std::string& v = tokens[pos].value;
        if (v != "typeof" && v != "typeof_unqual") return;
        pos++;
        if (pos < tokens.size() && tokens[pos].type == TokenType::LPAREN) {
            pos++; int depth = 1;
            while (pos < tokens.size() && depth > 0) {
                if (tokens[pos].type == TokenType::LPAREN) depth++;
                else if (tokens[pos].type == TokenType::RPAREN) depth--;
                pos++;
            }
        }
    }

    std::string mangle(const std::string& name) const {
        return modulePrefix.empty() ? name : modulePrefix + name;
    }

    void parseTopLevel() {
        if (pos >= tokens.size()) return;
        if (verbose && tokens[pos].type != TokenType::INDENT && tokens[pos].type != TokenType::DEDENT) 
            std::cout << "Parsing: " << tokens[pos].value << " at line " << tokens[pos].line << std::endl;
        
        if (tokens[pos].value == "__module__") {
            pos++;
            if (pos < tokens.size()) { modulePrefix = tokens[pos++].value + "."; }
            return;
        }
        if (tokens[pos].value == "__endmodule__") {
            pos++; modulePrefix.clear();
            if (pos < tokens.size() && tokens[pos].type == TokenType::SEMICOLON) pos++;
            return;
        }
        while (pos < tokens.size() && isDeclModifier(tokens[pos].value)) {
            const std::string& v = tokens[pos].value;
            if (v == "alignas" || v == "alignof" || v == "_Alignas" || v == "_Alignof") { skipAlignasAlignof(); continue; }
            if (v == "static_assert" || v == "_Static_assert") { skipStaticAssert(); continue; }
            if (v == "typeof" || v == "typeof_unqual") { skipTypeof(); continue; }
            pos++;
        }
        if (pos >= tokens.size()) return;
        Token t = tokens[pos];
        if (verbose) printf("Token: %s at line %d\n", t.value.c_str(), t.line);

        if (t.type == TokenType::KEYWORD || t.type == TokenType::IDENTIFIER) {
            if (t.value == "using" || t.value == "import" || t.value == "module" || t.value == "export") {
                pos++; while(pos < tokens.size() && tokens[pos].type != TokenType::SEMICOLON) pos++;
                if (pos < tokens.size()) pos++; return;
            }
            if (t.value == "namespace" || t.value == "class" || t.value == "struct" || t.value == "union" || t.value == "enum") {
                pos++; if (pos < tokens.size() && tokens[pos].type == TokenType::IDENTIFIER) pos++;
                if (pos < tokens.size() && tokens[pos].type == TokenType::LBRACE) {
                    pos++; while(pos < tokens.size() && tokens[pos].type != TokenType::RBRACE) parseTopLevel();
                    if (pos < tokens.size()) pos++; if (pos < tokens.size() && tokens[pos].type == TokenType::SEMICOLON) pos++;
                }
                return;
            }
            if (t.value == "def" || types.count(t.value)) {
                parseDeclaration(); return;
            }
        }
        parseStatement();
    }

    std::string parseTypeName() {
        std::string typeName;
        while (pos < tokens.size()) {
            const std::string& v = tokens[pos].value;
            bool isSpec = (v == "unsigned" || v == "signed" || v == "long" || v == "short" || v == "char" || v == "char8_t" || v == "char16_t" || v == "char32_t" || v == "wchar_t" || v == "int" || v == "float" || v == "double" || v == "void" || v == "bool" || v == "_Bool");
            if (!isSpec) break;
            if (!typeName.empty()) typeName += " ";
            typeName += v;
            pos++;
        }
        if (typeName.empty() && pos < tokens.size() && (tokens[pos].type == TokenType::KEYWORD || tokens[pos].type == TokenType::IDENTIFIER)) {
            typeName = tokens[pos++].value;
        }
        return typeName;
    }

    int getTypeSize(const std::string& typeName) {
        if (types.count(typeName)) return types[typeName].size;
        if (typeName.find("double") != std::string::npos) return 8;
        if (typeName.find("float") != std::string::npos) return 4;
        if (typeName.find("short") != std::string::npos) return 2;
        if (typeName.find("long") != std::string::npos) return 4;
        if (typeName.find("char") != std::string::npos && typeName.find("32") != std::string::npos) return 4;
        if (typeName.find("char") != std::string::npos && typeName.find("16") != std::string::npos) return 2;
        if (typeName.find("char") != std::string::npos) return 1;
        if (typeName.find("wchar") != std::string::npos) return 2;
        if (typeName.find("unsigned") != std::string::npos || typeName.find("signed") != std::string::npos || typeName.find("int") != std::string::npos) return 4;
        return 4;
    }

    void parseDeclaration() {
        std::string typeName = parseTypeName();
        if (typeName.empty()) return;
        while (pos < tokens.size() && (tokens[pos].type == TokenType::STAR || tokens[pos].value == "?")) pos++;
        std::string name = pos < tokens.size() ? tokens[pos++].value : "";
        if (name.empty()) return;

        std::string sym = mangle(name);
        if (pos < tokens.size() && tokens[pos].type == TokenType::LPAREN) {
            // Function
            pos++;
            std::vector<std::string> args;
            while (pos < tokens.size() && tokens[pos].type != TokenType::RPAREN) {
                std::string argType = parseTypeName();
                while (pos < tokens.size() && (tokens[pos].type == TokenType::STAR || tokens[pos].value == "?")) pos++;
                if (pos < tokens.size() && tokens[pos].type == TokenType::IDENTIFIER) {
                    args.push_back(tokens[pos++].value);
                }
                if (pos < tokens.size() && tokens[pos].type == TokenType::COMMA) pos++;
            }
            if (pos < tokens.size()) pos++; // Skip )
            if (pos < tokens.size() && tokens[pos].type == TokenType::COLON) pos++; 

            int startPlace = bytecode.size();
            emitPushInt(0); emitOp(STORE); emitString(sym);
            int skipJump = bytecode.size(); emitJump(JMP, 0);

            int bodyStart = bytecode.size();
            symbolTable[sym] = bodyStart;
            patchInt(startPlace + 1, bodyStart);

            // Pop arguments in reverse order
            for (int i = args.size() - 1; i >= 0; i--) {
                emitOp(STORE); emitString(mangle(args[i]));
            }

            parseBlock();
            emitOp(RET);
            patchInt(skipJump + 1, bytecode.size());
        } else {
            // Variable (including package constants)
            if (pos < tokens.size() && tokens[pos].type == TokenType::LBRACKET) {
                pos++; if (pos < tokens.size() && tokens[pos].type == TokenType::RBRACKET) pos++;
            }
            if (pos < tokens.size() && tokens[pos].type == TokenType::EQUALS) {
                pos++;
                if (tokens[pos].type == TokenType::LBRACE) {
                    pos++; int i = 0;
                    while(pos < tokens.size() && tokens[pos].type != TokenType::RBRACE) {
                        parseExpression();
                        if (types.count(typeName) && i < types[typeName].fields.size()) {
                            std::string m = sym + "." + types[typeName].fields[i++].name;
                            emitOp(STORE); emitString(m);
                        } else { emitOp(STORE); emitString(sym + "[" + std::to_string(i++) + "]"); }
                        if (tokens[pos].type == TokenType::COMMA) pos++;
                    }
                    if (pos < tokens.size()) pos++;
                } else {
                    parseExpression(); emitOp(STORE); emitString(sym);
                }
            }
            if (pos < tokens.size() && tokens[pos].type == TokenType::SEMICOLON) pos++;
        }
    }

    void parseBlock() {
        if (pos < tokens.size() && (tokens[pos].type == TokenType::INDENT || tokens[pos].type == TokenType::LBRACE)) {
            TokenType end = (tokens[pos].type == TokenType::INDENT) ? TokenType::DEDENT : TokenType::RBRACE;
            pos++; while (pos < tokens.size() && tokens[pos].type != end) parseTopLevel();
            if (pos < tokens.size()) pos++;
        } else parseTopLevel();
    }

    void parseStatement() {
        if (pos >= tokens.size()) return;
        Token t = tokens[pos++];
        if (t.value == "for") {
            if (tokens[pos].type == TokenType::LPAREN) pos++;
            std::string var = tokens[pos++].value;
            if (tokens[pos].value == "in") pos++;
            parseExpression();
            if (tokens[pos].type == TokenType::RPAREN) pos++;

            int loopStart = bytecode.size();
            emitOp(FOR_ITER); 
            int patchFor = bytecode.size(); emitInt(0);
            
            emitOp(STORE); emitString(mangle(var));
            parseBlock();
            emitJump(JMP, loopStart);
            patchInt(patchFor, bytecode.size());
            return;
        }
        if (t.value == "try") {
            emitOp(TRY_ENTER); int patchTry = bytecode.size(); emitInt(0);
            parseBlock();
            emitOp(TRY_EXIT);
            int skipCatch = bytecode.size(); emitJump(JMP, 0);
            
            patchInt(patchTry, bytecode.size());
            if (pos < tokens.size() && (tokens[pos].value == "except" || tokens[pos].value == "catch")) {
                pos++;
                if (pos < tokens.size() && tokens[pos].type == TokenType::LPAREN) {
                    pos++; while(pos < tokens.size() && tokens[pos].type != TokenType::RPAREN) pos++; pos++;
                }
                if (pos < tokens.size() && tokens[pos].type == TokenType::COLON) pos++;
                parseBlock();
            }
            patchInt(skipCatch + 1, bytecode.size());
            return;
        }
        if (t.value == "raise" || t.value == "throw") {
            parseExpression(); emitOp(RAISE); if (pos < tokens.size() && tokens[pos].type == TokenType::SEMICOLON) pos++; return;
        }
        if (t.value == "if") {
            if (tokens[pos].type == TokenType::LPAREN) pos++;
            parseExpression(); if (tokens[pos].type == TokenType::RPAREN) pos++;
            emitOp(JZ); int patch = bytecode.size(); emitInt(0);
            parseBlock();
            while (pos < tokens.size() && (tokens[pos].value == "elif" || tokens[pos].value == "else")) {
                if (tokens[pos].value == "elif") {
                    pos++; int skipElif = bytecode.size(); emitJump(JMP, 0);
                    patchInt(patch, bytecode.size());
                    if (tokens[pos].type == TokenType::LPAREN) pos++;
                    parseExpression(); if (tokens[pos].type == TokenType::RPAREN) pos++;
                    emitOp(JZ); patch = bytecode.size(); emitInt(0);
                    parseBlock();
                    patchInt(skipElif + 1, bytecode.size());
                } else {
                    pos++; int skipElse = bytecode.size(); emitJump(JMP, 0);
                    patchInt(patch, bytecode.size());
                    parseBlock();
                    patchInt(skipElse + 1, bytecode.size());
                    break;
                }
            }
            patchInt(patch, bytecode.size());
            return;
        }
        if (t.value == "return") { parseExpression(); emitOp(RET); if (pos < tokens.size() && tokens[pos].type == TokenType::SEMICOLON) pos++; return; }
        if (t.value == "yield") { parseExpression(); if (pos < tokens.size() && tokens[pos].type == TokenType::SEMICOLON) pos++; return; }
        // Python: pass (no-op), del, global, nonlocal, with, assert
        if (t.value == "pass") { if (pos < tokens.size() && tokens[pos].type == TokenType::SEMICOLON) pos++; return; }
        if (t.value == "del" || t.value == "global" || t.value == "nonlocal") {
            while (pos < tokens.size() && tokens[pos].type != TokenType::SEMICOLON) pos++;
            if (pos < tokens.size()) pos++; return;
        }
        if (t.value == "with") {
            while (pos < tokens.size() && tokens[pos].type != TokenType::COLON) pos++;
            if (pos < tokens.size()) pos++; parseBlock(); return;
        }
        if (t.value == "assert") {
            parseExpression();
            emitOp(JZ); int patchAssert = bytecode.size(); emitInt(0);
            if (pos < tokens.size() && tokens[pos].type == TokenType::COMMA) { pos++; parseExpression(); }
            int abortAddr = bytecode.size();
            emitPushInt(1); emitSyscall(0xE0);
            patchInt(patchAssert, abortAddr);
            if (pos < tokens.size() && tokens[pos].type == TokenType::SEMICOLON) pos++;
            return;
        }
        // C++ / Python control flow: skip break/continue/switch/case/default/do/lambda/async/await/match
        if (t.value == "break" || t.value == "continue" || t.value == "switch" || t.value == "case" || t.value == "default" || t.value == "do" || t.value == "lambda" || t.value == "async" || t.value == "await" || t.value == "match") {
            while (pos < tokens.size() && tokens[pos].type != TokenType::SEMICOLON && tokens[pos].type != TokenType::COLON) pos++;
            if (pos < tokens.size() && tokens[pos].type == TokenType::COLON) { pos++; parseBlock(); }
            else if (pos < tokens.size()) pos++;
            return;
        }
        // Catch-all: any other keyword at statement start (C/C++/Python) — skip until ; or :
        pos--;
        if (types.count(tokens[pos].value)) { parseDeclaration(); return; }
        parseExpression();
        if (pos < tokens.size() && tokens[pos].type == TokenType::SEMICOLON) pos++;
    }

    std::string parseExpression(int minPrecedence = 0) {
        std::string leftName = parsePrimary();
        while (pos < tokens.size()) {
            Token op = tokens[pos];
            int prec = getPrecedence(op);
            if (prec < minPrecedence || prec == -1) break;
            pos++;
            if (op.type == TokenType::COLON_EQUALS) {
                // Walrus: name := expr
                if (!leftName.empty()) {
                    parseExpression(prec + 1);
                    emitOp(STORE); emitString(mangle(leftName));
                    emitOp(LOAD); emitString(mangle(leftName));
                    leftName = ""; 
                }
                continue; 
            }
            parseExpression(prec + 1);
            emitBinaryOp(op.type);
            leftName = ""; 
        }
        return ""; 
    }

    int getPrecedence(Token t) {
        switch (t.type) {
            case TokenType::LOR: return 1;
            case TokenType::LAND: return 2;
            case TokenType::PIPE: return 3;
            case TokenType::CARET: return 4;
            case TokenType::AMPERSAND: return 5;
            case TokenType::EQUALS_EQUALS: case TokenType::NOT_EQ: return 6;
            case TokenType::LT: case TokenType::LE: case TokenType::GT: case TokenType::GE: return 7;
            case TokenType::LSHIFT: case TokenType::RSHIFT: return 8;
            case TokenType::PLUS: case TokenType::MINUS: return 9;
            case TokenType::STAR: case TokenType::SLASH: case TokenType::MOD: return 10;
            case TokenType::COLON_EQUALS: return 0;
            default: return -1;
        }
    }

    void emitBinaryOp(TokenType type) {
        // PEEPHOLE OPTIMIZATION: Constant Folding
        // Check if the last two instructions were PUSH_INT
        if (bytecode.size() >= 10 && 
            bytecode[bytecode.size() - 5] == PUSH_INT && 
            bytecode[bytecode.size() - 10] == PUSH_INT) {
            
            // Extract values
            int v2 = (bytecode[bytecode.size()-4] << 24) | (bytecode[bytecode.size()-3] << 16) | (bytecode[bytecode.size()-2] << 8) | bytecode[bytecode.size()-1];
            int v1 = (bytecode[bytecode.size()-9] << 24) | (bytecode[bytecode.size()-8] << 16) | (bytecode[bytecode.size()-7] << 8) | bytecode[bytecode.size()-6];
            
            bool optimized = true;
            int result = 0;
            
            switch (type) {
                case TokenType::PLUS: result = v1 + v2; break;
                case TokenType::MINUS: result = v1 - v2; break;
                case TokenType::STAR: result = v1 * v2; break;
                case TokenType::SLASH: if(v2 == 0) optimized = false; else result = v1 / v2; break;
                case TokenType::MOD: if(v2 == 0) optimized = false; else result = v1 % v2; break;
                case TokenType::LSHIFT: result = v1 << v2; break;
                case TokenType::RSHIFT: result = v1 >> v2; break;
                case TokenType::AMPERSAND: result = v1 & v2; break;
                case TokenType::PIPE: result = v1 | v2; break;
                case TokenType::CARET: result = v1 ^ v2; break;
                default: optimized = false; break;
            }
            
            if (optimized) {
                // Remove last 10 bytes
                bytecode.resize(bytecode.size() - 10);
                emitPushInt(result);
                if (verbose) std::cout << "Optimized: " << v1 << " op " << v2 << " -> " << result << std::endl;
                return;
            }
        }

        switch (type) {
            case TokenType::PLUS: emitOp(ADD); break;
            case TokenType::MINUS: emitOp(SUB); break;
            case TokenType::STAR: emitOp(MUL); break;
            case TokenType::SLASH: emitOp(DIV); break;
            case TokenType::EQUALS_EQUALS: emitOp(EQ); break;
            case TokenType::NOT_EQ: emitOp(NE); break;
            case TokenType::LT: emitOp(LT); break;
            case TokenType::LE: emitOp(LE); break;
            case TokenType::GT: emitOp(GT); break;
            case TokenType::GE: emitOp(GE); break;
            case TokenType::LAND: emitOp(LOGIC_AND); break;
            case TokenType::LOR: emitOp(LOGIC_OR); break;
            case TokenType::AMPERSAND: emitOp(BIT_AND); break;
            case TokenType::PIPE: emitOp(BIT_OR); break;
            case TokenType::CARET: emitOp(BIT_XOR); break;
            case TokenType::MOD: emitOp(MOD); break;
            case TokenType::LSHIFT: emitOp(LSHIFT); break;
            case TokenType::RSHIFT: emitOp(RSHIFT); break;
            default: break;
        }
    }

    std::string parsePrimary() {
        if (pos >= tokens.size()) return "";
        Token t = tokens[pos++];
        
        // Handle F-Strings by joining parts
        if (t.type == TokenType::FSTRING_PART || t.type == TokenType::LBRACE_EXP) {
            pos--; // put back to use unified logic
            bool first = true;
            while (pos < tokens.size() && (tokens[pos].type == TokenType::FSTRING_PART || tokens[pos].type == TokenType::LBRACE_EXP)) {
                Token ft = tokens[pos++];
                if (ft.type == TokenType::FSTRING_PART) {
                    emitOp(PUSH_STR); emitString(ft.value);
                } else {
                    parseExpression();
                    if (pos < tokens.size() && tokens[pos].type == TokenType::RBRACE_EXP) pos++;
                    emitPushInt(1); emitSyscall(0xEF); // str()
                }
                if (!first) emitOp(ADD);
                first = false;
            }
            return "";
        }

        if (t.type == TokenType::LPAREN) {
            parseExpression();
            if (pos < tokens.size() && tokens[pos].type == TokenType::RPAREN) pos++;
            return "";
        }

        if (t.type == TokenType::LBRACKET) { // Array literal [1, 2, 3]
            emitOp(0x95); // LIST_NEW
            while (pos < tokens.size() && tokens[pos].type != TokenType::RBRACKET) {
                parseExpression();
                emitOp(0x96); // LIST_APPEND
                if (pos < tokens.size() && tokens[pos].type == TokenType::COMMA) pos++;
            }
            if (pos < tokens.size()) pos++;
            return "";
        }

        if (t.type == TokenType::LBRACE && !pythonMode) { // Dict literal {k: v} (simple heuristic)
            emitOp(0x92); // DICT_NEW (MAP)
            while (pos < tokens.size() && tokens[pos].type != TokenType::RBRACE) {
                parseExpression(); // Key
                if (pos < tokens.size() && tokens[pos].type == TokenType::COLON) pos++;
                parseExpression(); // Value
                emitOp(0x93); // DICT_SET
                if (pos < tokens.size() && tokens[pos].type == TokenType::COMMA) pos++;
            }
            if (pos < tokens.size()) pos++;
            return "";
        }

        if (t.type == TokenType::MINUS) { // Unary minus
            parsePrimary();
            emitPushInt(-1);
            emitOp(MUL);
            return "";
        }
        if (t.type == TokenType::NOT || (t.type == TokenType::KEYWORD && t.value == "not")) {
            parsePrimary();
            emitOp(LOGIC_NOT);
            return "";
        }
        // C++ nullptr
        if (t.type == TokenType::KEYWORD && t.value == "nullptr") {
            emitPushInt(0);
            return "";
        }
        // C++ sizeof(type) or sizeof expr
        if (t.type == TokenType::KEYWORD && t.value == "sizeof") {
            if (pos < tokens.size() && tokens[pos].type == TokenType::LPAREN) {
                pos++;
                std::string saveType = parseTypeName();
                if (pos < tokens.size() && tokens[pos].type == TokenType::RPAREN) pos++;
                emitPushInt(getTypeSize(saveType));
            } else {
                std::string saveType = parseTypeName();
                emitPushInt(getTypeSize(saveType));
            }
            return "";
        }
        // Unary * (pointer dereference)
        if (t.type == TokenType::STAR) {
            parseExpression(); // addr
            emitPushInt(0); // index
            emitOp(READ_ADDR);
            bytecode.push_back(4);
            return "";
        }
        // Unary & (address-of)
        if (t.type == TokenType::AMPERSAND) {
            parseExpression();
            return "";
        }
        if (t.type == TokenType::KEYWORD && t.value == "true") { emitPushInt(1); return ""; }
        if (t.type == TokenType::KEYWORD && t.value == "false") { emitPushInt(0); return ""; }
        
        std::string name = "";
        if (t.type == TokenType::IDENTIFIER) {
            name = t.value;
        } else if (t.type == TokenType::INTEGER) { 
            try { emitPushInt(std::stoi(t.value)); } catch(...) { emitPushInt(0); }
        } else if (t.type == TokenType::STRING) { emitOp(PUSH_STR); emitStringLiteral(t.value); }
        
        while (pos < tokens.size()) {
            if (tokens[pos].type == TokenType::DOT || tokens[pos].type == TokenType::ARROW) {
                pos++; std::string field = tokens[pos++].value;
                if (!name.empty()) { name += "." + field; }
                else {
                    emitOp(PUSH_STR); emitString(field);
                    emitOp(0x52); bytecode.push_back(4); 
                }
            } else if (tokens[pos].type == TokenType::LPAREN) {
                pos++; int count = 0;
                while(pos < tokens.size() && tokens[pos].type != TokenType::RPAREN) { 
                    parseExpression(); count++; 
                    if(tokens[pos].type == TokenType::COMMA) pos++; 
                }
                if (pos < tokens.size()) pos++;
                
                if (name == "printf" || name == "print") { emitPushInt(count); emitSyscall(0x60); name = ""; }
                else if (name == "len" || name == "strlen") { emitPushInt(count); emitSyscall(0x63); name = ""; }
                else if (name == "malloc") { emitPushInt(count); emitSyscall(0xD0); name = ""; }
                else if (name == "free") { emitPushInt(count); emitSyscall(0xD3); name = ""; }
                else if (name == "exit") { emitPushInt(count); emitSyscall(0xC0); name = ""; }
                else if (name == "system") { emitPushInt(count); emitSyscall(0xC1); name = ""; }
                else if (name == "time.sleep") { emitPushInt(count); emitSyscall(0xC2); name = ""; }
                else if (name == "math.sqrt") { emitPushInt(count); emitSyscall(0xB0); name = ""; }
                // OPTIMIZATION: Use ABS opcode instead of syscall
                else if (name == "abs") { emitAbs(); name = ""; }
                // OPTIMIZATION: Use MIN/MAX opcodes instead of built-in functions
                else if (name == "min" || name == "MIN") { emitMin(); name = ""; }
                else if (name == "max" || name == "MAX") { emitMax(); name = ""; }
                else if (name == "fopen") { emitPushInt(count); emitSyscall(0x70); name = ""; }
                else if (name == "fprintf") { emitPushInt(count); emitSyscall(0x71); name = ""; }
                else if (name == "fclose") { emitPushInt(count); emitSyscall(0x72); name = ""; }
                else if (name == "time") { emitPushInt(count); emitSyscall(0x80); name = ""; }
                else if (name == "ctime") { emitPushInt(count); emitSyscall(0x81); name = ""; }
                else if (name == "memcpy") { emitPushInt(count); emitSyscall(0xD5); name = ""; }
                else if (!name.empty()) { emitOp(CALL); emitString(mangle(name)); name = ""; }
                else {
                    // Function pointer call: the function address is already on the stack
                    // We need to emit CALL with the value from the stack
                    // For now, emit a special pattern that the runtime can handle
                    emitOp(0x0C); emitString(""); // CALL with empty name triggers indirect call
                }
            } else if (tokens[pos].type == TokenType::LBRACKET) {
                // Array indexing: load the array first if we have a name
                if (!name.empty()) {
                    emitOp(LOAD); emitString(mangle(name));
                    name = "";
                }
                pos++; parseExpression();
                if (pos < tokens.size() && tokens[pos].type == TokenType::RBRACKET) pos++;
                if (pos < tokens.size() && tokens[pos].type == TokenType::EQUALS) {
                    pos++; parseExpression();
                    emitOp(0x53); bytecode.push_back(4); // WRITE_ADDR
                } else {
                    emitOp(0x52); bytecode.push_back(4); // READ_ADDR
                }
            } else if (!name.empty() && tokens[pos].type == TokenType::EQUALS) {
                pos++; parseExpression();
                emitOp(STORE); emitString(mangle(name));
                name = "";
            } else break;
        }
        
        if (!name.empty()) {
            if (name == "math.pi") { emitSyscall(0xB2); }
            else if (name == "math.e") { emitSyscall(0xB3); }
            else { emitOp(LOAD); emitString(mangle(name)); }
        }
        return "";
    }

    bool hasSuffix(const std::string &str, const std::string &suffix) {
        return str.size() >= suffix.size() && str.compare(str.size() - suffix.size(), suffix.size(), suffix) == 0;
    }

    void callMethod(std::string fullName, int suffixLen, uint8_t syscall, int count) {
        std::string obj = fullName.substr(0, fullName.length() - suffixLen);
        emitOp(LOAD); emitString(obj);
        emitPushInt(count);
        emitSyscall(syscall);
    }

    void emitString(const std::string& s) {
        bytecode.push_back((uint8_t)s.length());
        for (char c : s) bytecode.push_back((uint8_t)c);
    }
    
    void emitStringLiteral(const std::string& s) {
        // Process escape sequences for string literals
        std::string processed;
        for (size_t i = 0; i < s.length(); i++) {
            if (s[i] == '\\' && i + 1 < s.length()) {
                char next = s[i + 1];
                if (next == 'n') { processed += '\n'; i++; }
                else if (next == 't') { processed += '\t'; i++; }
                else if (next == 'r') { processed += '\r'; i++; }
                else if (next == '\\') { processed += '\\'; i++; }
                else if (next == '"') { processed += '"'; i++; }
                else { processed += s[i]; }
            } else {
                processed += s[i];
            }
        }
        bytecode.push_back((uint8_t)processed.length());
        for (char c : processed) bytecode.push_back((uint8_t)c);
    }
    
    // WASM-like: Emit helper functions for new opcodes
    void emitNeg() { bytecode.push_back(NEG); }
    void emitInc() { bytecode.push_back(INC); }
    void emitDec() { bytecode.push_back(DEC); }
    void emitAbs() { bytecode.push_back(ABS); }
    void emitMin() { bytecode.push_back(MIN); }
    void emitMax() { bytecode.push_back(MAX); }
    void emitClamp() { bytecode.push_back(CLAMP); }
    void emitDup() { bytecode.push_back(DUP); }
    void emitSwap() { bytecode.push_back(SWAP); }
    void emitRot() { bytecode.push_back(ROT); }
    void emitDrop() { bytecode.push_back(DROP); }
    
    void emitTypedLoad(OpCode op) { bytecode.push_back(op); }
    void emitTypedStore(OpCode op) { bytecode.push_back(op); }
    
    void emitJnz(int target) {
        bytecode.push_back(JNZ);
        bytecode.push_back((target >> 24) & 0xFF);
        bytecode.push_back((target >> 16) & 0xFF);
        bytecode.push_back((target >> 8) & 0xFF);
        bytecode.push_back(target & 0xFF);
    }
    
    void emitJgt(int target) {
        bytecode.push_back(JGT);
        bytecode.push_back((target >> 24) & 0xFF);
        bytecode.push_back((target >> 16) & 0xFF);
        bytecode.push_back((target >> 8) & 0xFF);
        bytecode.push_back(target & 0xFF);
    }
    
    void emitJlt(int target) {
        bytecode.push_back(JLT);
        bytecode.push_back((target >> 24) & 0xFF);
        bytecode.push_back((target >> 16) & 0xFF);
        bytecode.push_back((target >> 8) & 0xFF);
        bytecode.push_back(target & 0xFF);
    }
    void emitSyscall(uint8_t id) { emitOp(SYSCALL); bytecode.push_back(id); }
    void emitPushInt(int val) { emitOp(PUSH_INT); emitInt(val); }
    void emitOp(uint8_t op) { bytecode.push_back(op); }
    void emitJump(uint8_t op, int target) { emitOp(op); emitInt(target); }
    void emitInt(int val) {
        bytecode.push_back((val >> 24) & 0xFF); bytecode.push_back((val >> 16) & 0xFF);
        bytecode.push_back((val >> 8) & 0xFF); bytecode.push_back(val & 0xFF);
    }
    void patchInt(int pos, int val) {
        bytecode[pos] = (val >> 24) & 0xFF; bytecode[pos+1] = (val >> 16) & 0xFF;
        bytecode[pos+2] = (val >> 8) & 0xFF; bytecode[pos+3] = (val & 0xFF);
    }
};

std::vector<std::string> globalIncludedFiles;

std::string preprocess(const std::string& source, const std::string& currentDir, const std::vector<std::string>& includePaths) {
    std::string result;
    std::string line;
    std::istringstream stream(source);
    while (std::getline(stream, line)) {
        size_t importPos = line.find("import ");
        size_t includePos = line.find("#include");
        if (importPos == 0 || includePos == 0) {
            std::string mod;
            bool isImport = (importPos == 0);
            if (isImport) {
                mod = line.substr(7);
                size_t asPos = mod.find(" as ");
                size_t fromPos = mod.find(" from ");
                if (asPos != std::string::npos) mod = mod.substr(0, asPos);
                else if (fromPos != std::string::npos) mod = mod.substr(fromPos + 6);
            } else {
                size_t start = line.find_first_of("\"<");
                size_t end = line.find_last_of("\">");
                if (start != std::string::npos && end != std::string::npos && end > start) mod = line.substr(start + 1, end - start - 1);
                else continue;
            }
            size_t first = mod.find_first_not_of(" \t");
            if (first != std::string::npos) mod.erase(0, first);
            size_t last = mod.find_last_not_of(" \t");
            if (last != std::string::npos) mod.erase(last + 1);
            mod.erase(remove_if(mod.begin(), mod.end(), isspace), mod.end());
            
            if (mod == "math" || mod == "math.h" || mod == "cmath" || mod == "sys" || mod == "stdlib.h" || mod == "cstdlib" || mod == "time" || mod == "time.h" || mod == "ctime" || mod == "iostream" || mod == "stdio.h" || mod == "vector" || mod == "string" || mod == "map") continue;

            std::vector<std::string> searchPaths = { currentDir, "." };
            searchPaths.insert(searchPaths.end(), includePaths.begin(), includePaths.end());
            std::vector<std::string> attempts = { 
                mod + "/__init__.soul", mod + "/__init__.py", 
                mod + ".soul", mod + ".py", 
                mod + ".h", mod + ".c", mod + ".cpp", mod + ".hpp", mod + ".cc", mod + ".hh",
                mod 
            };

            bool found = false;
            for (const auto& path : searchPaths) {
                if (found) break;
                for (const auto& tryName : attempts) {
                    std::string fullPath = (path.empty() ? "" : path + "/") + tryName;
                    bool already = false;
                    for (const auto& f : globalIncludedFiles) if (f == fullPath) { already = true; break; }
                    if (already) { found = true; break; }
                    std::ifstream imp(fullPath);
                    if (imp.good()) {
                        globalIncludedFiles.push_back(fullPath);
                        std::string impSrc((std::istreambuf_iterator<char>(imp)), std::istreambuf_iterator<char>());
                        if (isImport) result += "__module__ " + mod + "\n" + preprocess(impSrc, path, includePaths) + "\n__endmodule__\n";
                        else result += preprocess(impSrc, path, includePaths) + "\n";
                        found = true; break;
                    }
                }
            }
        } else result += line + "\n";
    }
    return result;
}

int main(int argc, char* argv[]) {
    try {
        std::cerr << "--- SoulC START ---" << std::endl;
        std::string inputPath, outputPath;
        std::vector<std::string> includePaths;
        bool verbose = false, forcePython = false, forceCpp = false;

        if (argc < 2) {
            std::cerr << "Usage: soulc [options] <input_file>" << std::endl;
            return 1;
        }

        for (int i = 1; i < argc; ++i) {
            std::string arg = argv[i];
            if (arg == "-o" && i + 1 < argc) outputPath = argv[++i];
            else if (arg == "-I" && i + 1 < argc) includePaths.push_back(argv[++i]);
            else if (arg == "-v") verbose = true;
            else if (arg == "--python") forcePython = true;
            else if (arg == "--cpp") forceCpp = true;
            else if (arg[0] != '-') {
                if (inputPath.empty()) inputPath = arg;
                else if (outputPath.empty()) outputPath = arg;
            }
        }

        if (inputPath.empty()) { std::cerr << "No input file specified" << std::endl; return 1; }
        if (outputPath.empty()) {
            size_t lastDot = inputPath.find_last_of(".");
            outputPath = (lastDot == std::string::npos ? inputPath : inputPath.substr(0, lastDot)) + ".casm";
        }

        std::ifstream file(inputPath);
        if (!file.good()) { std::cerr << "Cannot open input file" << std::endl; return 1; }
        std::string source((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
        std::cerr << "File read: " << source.size() << " bytes" << std::endl;
        source = preprocess(source, ".", includePaths);
        std::cerr << "Preprocessed: " << source.size() << " bytes" << std::endl;
        
        bool pythonMode = forcePython || (!forceCpp && (inputPath.find(".py") != std::string::npos || inputPath.find(".soul") != std::string::npos));
    Lexer lexer(source, pythonMode);
    Compiler compiler(lexer.tokenize(), verbose, pythonMode);
        auto bc = compiler.compile();
        
        std::ofstream out(outputPath, std::ios::binary);
        out.write("CASM", 4);
        out.write((char*)bc.data(), bc.size());
        if (verbose) std::cout << "Compiled successfully" << std::endl;
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "Error: " << e.what() << std::endl;
        return 1;
    } catch (...) {
        std::cerr << "Unknown error occurred" << std::endl;
        return 1;
    }
}
