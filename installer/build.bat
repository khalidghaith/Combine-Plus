@echo off
:: Switch to the project root directory (parent of the installer folder)
pushd "%~dp0.."

set VERSION=1.4.0
echo ========================================
echo Building Combine+ v%VERSION% (Offline Edition)
echo ========================================

:: 1. Compile Python Engine to Standalone EXE
echo [1/3] Compiling Python Engine...
:: Ensure pypdf is installed for the build process
pip install pyinstaller pypdf --disable-pip-version-check
if %errorlevel% neq 0 goto :error

pyinstaller --onefile --noconsole --icon=icon.ico --name merge_engine --workpath py-build --distpath py-dist merge_engine.py
if %errorlevel% neq 0 goto :error

:: 2. Setup Binary Folder for Electron Builder
echo [2/3] Organizing binaries...
if not exist "bin" mkdir bin
move /Y py-dist\merge_engine.exe bin\merge_engine.exe
if %errorlevel% neq 0 goto :error

:: Cleanup PyInstaller mess
if exist py-build rd /S /Q py-build
if exist py-dist rd /S /Q py-dist
if exist merge_engine.spec del /Q merge_engine.spec

:: 3. Build Electron Distribution
echo [3/3] Packaging Electron App...
if exist dist rd /S /Q dist
call npm run dist
if %errorlevel% neq 0 goto :error

:: 4. Generate Checksums
echo [4/4] Generating Checksums...
powershell -NoProfile -Command "Get-ChildItem dist\*.exe | ForEach-Object { (Get-FileHash -Algorithm SHA256 -Path $_.FullName).Hash.ToLower() + '  ' + $_.Name } | Out-File -Encoding ASCII dist\SHA256SUMS.txt"

echo ========================================
echo Build Finished! Check dist/ for output.
echo ========================================
popd
pause
exit /b 0

:error
echo.
echo ========================================
echo BUILD FAILED!
echo ========================================
popd
pause
exit /b 1