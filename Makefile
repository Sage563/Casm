# Soul Polyglot — build compiler (soulc)
# Requires: C++17 compiler (g++, clang++, or cl)

CXX ?= g++
CXXFLAGS = -std=c++17 -O2 -Wall
SRC = src/compiler
OUT = soulc

# Default: build compiler binary in project root
all: $(OUT)

$(OUT): $(SRC)/main.cpp $(SRC)/lexer.hpp
	$(CXX) $(CXXFLAGS) -static -o $(OUT) $(SRC)/main.cpp

# Build into src/compiler/ (e.g. for local testing)
compiler: $(SRC)/main.cpp $(SRC)/lexer.hpp
	$(CXX) $(CXXFLAGS) -static -o $(SRC)/soulc $(SRC)/main.cpp

clean:
	rm -f $(OUT) $(SRC)/soulc
	@echo "Cleaned."

# Quick test: compile examples/hello (if .soul exists) and run
test: all
	@if [ -f examples/hello.soul ]; then ./$(OUT) examples/hello.soul hello.casm && node src/runtime/runtime.js hello.casm; else echo "No examples/hello.soul — create a .soul file to test."; fi

.PHONY: all compiler clean test
