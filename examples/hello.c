// C_KitchenSink_Demo.c
// Comprehensive C (C17) kitchen-sink demonstration file
// Focus: core language, pointers, memory, structs, macros, POSIX-style patterns

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>
#include <time.h>
#include <assert.h>

// ----------------------------
// Macros
// ----------------------------
#define MAX(a,b) ((a) > (b) ? (a) : (b))
#define ARRAY_LEN(x) (sizeof(x)/sizeof((x)[0]))

// ----------------------------
// Enums
// ----------------------------
typedef enum
{
    COLOR_RED,
    COLOR_GREEN,
    COLOR_BLUE
} Color;

// ----------------------------
// Structs / Unions
// ----------------------------
typedef struct
{
    int x;
    int y;
} Point;

typedef union
{
    int i;
    float f;
} IntFloat;

// ----------------------------
// Function pointers
// ----------------------------
typedef int (*math_fn)(int,int);

int add(int a, int b) { return a + b; }
int mul(int a, int b) { return a * b; }

int apply(int a, int b, math_fn fn)
{
    return fn(a, b);
}

// ----------------------------
// Dynamic memory
// ----------------------------
char* duplicate(const char* s)
{
    size_t len = strlen(s) + 1;
    char* out = malloc(len);
    if (!out) return NULL;
    memcpy(out, s, len);
    return out;
}

// ----------------------------
// Static / global
// ----------------------------
static int global_counter = 0;

// ----------------------------
// Main
// ----------------------------
int main(void)
{
    // Variables & types
    int a = 5;
    double d = 3.14;
    bool ok = true;

    // Enum
    Color c = COLOR_GREEN;

    // Struct
    Point p = {3,4};
    printf("Point: %d %d\n", p.x, p.y);

    // Union
    IntFloat u;
    u.i = 42;
    printf("Union int: %d\n", u.i);

    // Arrays
    int arr[] = {1,2,3,4};
    for (size_t i = 0; i < ARRAY_LEN(arr); i++)
        printf("%d ", arr[i]);
    printf("\n");

    // Pointers
    int* pa = &a;
    *pa = 10;

    // Function pointers
    printf("Add: %d\n", apply(2,3,add));
    printf("Mul: %d\n", apply(2,3,mul));

    // Dynamic memory
    char* copy = duplicate("hello");
    if (copy)
    {
        printf("Copy: %s\n", copy);
        free(copy);
    }

    // File IO
    FILE* f = fopen("demo_c.txt", "w");
    if (f)
    {
        fprintf(f, "C file IO\n");
        fclose(f);
    }

    // Time
    time_t now = time(NULL);
    printf("Time: %s", ctime(&now));

    // Assertions
    assert(MAX(2,3) == 3);

    // Static / global
    global_counter++;
    printf("Global: %d\n", global_counter);

    printf("Done C\n");
    return 0;
}
