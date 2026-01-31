@echo off
REM Build Soul compiler (soulc) on Windows
REM Requires: g++ (MinGW) or cl (MSVC) in PATH

set SRC=src\compiler\main.cpp
set LEX=src\compiler\lexer.hpp
set OUT=soulc.exe

where g++ >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo Building with g++...
    g++ -std=c++17 -O2 -o %OUT% %SRC%
    if %ERRORLEVEL% equ 0 echo Built: %OUT%
    exit /b %ERRORLEVEL%
)

where cl >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo Building with MSVC cl...
    cl /std:c++17 /EHsc /O2 /Fe:%OUT% %SRC%
    if %ERRORLEVEL% equ 0 echo Built: %OUT%
    exit /b %ERRORLEVEL%
)

echo No C++ compiler found. Install MinGW (g++) or Visual Studio (cl).
echo   MinGW: https://www.mingw-w64.org/
echo   Or: winget install -e --id GnuWin32.Make
exit /b 1
