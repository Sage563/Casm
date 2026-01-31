#include <iostream>
#include <string>

int main() {
    // 1. C++23 Alternative Operators
    if (true and true) {
        std::cout << "C++23 'and' works!\n";
    }
    if (false or true) {
        std::cout << "C++23 'or' works!\n";
    }
    if (not false) {
        std::cout << "C++23 'not' works!\n";
    }

    // 2. Python-style Features (if using .py or explicit mode, but we test here)
    int x = 10;
    if (x == 10) {
        std::cout << "Comparison == works!\n";
    }

    // 3. f-strings (Python 3.12 style)
    // Note: Our lexer expands these into concatenations
    std::string name = "SoulC";
    std::string msg = f"Hello {name}!";
    std::cout << msg << "\n";

    // 4. Walrus Operator (Python)
    // if ((val := 42) > 40) { ... }
    // Our compiler needs to handle this in parseExpression

    std::cout << "Tests completed successfully.\n";
    return 0;
}
