#include <iostream>
#include <string>
#include <vector>
#include <map>

enum class TokenType {
    IDENTIFIER, KEYWORD, INTEGER, STRING,
    PLUS, MINUS, STAR, SLASH, 
    EQUALS, EQUALS_EQUALS,
    LPAREN, RPAREN, LBRACE, RBRACE,
    COLON, SEMICOLON, COMMA, DOT,
    AMPERSAND, ARROW,
    LBRACKET, RBRACKET,
    PLUS_PLUS, MINUS_MINUS,
    INDENT, DEDENT, // For Python
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
                } else {
                    while (indent < indentStack.back()) {
                        indentStack.pop_back();
                        tokens.push_back({TokenType::DEDENT, "", line});
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
                tokens.push_back(readFString());
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
        static const std::map<std::string, TokenType> keywords = {
            {"int", TokenType::KEYWORD}, {"if", TokenType::KEYWORD}, {"else", TokenType::KEYWORD},
            {"while", TokenType::KEYWORD}, {"def", TokenType::KEYWORD}, {"return", TokenType::KEYWORD},
            {"class", TokenType::KEYWORD}, {"print", TokenType::KEYWORD}, {"import", TokenType::KEYWORD},
            {"using", TokenType::KEYWORD}, {"namespace", TokenType::KEYWORD}, {"static", TokenType::KEYWORD},
            {"void", TokenType::KEYWORD}, {"public", TokenType::KEYWORD}, {"for", TokenType::KEYWORD},
            {"in", TokenType::KEYWORD}, {"try", TokenType::KEYWORD}, {"except", TokenType::KEYWORD},
            {"finally", TokenType::KEYWORD}, {"as", TokenType::KEYWORD}, {"raise", TokenType::KEYWORD},
            {"continue", TokenType::KEYWORD}, {"True", TokenType::KEYWORD}, {"False", TokenType::KEYWORD},
            {"None", TokenType::KEYWORD}, {"private", TokenType::KEYWORD}, {"protected", TokenType::KEYWORD},
            {"typedef", TokenType::KEYWORD}, {"struct", TokenType::KEYWORD}, {"union", TokenType::KEYWORD},
            {"enum", TokenType::KEYWORD}, {"bool", TokenType::KEYWORD}, {"true", TokenType::KEYWORD},
            {"false", TokenType::KEYWORD}
        };
        if (keywords.count(val)) type = TokenType::KEYWORD;
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

    Token readFString() {
        pos++; // Skip "
        std::string val;
        while (pos < source.length() && source[pos] != '"') val += source[pos++];
        if (pos < source.length()) pos++; // Skip "
        return {TokenType::STRING, val, line}; // For now, treat as string
    }

    Token readOperator() {
        char current = source[pos++];
        switch (current) {
            case '+': 
                if (source[pos] == '+') { pos++; return {TokenType::PLUS_PLUS, "++", line}; }
                return {TokenType::PLUS, "+", line};
            case '-': 
                if (source[pos] == '-') { pos++; return {TokenType::MINUS_MINUS, "--", line}; }
                if (source[pos] == '>') { pos++; return {TokenType::ARROW, "->", line}; }
                return {TokenType::MINUS, "-", line};
            case '*': return {TokenType::STAR, "*", line};
            case '/': return {TokenType::SLASH, "/", line};
            case '&': return {TokenType::AMPERSAND, "&", line}; // ADDED
            case '.': return {TokenType::DOT, ".", line}; // ADDED
            case '=': 
                if (source[pos] == '=') {
                    pos++;
                    return {TokenType::EQUALS_EQUALS, "==", line};
                }
                return {TokenType::EQUALS, "=", line};
            case '(': return {TokenType::LPAREN, "(", line};
            case ')': return {TokenType::RPAREN, ")", line};
            case '{': return {TokenType::LBRACE, "{", line};
            case '}': return {TokenType::RBRACE, "}", line};
            case '[': return {TokenType::LBRACKET, "[", line}; // ADDED
            case ']': return {TokenType::RBRACKET, "]", line}; // ADDED
            case ':': return {TokenType::COLON, ":", line};
            case ';': return {TokenType::SEMICOLON, ";", line};
            case ',': return {TokenType::COMMA, ",", line};
            default: return {TokenType::UNKNOWN, std::string(1, current), line};
        }
    }
};
