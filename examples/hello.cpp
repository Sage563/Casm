// CPP_KitchenSink_Demo.cpp
// Comprehensive C++ (C++20) kitchen-sink demonstration file
// Focus: language features, STL, OOP, templates, RAII, concurrency, modern idioms

#include <iostream>
#include <vector>
#include <array>
#include <map>
#include <unordered_map>
#include <set>
#include <string>
#include <memory>
#include <optional>
#include <variant>
#include <tuple>
#include <algorithm>
#include <numeric>
#include <functional>
#include <thread>
#include <mutex>
#include <atomic>
#include <future>
#include <chrono>
#include <filesystem>
#include <regex>
#include <fstream>

using namespace std;

// ----------------------------
// Enums
// ----------------------------
enum class Color { Red, Green, Blue };

enum Permission
{
    Read = 1 << 0,
    Write = 1 << 1,
    Execute = 1 << 2
};

// ----------------------------
// Structs / POD
// ----------------------------
struct Point
{
    int x{}, y{};
};

// ----------------------------
// Classes / OOP
// ----------------------------
class Animal
{
public:
    virtual ~Animal() = default;
    virtual string speak() const = 0;
};

class Dog : public Animal
{
    string name;
public:
    explicit Dog(string n) : name(move(n)) {}
    string speak() const override { return "Woof"; }
};

// ----------------------------
// Templates
// ----------------------------
template<typename T>
class Box
{
    T value;
public:
    explicit Box(T v) : value(move(v)) {}
    const T& get() const { return value; }
};

// ----------------------------
// RAII
// ----------------------------
class FileRAII
{
    ofstream file;
public:
    explicit FileRAII(const string& path)
    {
        file.open(path);
        file << "RAII example";
    }
    ~FileRAII()
    {
        if (file.is_open()) file.close();
    }
};

// ----------------------------
// Lambdas / std::function
// ----------------------------
int apply(int a, int b, function<int(int,int)> fn)
{
    return fn(a, b);
}

// ----------------------------
// Main
// ----------------------------
int main()
{
    // Variables & auto
    auto x = 42;

    // Enum usage
    Color c = Color::Green;
    int perms = Read | Write;

    // Struct
    Point p{3,4};

    // Polymorphism
    unique_ptr<Animal> a = make_unique<Dog>("Rex");
    cout << a->speak() << '\n';

    // Templates
    Box<int> b(10);
    cout << b.get() << '\n';

    // STL containers
    vector<int> v{1,2,3,4};
    ranges::for_each(v, [](int i){ cout << i << " "; });
    cout << '\n';

    // Algorithms
    int sum = accumulate(v.begin(), v.end(), 0);
    cout << "Sum: " << sum << '\n';

    // Optional / Variant
    optional<int> oi = 5;
    variant<int,string> var = "hello";

    // Tuple / structured binding
    auto tup = make_tuple(1,2.5,"hi");
    auto [i,d,s] = tup;

    // Regex
    regex r("[a-z]+\\d+");
    cout << regex_match("abc123", r) << '\n';

    // Filesystem
    cout << filesystem::current_path() << '\n';

    // RAII
    FileRAII f("demo.txt");

    // Threads
    atomic<int> counter{0};
    thread t([&]{ counter++; });
    t.join();

    // Async
    auto fut = async(launch::async, []{ return 7 * 6; });
    cout << fut.get() << '\n';

    // Lambda + function
    cout << apply(3,4, [](int a,int b){ return a*b; }) << '\n';

    cout << "Done C++" << '\n';
    return 0;
}
