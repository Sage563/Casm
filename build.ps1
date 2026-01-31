# Build Soul compiler (soulc) on Windows (PowerShell)
# Requires: g++ (MinGW) or cl (MSVC) in PATH

$Src = "src\compiler\main.cpp"
$Out = "soulc.exe"

if (Get-Command g++ -ErrorAction SilentlyContinue) {
    Write-Host "Building with g++..."
    & g++ -std=c++17 -O2 -o $Out $Src
    if ($LASTEXITCODE -eq 0) { Write-Host "Built: $Out" }
    exit $LASTEXITCODE
}

if (Get-Command cl -ErrorAction SilentlyContinue) {
    Write-Host "Building with MSVC cl..."
    & cl /std:c++17 /EHsc /O2 /Fe:$Out $Src
    if ($LASTEXITCODE -eq 0) { Write-Host "Built: $Out" }
    exit $LASTEXITCODE
}

Write-Host "No C++ compiler found. Install MinGW (g++) or Visual Studio (cl)."
Write-Host "  MinGW: https://www.mingw-w64.org/"
exit 1
