
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
        types["double"] = {"double", 8, false};
        types["time_t"] = {"int", 4, false};
        types["Point"] = {"Point", 8, false, {{"x", 0}, {"y", 4}}};
        types["IntFloat"] = {"IntFloat", 4, false, {{"i", 0}, {"f", 0}}};
        types["Color"] = {"int", 4, false};
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

    void parseTopLevel() {
        if (pos >= tokens.size()) return;
        Token t = tokens[pos];
        if (t.value == "static" || t.value == "extern" || t.value == "public" || t.value == "private" || t.value == "async" || t.value == "readonly" || t.value == "sealed" || t.value == "typedef") { pos++; return; }

        if (t.type == TokenType::KEYWORD || t.type == TokenType::IDENTIFIER) {
            // Import handled by preprocessor now, but if left over:
            if (t.value == "using" || t.value == "import") {
                pos++; while(pos < tokens.size() && tokens[pos].type != TokenType::SEMICOLON) pos++;
                if (pos < tokens.size()) pos++; return;
            }
            if (t.value == "namespace" || t.value == "class" || t.value == "struct" || t.value == "union" || t.value == "enum") {
                pos++; if (tokens[pos].type == TokenType::IDENTIFIER) pos++; 
                if (tokens[pos].type == TokenType::LBRACE) {
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

    void parseDeclaration() {
        std::string typeName = tokens[pos++].value;
        if (pos < tokens.size() && (tokens[pos].type == TokenType::STAR || tokens[pos].value == "?")) pos++;
        std::string name = tokens[pos++].value;

        if (pos < tokens.size() && tokens[pos].type == TokenType::LPAREN) {
            // Function
            pos++; while(pos < tokens.size() && tokens[pos].type != TokenType::RPAREN) pos++; pos++;
            if (pos < tokens.size() && tokens[pos].type == TokenType::COLON) pos++; 

            int startPlace = bytecode.size();
            emitPushInt(0); emitOp(STORE); emitString(name);
            int skipJump = bytecode.size(); emitJump(JMP, 0);

            int bodyStart = bytecode.size();
            symbolTable[name] = bodyStart;
            patchInt(startPlace + 1, bodyStart);

            parseBlock();
            emitOp(RET);
            patchInt(skipJump + 1, bytecode.size());
        } else {
            // Variable
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
                            std::string m = name + "." + types[typeName].fields[i++].name;
                            emitOp(STORE); emitString(m);
                        } else { emitOp(STORE); emitString(name + "[" + std::to_string(i++) + "]"); }
                        if (tokens[pos].type == TokenType::COMMA) pos++;
                    }
                    if (pos < tokens.size()) pos++;
                } else {
                    parseExpression(); emitOp(STORE); emitString(name);
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
            if (pos < tokens.size() && tokens[pos].value == "else") {
                pos++; int skipElse = bytecode.size(); emitJump(JMP, 0);
                patchInt(patch, bytecode.size());
                parseBlock();
                patchInt(skipElse + 1, bytecode.size());
            } else patchInt(patch, bytecode.size());
            return;
        }
        if (t.value == "return") { parseExpression(); emitOp(RET); if(tokens[pos].type == TokenType::SEMICOLON) pos++; return; }
        
        pos--; 
        if (types.count(tokens[pos].value)) { parseDeclaration(); return; }
        parseExpression();
        // Handle standalone methods/assignments
        if (pos < tokens.size() && tokens[pos].type == TokenType::EQUALS) {
            // Assignment logic
        }
        if(pos < tokens.size() && tokens[pos].type == TokenType::SEMICOLON) pos++;
    }

    void parseExpression() {
        if (pos >= tokens.size()) return;
        Token t = tokens[pos++];
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
                // Advanced Data Structures
                else if (name == "set") { emitSyscall(0x90); }
                else if (name == "dict") { emitSyscall(0x92); }
                else if (name == "deque") { emitSyscall(0x95); }
                // String Manipulation
                else if (hasSuffix(name, ".lower")) { callMethod(name, 6, 0xA0); }
                else if (hasSuffix(name, ".upper")) { callMethod(name, 6, 0xA1); }
                else if (hasSuffix(name, ".split")) { callMethod(name, 6, 0xA2); }
                else if (hasSuffix(name, ".join")) { callMethod(name, 5, 0xA3); }
                else if (hasSuffix(name, ".replace")) { callMethod(name, 8, 0xA4); }
                else if (hasSuffix(name, ".find")) { callMethod(name, 5, 0xA5); }
                else if (hasSuffix(name, ".cardinality")) { callMethod(name, 12, 0xA5); } // Alias
                else if (hasSuffix(name, ".startswith")) { callMethod(name, 11, 0xA6); }
                else if (hasSuffix(name, ".strip")) { callMethod(name, 6, 0xA7); }
                // Collections Mthods
                else if (hasSuffix(name, ".add")) { callMethod(name, 4, 0x91); } // set.add
                else if (hasSuffix(name, ".push")) { callMethod(name, 5, 0x96); } // deque.push
                else if (hasSuffix(name, ".pop")) { callMethod(name, 4, 0x98); } // Generic pop?
                // Map
                else if (hasSuffix(name, ".get")) { callMethod(name, 4, 0x94); }
                
                // Math
                else if (name == "math.sqrt") emitSyscall(0xB0);
                else if (name == "abs") emitSyscall(0xB1);
                
                // System
                else if (name == "sys.exit" || name == "exit") emitSyscall(0xC0);
                else if (name == "os.system" || name == "system") emitSyscall(0xC1);
                else if (name == "time.sleep") emitSyscall(0xC2);

                else { emitOp(CALL); emitString(name); }
            } else if (pos < tokens.size() && tokens[pos].type == TokenType::EQUALS) {
                pos++; parseExpression(); emitOp(STORE); emitString(name);
            } else { 
                // Constants
                if (name == "math.pi") { emitSyscall(0xB2); }
                else if (name == "math.e") { emitSyscall(0xB3); }
                else { emitOp(LOAD); emitString(name); }
            }
        } else if (t.type == TokenType::AMPERSAND) { parseExpression(); }
    }

    bool hasSuffix(const std::string &str, const std::string &suffix) {
        return str.size() >= suffix.size() &&
               str.compare(str.size() - suffix.size(), suffix.size(), suffix) == 0;
    }

    void callMethod(std::string fullName, int suffixLen, uint8_t syscall) {
        std::string obj = fullName.substr(0, fullName.length() - suffixLen);
        emitOp(LOAD); emitString(obj);
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
            if (importPos == 0) mod = line.substr(7);
            else {
                size_t start = line.find_first_of("\"<");
                size_t end = line.find_last_of("\">");
                if (start != std::string::npos && end != std::string::npos && end > start) {
                    mod = line.substr(start + 1, end - start - 1);
                } else continue;
            }

            mod.erase(remove_if(mod.begin(), mod.end(), isspace), mod.end());
            
            // Checks for built-ins...
            if (mod == "math" || mod == "math.h" || mod == "cmath") continue; 
            if (mod == "sys" || mod == "stdlib.h" || mod == "cstdlib") continue; 
            if (mod == "time" || mod == "time.h" || mod == "ctime") continue;
            if (mod == "iostream" || mod == "stdio.h") continue; 
            if (mod == "vector" || mod == "string" || mod == "map") continue;

            // Search Paths
            std::vector<std::string> searchPaths = { currentDir, ".", "lib", "src", "include" };
            const char* envPath = getenv("C_INCLUDE_PATH");
            if (envPath) searchPaths.push_back(envPath);

            std::vector<std::string> attempts;
            // Check if extension exists
            if (mod.find('.') == std::string::npos) {
                attempts.push_back(mod + ".soul");
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
                    
                    // IDEMPOTENCY CHECK
                    // Normalize path simplified? For now, just string match.
                    if (includedFiles.count(fullPath)) {
                        found = true; // Already included, skip content
                        result += "// Skipped " + fullPath + "\n";
                        break;
                    }

                    std::ifstream imp(fullPath);
                    if (imp.good()) {
                        includedFiles.insert(fullPath);
                        std::string impSrc((std::istreambuf_iterator<char>(imp)), std::istreambuf_iterator<char>());
                        result += preprocess(impSrc, path) + "\n"; // Recursive with new base dir
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
