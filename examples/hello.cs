// CSharp_KitchenSink_Demo.cs
// A single-file, comprehensive demonstration of C# language features and common .NET APIs.
// This file is intentionally broad rather than deep—use it as a reference or playground.

#nullable enable
using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

// -----------------------------
// Namespaces
// -----------------------------
namespace KitchenSink
{
    // -----------------------------
    // Enums (regular, flags)
    // -----------------------------
    public enum Color { Red, Green, Blue }

    [Flags]
    public enum FileAccessMode
    {
        None = 0,
        Read = 1,
        Write = 2,
        Execute = 4,
        ReadWrite = Read | Write
    }

    // -----------------------------
    // Records (immutability by default)
    // -----------------------------
    public record Person(string Name, int Age);

    // -----------------------------
    // Structs (value types)
    // -----------------------------
    public readonly struct Point
    {
        public int X { get; }
        public int Y { get; }
        public Point(int x, int y) => (X, Y) = (x, y);
        public override string ToString() => $"({X},{Y})";
    }

    // -----------------------------
    // Interfaces
    // -----------------------------
    public interface IRepository<T>
    {
        void Add(T item);
        IEnumerable<T> All();
    }

    // -----------------------------
    // Abstract classes
    // -----------------------------
    public abstract class Animal
    {
        public abstract string Speak();
        public virtual int Legs => 4;
    }

    // -----------------------------
    // Classes (inheritance, properties, constructors)
    // -----------------------------
    public class Dog : Animal
    {
        public string Name { get; init; }
        public Dog(string name) => Name = name;
        public override string Speak() => "Woof";
    }

    // -----------------------------
    // Generics
    // -----------------------------
    public class MemoryRepository<T> : IRepository<T>
    {
        private readonly List<T> _items = new();
        public void Add(T item) => _items.Add(item);
        public IEnumerable<T> All() => _items;
    }

    // -----------------------------
    // Delegates, events
    // -----------------------------
    public delegate int MathOp(int a, int b);

    public class Ticker
    {
        public event EventHandler<int>? Tick;
        public void Run(int count)
        {
            for (int i = 1; i <= count; i++)
            {
                Tick?.Invoke(this, i);
            }
        }
    }

    // -----------------------------
    // Attributes
    // -----------------------------
    [AttributeUsage(AttributeTargets.Method)]
    public sealed class DemoAttribute : Attribute
    {
        public string Note { get; }
        public DemoAttribute(string note) => Note = note;
    }

    // -----------------------------
    // Extension methods
    // -----------------------------
    public static class Extensions
    {
        public static bool IsEven(this int n) => n % 2 == 0;
        public static string Repeat(this string s, int times)
            => string.Concat(Enumerable.Repeat(s, times));
    }

    // -----------------------------
    // Pattern matching targets
    // -----------------------------
    public sealed class Circle { public double Radius { get; init; } }
    public sealed class Rectangle { public double W { get; init; } public double H { get; init; } }

    // -----------------------------
    // Disposables (IDisposable / using)
    // -----------------------------
    public sealed class TempFile : IDisposable
    {
        public string Path { get; }
        public TempFile()
        {
            Path = System.IO.Path.GetTempFileName();
            File.WriteAllText(Path, "temp");
        }
        public void Dispose()
        {
            try { if (File.Exists(Path)) File.Delete(Path); }
            catch { /* swallow for demo */ }
        }
    }

    // -----------------------------
    // Async streams
    // -----------------------------
    public static class AsyncGenerators
    {
        public static async IAsyncEnumerable<int> CountAsync(int n, [EnumeratorCancellation] CancellationToken ct = default)
        {
            for (int i = 1; i <= n; i++)
            {
                ct.ThrowIfCancellationRequested();
                await Task.Delay(10, ct);
                yield return i;
            }
        }
    }

    // -----------------------------
    // Main program
    // -----------------------------
    public static class Program
    {
        // Local functions
        static int Add(int a, int b) => a + b;

        // Expression-bodied members
        static double Area(object shape) => shape switch
        {
            Circle c => Math.PI * c.Radius * c.Radius,
            Rectangle r => r.W * r.H,
            _ => throw new ArgumentException("Unknown shape")
        };

        [Demo("Entry point demonstrating language features")]
        public static async Task Main(string[] args)
        {
            // Variables, var, tuples
            var tuple = (Answer: 42, Text: "Hello");
            Console.WriteLine($"Tuple: {tuple.Answer}, {tuple.Text}");

            // Enums
            Color color = Color.Green;
            FileAccessMode fam = FileAccessMode.Read | FileAccessMode.Write;
            Console.WriteLine($"Enum: {color}, Flags: {fam}");

            // Records
            Person p = new("Ada", 36);
            Person p2 = p with { Age = 37 };
            Console.WriteLine($"Record: {p} -> {p2}");

            // Structs
            var pt = new Point(3, 4);
            Console.WriteLine($"Struct: {pt}");

            // Inheritance / polymorphism
            Animal a = new Dog("Rex");
            Console.WriteLine($"Animal says {a.Speak()} with {a.Legs} legs");

            // Generics / collections / LINQ
            IRepository<int> repo = new MemoryRepository<int>();
            repo.Add(1); repo.Add(2); repo.Add(3);
            var evens = repo.All().Where(x => x.IsEven()).Select(x => x * 10).ToList();
            Console.WriteLine($"LINQ: {string.Join(',', evens)}");

            // Delegates / lambdas
            MathOp mul = (x, y) => x * y;
            Console.WriteLine($"Delegate: {mul(3, 5)}");

            // Events
            var ticker = new Ticker();
            ticker.Tick += (_, i) => Console.Write(i + " ");
            ticker.Run(5);
            Console.WriteLine();

            // Pattern matching
            Console.WriteLine($"Area(circle): {Area(new Circle { Radius = 2 })}");

            // Nullable reference types
            string? maybe = args.FirstOrDefault();
            Console.WriteLine(maybe ?? "<no-args>");

            // Exceptions
            try
            {
                _ = Area(123);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Caught: {ex.Message}");
            }
            finally
            {
                // cleanup
            }

            // using / IDisposable
            using (var tf = new TempFile())
            {
                Console.WriteLine($"Temp file exists: {File.Exists(tf.Path)}");
            }

            // Async / await
            using var cts = new CancellationTokenSource();
            await foreach (var i in AsyncGenerators.CountAsync(3, cts.Token))
            {
                Console.WriteLine($"Async stream: {i}");
            }

            // Tasks / parallelism
            var results = await Task.WhenAll(
                Task.Run(() => Add(1, 2)),
                Task.Run(() => mul(2, 3))
            );
            Console.WriteLine($"Tasks: {string.Join(',', results)}");

            // Threading primitives
            var bag = new ConcurrentBag<int>();
            Parallel.For(0, 5, i => bag.Add(i));
            Console.WriteLine($"ConcurrentBag count: {bag.Count}");

            // Channels
            var channel = Channel.CreateUnbounded<int>();
            _ = Task.Run(async () =>
            {
                for (int i = 0; i < 3; i++) await channel.Writer.WriteAsync(i);
                channel.Writer.Complete();
            });
            await foreach (var i in channel.Reader.ReadAllAsync())
                Console.WriteLine($"Channel: {i}");

            // IO / JSON / Regex
            var json = JsonSerializer.Serialize(p2);
            Console.WriteLine($"JSON: {json}");
            Console.WriteLine(Regex.IsMatch("abc123", "^[a-z]+\\d+$"));

            // Culture / formatting
            Console.WriteLine(DateTime.Now.ToString("D", CultureInfo.InvariantCulture));

            // HTTP (basic)
            using var http = new HttpClient();
            http.DefaultRequestHeaders.UserAgent.ParseAdd("KitchenSink/1.0");
            // Note: Not sending a request to avoid external dependency in demo

            // Diagnostics
            Debug.WriteLine("Debug message");
            Console.WriteLine("Done.");
        }
    }
}
