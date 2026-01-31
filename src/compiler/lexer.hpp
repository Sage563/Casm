#ifndef LEXER_HPP
#define LEXER_HPP

#include <iostream>
#include <string>
#include <vector>
#include <map>
#include <cctype>

enum class TokenType {
    IDENTIFIER, KEYWORD, INTEGER, STRING,
    PLUS, MINUS, STAR, SLASH,
    EQUALS, EQUALS_EQUALS,
    LPAREN, RPAREN, LBRACE, RBRACE,
    COLON, SEMICOLON, COMMA, DOT,
    AMPERSAND, ARROW,
    LBRACKET, RBRACKET,
    PLUS_PLUS, MINUS_MINUS,
    PLUS_EQ, MINUS_EQ, STAR_EQ, SLASH_EQ,
    LT, GT, LE, GE,
    LSHIFT, RSHIFT, LSHIFT_EQ, RSHIFT_EQ,
    MOD, MOD_EQ,
    COLON_EQUALS, // Walrus operator
    INDENT, DEDENT, // For Python
    FSTRING_PART, LBRACE_EXP, RBRACE_EXP, // For f-strings
    // C++ alternative / compound operators
    LAND, LOR, NOT, NOT_EQ,           // &&, ||, !, !=  and  and, or, not, not_eq
    TILDE, CARET, PIPE,               // ~, ^, |  and  compl, xor, bitor
    AND_EQ, OR_EQ, XOR_EQ,            // &=, |=, ^=  and  and_eq, or_eq, xor_eq
    END_OF_FILE, UNKNOWN
};

struct Token {
    TokenType type;
    std::string value;
    int line;
};

class Lexer {
public:
    Lexer(const std::string& source, bool pythonMode = false) 
        : source(source), pos(0), line(1), pythonMode(pythonMode) {}

    std::vector<Token> tokenize() {
        std::vector<Token> tokens;
        while (pos < source.length()) {
            char current = source[pos];
            
            // Handle indentation if we are at the start of a line
            if (pythonMode && (pos == 0 || source[pos-1] == '\n')) {
                int indent = 0;
                while (pos < source.length() && (source[pos] == ' ' || source[pos] == '\t')) {
                    indent += (source[pos++] == '\t' ? 4 : 1);
                }
                
                if (indent > indentStack.back()) {
                    indentStack.push_back(indent);
                    tokens.push_back({TokenType::INDENT, std::to_string(indent), line});
                    printf("Lexer: INDENT %d at line %d\n", indent, line);
                } else {
                    while (indent < indentStack.back()) {
                        indentStack.pop_back();
                        tokens.push_back({TokenType::DEDENT, "", line});
                        printf("Lexer: DEDENT at line %d\n", line);
                    }
                }
                if (pos >= source.length()) break;
                current = source[pos];
            }

            if (isspace(current)) {
                if (current == '\n') line++;
                pos++;
                continue;
            }

            if (current == '#') {
                pos++;
                std::string directive;
                while (pos < source.length() && !isspace(source[pos])) directive += source[pos++];
                if (directive == "define" || directive == "include") {
                    while (pos < source.length() && source[pos] != '\n') pos++;
                }
                continue;
            }

            if (current == '/' && pos + 1 < source.length()) {
                if (source[pos+1] == '/') {
                    while (pos < source.length() && source[pos] != '\n') pos++;
                    continue;
                }
                if (source[pos+1] == '*') {
                    pos += 2;
                    while (pos + 1 < source.length() && !(source[pos] == '*' && source[pos+1] == '/')) {
                        if (source[pos] == '\n') line++;
                        pos++;
                    }
                    pos += 2;
                    continue;
                }
            }
            if (current == '\n') line++;

            if (isdigit(current)) {
                tokens.push_back(readNumber());
            } else if (current == '"') {
                if (pos + 2 < source.length() && source[pos+1] == '"' && source[pos+2] == '"') {
                    tokens.push_back(readTripleString());
                } else {
                    tokens.push_back(readString());
                }
            } else if (current == 'f' && pos + 1 < source.length() && source[pos+1] == '"') {
                pos++; // skip 'f'
                auto fTokens = tokenizeFString();
                tokens.insert(tokens.end(), fTokens.begin(), fTokens.end());
            } else if (isalpha(current) || current == '_') {
                tokens.push_back(readIdentifier());
            } else {
                tokens.push_back(readOperator());
            }
        }
        while (indentStack.size() > 1) {
            indentStack.pop_back();
            tokens.push_back({TokenType::DEDENT, "", line});
        }
        tokens.push_back({TokenType::END_OF_FILE, "", line});
        return tokens;
    }

private:
    std::string source;
    size_t pos;
    int line;
    bool pythonMode;
    std::vector<int> indentStack = {0};

    Token readNumber() {
        std::string val;
        while (pos < source.length() && (isdigit(source[pos]) || source[pos] == '.')) {
            val += source[pos++];
        }
        return {TokenType::INTEGER, val, line};
    }

    Token readIdentifier() {
        std::string val;
        while (pos < source.length() && (isalnum(source[pos]) || source[pos] == '_')) {
            val += source[pos++];
        }
        TokenType type = TokenType::IDENTIFIER;
        std::map<std::string, TokenType> keywords = {
            // C/C++ core
            {"int", TokenType::KEYWORD}, {"if", TokenType::KEYWORD}, {"else", TokenType::KEYWORD},
            {"while", TokenType::KEYWORD}, {"def", TokenType::KEYWORD}, {"return", TokenType::KEYWORD},
            {"class", TokenType::KEYWORD}, {"import", TokenType::KEYWORD},
            {"using", TokenType::KEYWORD}, {"namespace", TokenType::KEYWORD}, {"static", TokenType::KEYWORD},
            {"void", TokenType::KEYWORD}, {"public", TokenType::KEYWORD}, {"for", TokenType::KEYWORD},
            {"in", TokenType::KEYWORD}, {"try", TokenType::KEYWORD}, {"except", TokenType::KEYWORD},
            {"finally", TokenType::KEYWORD}, {"as", TokenType::KEYWORD}, {"raise", TokenType::KEYWORD},
            {"continue", TokenType::KEYWORD}, {"True", TokenType::KEYWORD}, {"False", TokenType::KEYWORD},
            {"None", TokenType::KEYWORD}, {"private", TokenType::KEYWORD}, {"protected", TokenType::KEYWORD},
            {"typedef", TokenType::KEYWORD}, {"struct", TokenType::KEYWORD}, {"union", TokenType::KEYWORD},
            {"enum", TokenType::KEYWORD}, {"bool", TokenType::KEYWORD}, {"true", TokenType::KEYWORD},
            {"false", TokenType::KEYWORD},
            // C++ alternative operators
            {"and", TokenType::LAND}, {"or", TokenType::LOR}, {"not", TokenType::NOT}, {"not_eq", TokenType::NOT_EQ},
            {"bitand", TokenType::AMPERSAND}, {"bitor", TokenType::PIPE}, {"compl", TokenType::TILDE},
            {"xor", TokenType::CARET}, {"and_eq", TokenType::AND_EQ}, {"or_eq", TokenType::OR_EQ}, {"xor_eq", TokenType::XOR_EQ},
            // C++ keywords
            {"alignas", TokenType::KEYWORD}, {"alignof", TokenType::KEYWORD}, {"asm", TokenType::KEYWORD},
            {"auto", TokenType::KEYWORD}, {"break", TokenType::KEYWORD}, {"case", TokenType::KEYWORD},
            {"catch", TokenType::KEYWORD}, {"char", TokenType::KEYWORD}, {"char8_t", TokenType::KEYWORD},
            {"char16_t", TokenType::KEYWORD}, {"char32_t", TokenType::KEYWORD}, {"concept", TokenType::KEYWORD},
            {"const", TokenType::KEYWORD}, {"consteval", TokenType::KEYWORD}, {"constexpr", TokenType::KEYWORD},
            {"constinit", TokenType::KEYWORD}, {"const_cast", TokenType::KEYWORD}, {"co_await", TokenType::KEYWORD},
            {"co_return", TokenType::KEYWORD}, {"co_yield", TokenType::KEYWORD}, {"decltype", TokenType::KEYWORD},
            {"default", TokenType::KEYWORD}, {"delete", TokenType::KEYWORD}, {"do", TokenType::KEYWORD},
            {"double", TokenType::KEYWORD}, {"dynamic_cast", TokenType::KEYWORD}, {"explicit", TokenType::KEYWORD},
            {"export", TokenType::KEYWORD}, {"extern", TokenType::KEYWORD}, {"float", TokenType::KEYWORD},
            {"friend", TokenType::KEYWORD}, {"goto", TokenType::KEYWORD}, {"inline", TokenType::KEYWORD},
            {"long", TokenType::KEYWORD}, {"module", TokenType::KEYWORD}, {"mutable", TokenType::KEYWORD},
            {"new", TokenType::KEYWORD}, {"noexcept", TokenType::KEYWORD}, {"nullptr", TokenType::KEYWORD},
            {"operator", TokenType::KEYWORD}, {"register", TokenType::KEYWORD}, {"reinterpret_cast", TokenType::KEYWORD},
            {"requires", TokenType::KEYWORD}, {"short", TokenType::KEYWORD}, {"signed", TokenType::KEYWORD},
            {"sizeof", TokenType::KEYWORD}, {"static_assert", TokenType::KEYWORD}, {"static_cast", TokenType::KEYWORD},
            {"switch", TokenType::KEYWORD}, {"template", TokenType::KEYWORD}, {"this", TokenType::KEYWORD},
            {"thread_local", TokenType::KEYWORD}, {"throw", TokenType::KEYWORD}, {"typeid", TokenType::KEYWORD},
            {"typename", TokenType::KEYWORD}, {"unsigned", TokenType::KEYWORD}, {"virtual", TokenType::KEYWORD},
            {"volatile", TokenType::KEYWORD}, {"wchar_t", TokenType::KEYWORD},
            // C11 / C23
            {"_Alignas", TokenType::KEYWORD}, {"_Alignof", TokenType::KEYWORD}, {"_Atomic", TokenType::KEYWORD},
            {"_Bool", TokenType::KEYWORD}, {"_Complex", TokenType::KEYWORD}, {"_Generic", TokenType::KEYWORD},
            {"_Imaginary", TokenType::KEYWORD}, {"_Noreturn", TokenType::KEYWORD},
            {"_Static_assert", TokenType::KEYWORD}, {"_Thread_local", TokenType::KEYWORD},
            // C99 / C23
            {"restrict", TokenType::KEYWORD}, {"typeof", TokenType::KEYWORD}, {"typeof_unqual", TokenType::KEYWORD},
            // Python
            {"pass", TokenType::KEYWORD}, {"del", TokenType::KEYWORD}, {"global", TokenType::KEYWORD},
            {"nonlocal", TokenType::KEYWORD}, {"lambda", TokenType::KEYWORD}, {"with", TokenType::KEYWORD},
            {"yield", TokenType::KEYWORD}, {"async", TokenType::KEYWORD}, {"await", TokenType::KEYWORD},
            {"from", TokenType::KEYWORD}, {"elif", TokenType::KEYWORD}, {"is", TokenType::KEYWORD},
            {"assert", TokenType::KEYWORD}, {"match", TokenType::KEYWORD},
            {"__module__", TokenType::KEYWORD}, {"__endmodule__", TokenType::KEYWORD}
        };
        if (keywords.count(val)) type = keywords[val];
        return {type, val, line};
    }

    Token readString() {
        pos++; // Skip "
        std::string val;
        while (pos < source.length() && source[pos] != '"') val += source[pos++];
        if (pos < source.length()) pos++; // Skip "
        return {TokenType::STRING, val, line};
    }

    Token readTripleString() {
        pos += 3; // Skip """
        std::string val;
        while (pos + 2 < source.length() && !(source[pos] == '"' && source[pos+1] == '"' && source[pos+2] == '"')) {
            if (source[pos] == '\n') line++;
            val += source[pos++];
        }
        pos += 3; // Skip """
        return {TokenType::STRING, val, line};
    }

    std::vector<Token> tokenizeFString() {
        std::vector<Token> fTokens;
        pos++; // Skip "
        std::string val;
        while (pos < source.length() && source[pos] != '"') {
            if (source[pos] == '{') {
                if (!val.empty()) fTokens.push_back({TokenType::FSTRING_PART, val, line});
                val.clear();
                fTokens.push_back({TokenType::LBRACE_EXP, "{", line});
                pos++;
                // Lex inner expression until '}'
                // This is a simplification: complex expressions with nested braces need balancing
                std::string expr;
                int depth = 1;
                while (pos < source.length() && depth > 0) {
                    if (source[pos] == '{') depth++;
                    else if (source[pos] == '}') depth--;
                    if (depth > 0) expr += source[pos++];
                }
                if (pos < source.length()) pos++; // Skip }
                
                // Re-lex the expression string
                Lexer innerLexer(expr, pythonMode);
                auto innerTokens = innerLexer.tokenize();
                // Remove END_OF_FILE from inner tokens
                if (!innerTokens.empty() && innerTokens.back().type == TokenType::END_OF_FILE)
                    innerTokens.pop_back();
                
                fTokens.insert(fTokens.end(), innerTokens.begin(), innerTokens.end());
                fTokens.push_back({TokenType::RBRACE_EXP, "}", line});
            } else {
                val += source[pos++];
            }
        }
        if (!val.empty()) fTokens.push_back({TokenType::FSTRING_PART, val, line});
        if (pos < source.length()) pos++; // Skip "
        return fTokens;
    }

    Token readOperator() {
        char current = source[pos++];
        switch (current) {
            case '+':
                if (source[pos] == '+') { pos++; return {TokenType::PLUS_PLUS, "++", line}; }
                if (source[pos] == '=') { pos++; return {TokenType::PLUS_EQ, "+=", line}; }
                return {TokenType::PLUS, "+", line};
            case '-':
                if (source[pos] == '-') { pos++; return {TokenType::MINUS_MINUS, "--", line}; }
                if (source[pos] == '>') { pos++; return {TokenType::ARROW, "->", line}; }
                if (source[pos] == '=') { pos++; return {TokenType::MINUS_EQ, "-=", line}; }
                return {TokenType::MINUS, "-", line};
            case '*': 
                if (source[pos] == '=') { pos++; return {TokenType::STAR_EQ, "*=", line}; }
                return {TokenType::STAR, "*", line};
            case '/': 
                if (source[pos] == '=') { pos++; return {TokenType::SLASH_EQ, "/=", line}; }
                return {TokenType::SLASH, "/", line};
            case '%':
                if (source[pos] == '=') { pos++; return {TokenType::MOD_EQ, "%=", line}; }
                return {TokenType::MOD, "%", line};
            case '<':
                if (source[pos] == '<') {
                    pos++;
                    if (pos < source.length() && source[pos] == '=') { pos++; return {TokenType::LSHIFT_EQ, "<<=", line}; }
                    return {TokenType::LSHIFT, "<<", line};
                }
                if (source[pos] == '=') { pos++; return {TokenType::LE, "<=", line}; }
                return {TokenType::LT, "<", line};
            case '>':
                if (source[pos] == '>') {
                    pos++;
                    if (pos < source.length() && source[pos] == '=') { pos++; return {TokenType::RSHIFT_EQ, ">>=", line}; }
                    return {TokenType::RSHIFT, ">>", line};
                }
                if (source[pos] == '=') { pos++; return {TokenType::GE, ">=", line}; }
                return {TokenType::GT, ">", line};
            case '&':
                if (pos < source.length() && source[pos] == '&') { pos++; return {TokenType::LAND, "&&", line}; }
                if (pos < source.length() && source[pos] == '=') { pos++; return {TokenType::AND_EQ, "&=", line}; }
                return {TokenType::AMPERSAND, "&", line};
            case '|':
                if (pos < source.length() && source[pos] == '|') { pos++; return {TokenType::LOR, "||", line}; }
                if (pos < source.length() && source[pos] == '=') { pos++; return {TokenType::OR_EQ, "|=", line}; }
                return {TokenType::PIPE, "|", line};
            case '!':
                if (pos < source.length() && source[pos] == '=') { pos++; return {TokenType::NOT_EQ, "!=", line}; }
                return {TokenType::NOT, "!", line};
            case '~': return {TokenType::TILDE, "~", line};
            case '^':
                if (pos < source.length() && source[pos] == '=') { pos++; return {TokenType::XOR_EQ, "^=", line}; }
                return {TokenType::CARET, "^", line};
            case '.': return {TokenType::DOT, ".", line};
            case '=':
                if (pos < source.length() && source[pos] == '=') { pos++; return {TokenType::EQUALS_EQUALS, "==", line}; }
                return {TokenType::EQUALS, "=", line};
            case '(': return {TokenType::LPAREN, "(", line};
            case ')': return {TokenType::RPAREN, ")", line};
            case '{': return {TokenType::LBRACE, "{", line};
            case '}': return {TokenType::RBRACE, "}", line};
            case '[': return {TokenType::LBRACKET, "[", line};
            case ']': return {TokenType::RBRACKET, "]", line};
            case ':': 
                if (pos < source.length() && source[pos] == '=') { pos++; return {TokenType::COLON_EQUALS, ":=", line}; }
                return {TokenType::COLON, ":", line};
            case ';': return {TokenType::SEMICOLON, ";", line};
            case ',': return {TokenType::COMMA, ",", line};
            default: return {TokenType::UNKNOWN, std::string(1, current), line};
        }
    }
};

#endif // LEXER_HPP