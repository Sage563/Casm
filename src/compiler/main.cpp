
// ============================================================================
// THE ULTIMATE THREE-WAY SYNTAX MAP (Part 2: Advanced & Extended)
// ============================================================================
// ... (Docs omitted for brevity, keeping existing structure) ...

#include <iostream>
#include <vector>
#include <string>
#include <fstream>
#include <map>
#include <set>
#include <algorithm>
#include <sstream>
#include "lexer.hpp"
// Forward declaration
std::string preprocess(const std::string& source, const std::string& currentDir);

enum OpCode {
    HALT = 0x00, PUSH_INT = 0x01, PUSH_STR = 0x02, SYSCALL = 0x03, 
    STORE = 0x04, LOAD = 0x05, ADD = 0x06, SUB = 0x07, MUL = 0x08, DIV = 0x09,
    JMP = 0x0A, JZ = 0x0B, CALL = 0x0C, RET = 0x0D,
    FOR_ITER = 0x0E, TRY_ENTER = 0x0F, TRY_EXIT = 0x10, RAISE = 0x11,
    MALLOC = 0x50, FREE = 0x51, READ_ADDR = 0x52, WRITE_ADDR = 0x53, ADDR_OF = 0x54
};

struct Field { std::string name; int offset; };
struct Type { std::string name; int size; bool isPointer; std::vector<Field> fields; };

class Compiler {
public:
    Compiler(const std::vector<Token>& tokens) : tokens(tokens), pos(0) {
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
        while (pos < tokens.size() && tokens[pos].type != TokenType::END_OF_FILE) {
            parseTopLevel();
        }
        std::string entry = symbolTable.count("main") ? "main" : (symbolTable.count("Main") ? "Main" : "");
        if (entry != "") { emitOp(CALL); emitString(entry); }
        emitOp(HALT);
        return bytecode;
    }

private:
    std::vector<Token> tokens;
    size_t pos;
    std::vector<uint8_t> bytecode;
    std::map<std::string, int> symbolTable;
    std::map<std::string, Type> types;
    std::string modulePrefix;  // e.g. "random." for package symbols

    bool isDeclModifier(const std::string& v) {
        static const std::set<std::string> mods = {
            "static", "extern", "public", "private", "async", "readonly", "sealed", "typedef",
            "alignas", "alignof", "asm", "auto", "const", "consteval", "constexpr", "constinit",
            "explicit", "export", "inline", "mutable", "register", "thread_local", "virtual", "volatile",
            "template", "typename", "concept", "requires", "noexcept", "friend",
            "restrict",
            "_Alignas", "_Alignof", "_Atomic", "_Bool", "_Complex", "_Generic", "_Imaginary",
            "_Noreturn", "_Static_assert", "_Thread_local", "typeof", "typeof_unqual"
        };
        return mods.count(v);
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
        static const std::set<std::string> typeSpec = {"unsigned", "signed", "long", "short", "char", "char8_t", "char16_t", "char32_t", "wchar_t", "int", "float", "double", "void", "bool", "_Bool"};
        while (pos < tokens.size() && typeSpec.count(tokens[pos].value)) {
            if (!typeName.empty()) typeName += " ";
            typeName += tokens[pos++].value;
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
            pos++; while(pos < tokens.size() && tokens[pos].type != TokenType::RPAREN) pos++; pos++;
            if (pos < tokens.size() && tokens[pos].type == TokenType::COLON) pos++; 

            int startPlace = bytecode.size();
            emitPushInt(0); emitOp(STORE); emitString(sym);
            int skipJump = bytecode.size(); emitJump(JMP, 0);

            int bodyStart = bytecode.size();
            symbolTable[sym] = bodyStart;
            patchInt(startPlace + 1, bodyStart);

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
        if (t.type == TokenType::KEYWORD) {
            while (pos < tokens.size() && tokens[pos].type != TokenType::SEMICOLON && tokens[pos].type != TokenType::COLON) pos++;
            if (pos < tokens.size() && tokens[pos].type == TokenType::COLON) { pos++; parseBlock(); }
            else if (pos < tokens.size()) pos++;
            return;
        }
        pos--;
        if (types.count(tokens[pos].value)) { parseDeclaration(); return; }
        parseExpression();
        if (pos < tokens.size() && tokens[pos].type == TokenType::SEMICOLON) pos++;
    }

    void parseExpression() {
        if (pos >= tokens.size()) return;
        Token t = tokens[pos++];
        // C++ nullptr
        if (t.type == TokenType::KEYWORD && t.value == "nullptr") {
            emitPushInt(0);
            return;
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
            return;
        }
        // Unary * (pointer dereference)
        if (t.type == TokenType::STAR) {
            parseExpression();
            emitOp(READ_ADDR);
            bytecode.push_back(4);
            return;
        }
        // Unary & (address-of) — pushes variable ref for later use with *ptr
        if (t.type == TokenType::AMPERSAND) {
            parseExpression();
            return;
        }
        if (t.type == TokenType::KEYWORD && t.value == "true") { emitPushInt(1); return; }
        if (t.type == TokenType::KEYWORD && t.value == "false") { emitPushInt(0); return; }
        if (t.type == TokenType::INTEGER) emitPushInt(std::stoi(t.value));
        else if (t.type == TokenType::STRING) { emitOp(PUSH_STR); emitString(t.value); }
        else if (t.type == TokenType::IDENTIFIER) {
            std::string name = t.value;
            while (pos < tokens.size() && (tokens[pos].type == TokenType::DOT || tokens[pos].type == TokenType::ARROW)) {
                pos++; name += "." + tokens[pos++].value;
            }
            if (pos < tokens.size() && tokens[pos].type == TokenType::LPAREN) {
                pos++; int count = 0;
                while(pos < tokens.size() && tokens[pos].type != TokenType::RPAREN) { parseExpression(); count++; if(tokens[pos].type == TokenType::COMMA) pos++; }
                pos++;
                
                // --- SPECIAL FUNCTIONS & SYSCALLS ---
                if (name == "fopen") { emitPushInt(count); emitSyscall(0x70); }
                else if (name == "fprintf") { emitPushInt(count); emitSyscall(0x71); }
                else if (name == "fclose") { emitPushInt(count); emitSyscall(0x72); }
                else if (name == "printf" || name == "print") { emitPushInt(count); emitSyscall(0x60); }
                else if (name == "ctime") { emitPushInt(count); emitSyscall(0x81); }
                else if (name == "Console.WriteLine") { emitPushInt(count); emitSyscall(0x60); emitOp(PUSH_STR); emitString("\\n"); emitPushInt(1); emitSyscall(0x60); }
                // Python builtins
                else if (name == "len") { emitPushInt(count); emitSyscall(0x63); }
                else if (name == "range") { emitPushInt(count); emitSyscall(0xE8); }
                else if (name == "min") { emitPushInt(count); emitSyscall(0xE9); }
                else if (name == "max") { emitPushInt(count); emitSyscall(0xEA); }
                else if (name == "sum") { emitPushInt(count); emitSyscall(0xEB); }
                else if (name == "sorted") { emitPushInt(count); emitSyscall(0xEC); }
                else if (name == "int" || name == "Integer") { emitPushInt(count); emitSyscall(0xED); }
                else if (name == "float" || name == "Double") { emitPushInt(count); emitSyscall(0xEE); }
                else if (name == "str" || name == "String") { emitPushInt(count); emitSyscall(0xEF); }
                else if (name == "bool") { emitPushInt(count); emitSyscall(0xF0); }
                else if (name == "tuple") { emitPushInt(count); emitSyscall(0xF1); }
                else if (name == "chr") { emitPushInt(count); emitSyscall(0xF2); }
                else if (name == "ord") { emitPushInt(count); emitSyscall(0xF3); }
                else if (name == "round") { emitPushInt(count); emitSyscall(0xF4); }
                else if (name == "divmod") { emitPushInt(count); emitSyscall(0xF5); }
                else if (name == "pow") { emitPushInt(count); emitSyscall(0xF6); }
                else if (name == "all") { emitPushInt(count); emitSyscall(0xF7); }
                else if (name == "any") { emitPushInt(count); emitSyscall(0xF8); }
                else if (name == "repr") { emitPushInt(count); emitSyscall(0xF9); }
                else if (name == "bin") { emitPushInt(count); emitSyscall(0xFA); }
                else if (name == "hex") { emitPushInt(count); emitSyscall(0xFB); }
                else if (name == "oct") { emitPushInt(count); emitSyscall(0xFC); }
                else if (name == "input") { emitPushInt(count); emitSyscall(0xFD); }
                else if (name == "zip") { emitPushInt(count); emitSyscall(0xFE); }
                else if (name == "enumerate") { emitPushInt(count); emitSyscall(0xFF); }
                else if (name == "reversed") { emitPushInt(count); emitSyscall(0xC9); }
                else if (name == "open") { emitPushInt(count); emitSyscall(0x70); }
                // C string/stdio
                else if (name == "strlen") { emitPushInt(count); emitSyscall(0x63); }
                else if (name == "puts") { emitPushInt(count); emitSyscall(0x61); }
                else if (name == "__random") { emitPushInt(count); emitSyscall(0xCA); }
                // C memory
                else if (name == "malloc") { emitPushInt(count); emitSyscall(0xD0); }
                else if (name == "calloc") { emitPushInt(count); emitSyscall(0xD1); }
                else if (name == "realloc") { emitPushInt(count); emitSyscall(0xD2); }
                else if (name == "free") { emitPushInt(count); emitSyscall(0xD3); }
                // C string conversions
                else if (name == "atof") { emitPushInt(count); emitSyscall(0xD4); }
                else if (name == "atoi") { emitPushInt(count); emitSyscall(0xD5); }
                else if (name == "atol") { emitPushInt(count); emitSyscall(0xD6); }
                else if (name == "atoll") { emitPushInt(count); emitSyscall(0xD7); }
                else if (name == "strtod" || name == "strtof" || name == "strtol" || name == "strtold" || name == "strtoll" || name == "strtoul" || name == "strtoull") {
                    emitPushInt(count); emitSyscall(name == "strtod" ? 0xD8 : name == "strtof" ? 0xD9 : name == "strtol" ? 0xDA : name == "strtold" ? 0xDB : name == "strtoll" ? 0xDC : name == "strtoul" ? 0xDD : 0xDE);
                }
                // C process control
                else if (name == "abort") { emitPushInt(count); emitSyscall(0xE0); }
                else if (name == "exit" || name == "_Exit") { emitPushInt(count); emitSyscall(name == "_Exit" ? 0xE1 : 0xC0); }
                else if (name == "atexit") { emitPushInt(count); emitSyscall(0xE2); }
                else if (name == "at_quick_exit") { emitPushInt(count); emitSyscall(0xE3); }
                else if (name == "quick_exit") { emitPushInt(count); emitSyscall(0xE4); }
                else if (name == "getenv") { emitPushInt(count); emitSyscall(0xE5); }
                else if (name == "system") { emitPushInt(count); emitSyscall(0xC1); }
                // C search/sort
                else if (name == "bsearch") { emitPushInt(count); emitSyscall(0xE6); }
                else if (name == "qsort") { emitPushInt(count); emitSyscall(0xE7); }
                // Advanced Data Structures
                else if (name == "set") { emitSyscall(0x90); }
                else if (name == "dict") { emitSyscall(0x92); }
                else if (name == "deque" || name == "list") { emitSyscall(0x95); }
                // C++ list methods (constructors: list(), ~list() as list destructor - no separate code)
                else if (hasSuffix(name, ".assign")) { callMethod(name, 7, 0xA8, count); }
                else if (hasSuffix(name, ".front")) { callMethod(name, 6, 0xA9, count); }
                else if (hasSuffix(name, ".back")) { callMethod(name, 5, 0xAA, count); }
                else if (hasSuffix(name, ".cbegin")) { callMethod(name, 7, 0xAB, count); }
                else if (hasSuffix(name, ".begin")) { callMethod(name, 6, 0xAB, count); }
                else if (hasSuffix(name, ".cend")) { callMethod(name, 5, 0xAC, count); }
                else if (hasSuffix(name, ".end")) { callMethod(name, 4, 0xAC, count); }
                else if (hasSuffix(name, ".crbegin")) { callMethod(name, 8, 0xAD, count); }
                else if (hasSuffix(name, ".rbegin")) { callMethod(name, 7, 0xAD, count); }
                else if (hasSuffix(name, ".crend")) { callMethod(name, 6, 0xAE, count); }
                else if (hasSuffix(name, ".rend")) { callMethod(name, 5, 0xAE, count); }
                else if (hasSuffix(name, ".size")) { callMethod(name, 5, 0x63, count); }
                else if (hasSuffix(name, ".empty")) { callMethod(name, 6, 0xAF, count); }
                else if (hasSuffix(name, ".max_size")) { callMethod(name, 9, 0xB4, count); }
                else if (hasSuffix(name, ".clear")) { callMethod(name, 6, 0xB5, count); }
                else if (hasSuffix(name, ".insert")) { callMethod(name, 7, 0xB6, count); }
                else if (hasSuffix(name, ".emplace")) { callMethod(name, 8, 0xB6, count); }
                else if (hasSuffix(name, ".erase")) { callMethod(name, 6, 0xB7, count); }
                else if (hasSuffix(name, ".emplace_front")) { callMethod(name, 14, 0xB8, count); }
                else if (hasSuffix(name, ".push_front")) { callMethod(name, 11, 0xB8, count); }
                else if (hasSuffix(name, ".prepend_range")) { callMethod(name, 14, 0xB9, count); }
                else if (hasSuffix(name, ".pop_front")) { callMethod(name, 10, 0x97, count); }
                else if (hasSuffix(name, ".emplace_back")) { callMethod(name, 13, 0x96, count); }
                else if (hasSuffix(name, ".push_back")) { callMethod(name, 10, 0x96, count); }
                else if (hasSuffix(name, ".append_range")) { callMethod(name, 13, 0xBA, count); }
                else if (hasSuffix(name, ".pop_back")) { callMethod(name, 9, 0x98, count); }
                else if (hasSuffix(name, ".resize")) { callMethod(name, 7, 0xBB, count); }
                else if (hasSuffix(name, ".swap")) { callMethod(name, 5, 0xBC, count); }
                else if (hasSuffix(name, ".sort")) { callMethod(name, 5, 0xBD, count); }
                else if (hasSuffix(name, ".unique")) { callMethod(name, 7, 0xBE, count); }
                else if (hasSuffix(name, ".reverse")) { callMethod(name, 8, 0xBF, count); }
                else if (hasSuffix(name, ".merge")) { callMethod(name, 6, 0xC3, count); }
                else if (hasSuffix(name, ".splice")) { callMethod(name, 7, 0xC4, count); }
                else if (hasSuffix(name, ".remove")) { callMethod(name, 7, 0xC5, count); }
                else if (hasSuffix(name, ".remove_if")) { callMethod(name, 10, 0xC6, count); }
                else if (hasSuffix(name, ".equals")) { callMethod(name, 8, 0xC7, count); }
                else if (hasSuffix(name, ".compare")) { callMethod(name, 9, 0xC8, count); }
                // String Manipulation
                else if (hasSuffix(name, ".lower")) { callMethod(name, 6, 0xA0, count); }
                else if (hasSuffix(name, ".upper")) { callMethod(name, 6, 0xA1, count); }
                else if (hasSuffix(name, ".split")) { callMethod(name, 6, 0xA2, count); }
                else if (hasSuffix(name, ".join")) { callMethod(name, 5, 0xA3, count); }
                else if (hasSuffix(name, ".replace")) { callMethod(name, 8, 0xA4, count); }
                else if (hasSuffix(name, ".find")) { callMethod(name, 5, 0xA5, count); }
                else if (hasSuffix(name, ".cardinality")) { callMethod(name, 12, 0xA5, count); }
                else if (hasSuffix(name, ".startswith")) { callMethod(name, 11, 0xA6, count); }
                else if (hasSuffix(name, ".strip")) { callMethod(name, 6, 0xA7, count); }
                // Collections Methods
                else if (hasSuffix(name, ".add")) { callMethod(name, 4, 0x91, count); }
                else if (hasSuffix(name, ".push")) { callMethod(name, 5, 0x96, count); }
                else if (hasSuffix(name, ".pop")) { callMethod(name, 4, 0x98, count); }
                else if (hasSuffix(name, ".get")) { callMethod(name, 4, 0x94, count); }
                // Math
                else if (name == "math.sqrt") emitSyscall(0xB0);
                else if (name == "abs") emitSyscall(0xB1);
                // System
                else if (name == "sys.exit") emitSyscall(0xC0);
                else if (name == "os.system") emitSyscall(0xC1);
                else if (name == "time.sleep") emitSyscall(0xC2);

                else { emitOp(CALL); emitString(name); }
            } else if (pos < tokens.size() && tokens[pos].type == TokenType::EQUALS) {
                pos++; parseExpression(); emitOp(STORE); emitString(mangle(name));
            } else { 
                // Constants / variable load (use module prefix for simple names)
                if (name == "math.pi") { emitSyscall(0xB2); }
                else if (name == "math.e") { emitSyscall(0xB3); }
                else { std::string loadName = (name.find('.') != std::string::npos) ? name : mangle(name); emitOp(LOAD); emitString(loadName); }
            }
        } else if (t.type == TokenType::AMPERSAND) { parseExpression(); }
    }

    bool hasSuffix(const std::string &str, const std::string &suffix) {
        return str.size() >= suffix.size() &&
               str.compare(str.size() - suffix.size(), suffix.size(), suffix) == 0;
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

// Header guards to preventing multiple inclusion
std::set<std::string> includedFiles;

std::string preprocess(const std::string& source, const std::string& currentDir = "") {
    std::string result;
    std::string line;
    std::istringstream stream(source);
    while (std::getline(stream, line)) {
        size_t importPos = line.find("import ");
        size_t includePos = line.find("#include");
        
        if (importPos == 0 || includePos == 0) {
            std::string mod;
            bool isImport = (importPos == 0);
            if (importPos == 0) {
                mod = line.substr(7);
                size_t asPos = mod.find(" as ");
                size_t fromPos = mod.find(" from ");
                if (asPos != std::string::npos) mod = mod.substr(0, asPos);
                else if (fromPos != std::string::npos) mod = mod.substr(fromPos + 6); // " from " -> take right part
                else if (mod.find(" import ") != std::string::npos) { size_t i = mod.find(" import "); mod = mod.substr(0, i); }
            } else {
                size_t start = line.find_first_of("\"<");
                size_t end = line.find_last_of("\">");
                if (start != std::string::npos && end != std::string::npos && end > start) {
                    mod = line.substr(start + 1, end - start - 1);
                } else continue;
            }

            size_t first = mod.find_first_not_of(" \t");
            if (first != std::string::npos) mod.erase(0, first);
            size_t last = mod.find_last_not_of(" \t");
            if (last != std::string::npos) mod.erase(last + 1);
            if (mod.find(" import ") != std::string::npos) { size_t i = mod.find(" import "); mod = mod.substr(0, i); mod.erase(0, mod.find_first_not_of(" \t")); }
            mod.erase(remove_if(mod.begin(), mod.end(), isspace), mod.end());
            
            // Built-ins (no file): skip including
            if (mod == "math" || mod == "math.h" || mod == "cmath") continue; 
            if (mod == "sys" || mod == "stdlib.h" || mod == "cstdlib") continue; 
            if (mod == "time" || mod == "time.h" || mod == "ctime") continue;
            if (mod == "iostream" || mod == "stdio.h") continue; 
            if (mod == "vector" || mod == "string" || mod == "map") continue;

            // Package / module search paths (pip-style: packages/, site-packages/, lib/)
            std::vector<std::string> searchPaths = { currentDir, ".", "packages", "site-packages", "lib", "src", "include" };
            const char* envPath = getenv("C_INCLUDE_PATH");
            if (envPath) searchPaths.push_back(envPath);
            const char* pkgPath = getenv("SOUL_PACKAGES");
            if (pkgPath) searchPaths.push_back(pkgPath);

            std::vector<std::string> attempts;
            if (mod.find('.') == std::string::npos) {
                attempts.push_back(mod + "/__init__.soul");
                attempts.push_back(mod + "/__init__.py");
                attempts.push_back(mod + ".soul");
                attempts.push_back(mod + ".py");
                attempts.push_back(mod + ".h");
                attempts.push_back(mod + ".c"); 
            } else {
                attempts.push_back(mod);
            }

            bool found = false;
            for (const auto& path : searchPaths) {
                if (found) break;
                for (const auto& tryName : attempts) {
                    std::string fullPath = (path.empty() ? "" : path + "/") + tryName;
                    if (includedFiles.count(fullPath)) {
                        found = true;
                        result += "// Skipped " + fullPath + "\n";
                        break;
                    }

                    std::ifstream imp(fullPath);
                    if (imp.good()) {
                        includedFiles.insert(fullPath);
                        std::string impSrc((std::istreambuf_iterator<char>(imp)), std::istreambuf_iterator<char>());
                        if (isImport && importPos == 0) {
                            result += "__module__ " + mod + "\n";
                            result += preprocess(impSrc, path);
                            result += "\n__endmodule__\n";
                        } else {
                            result += preprocess(impSrc, path) + "\n";
                        }
                        found = true;
                        break;
                    }
                }
            }
            
            if (!found) {
                 if (includePos == 0) result += "// " + line + "\n";
            }
        } else {
            result += line + "\n";
        }
    }
    return result;
}

int main(int argc, char* argv[]) {
    if (argc < 3) return 1;
    std::ifstream file(argv[1]);
    std::string rawSource((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
    
    // Preprocess Import Modules
    std::string source = preprocess(rawSource);
    
    Lexer lexer(source, true); // Python mode enabled
    Compiler compiler(lexer.tokenize());
    auto bc = compiler.compile();
    std::ofstream out(argv[2], std::ios::binary);
    out.write("CASM", 4); // BRANDED: Compiled Assembly
    out.write((char*)bc.data(), bc.size());
    return 0;
}
