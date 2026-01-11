; Script generated for Combine+
; FIXED and TESTED

#define MyAppName "Combine+"
#define MyAppPublisher "KG"
#define MyAppExeName "Combine+.exe"

; --- VERSION HANDLING ---
; Accept version from build script via command line argument: iscc /DMyAppVersion="x.y.z" setup.iss
#ifndef MyAppVersion
  #define PkgJsonPath "..\package.json"
  #define PkgJsonContent LoadFileSource(PkgJsonPath)
  #define VerKey '"version": "'
  #define VerKeyPos Pos(VerKey, PkgJsonContent)
  #define VerStart VerKeyPos + Len(VerKey)
  #define RemainingContent Copy(PkgJsonContent, VerStart)
  #define VerEnd Pos('"', RemainingContent)
  #define MyAppVersion Copy(RemainingContent, 1, VerEnd - 1)
#endif

[Setup]
AppId={{A1B2C3D4-E5F6-7890-1234-56789ABCDEF0}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DisableProgramGroupPage=yes

; --- Icon for Add/Remove Programs ---
UninstallDisplayIcon={app}\{#MyAppExeName}

; Request admin privileges (Required for HKCR registry writes)
PrivilegesRequired=admin 
OutputBaseFilename=Combine+ Setup-{#MyAppVersion}
OutputDir=..\dist
SetupIconFile=..\icon.ico
Compression=lzma
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64
ChangesAssociations=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "contextmenu"; Description: "Add 'Merge with Combine+' to right-click menu"; GroupDescription: "Context Menu:"

[Files]
Source: "..\dist\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Registry]
; --- Context Menu for specific file types ---
; Loops (#for) are not supported in standard ISPP. 
; The entries below are unrolled manually for pdf, jpg, jpeg, png, webp.

; 1. PDF
Root: HKCR; Subkey: "SystemFileAssociations\.pdf\shell\CombinePlus"; ValueType: string; ValueName: ""; ValueData: "Merge with Combine+"; Flags: uninsdeletekey; Tasks: contextmenu
Root: HKCR; Subkey: "SystemFileAssociations\.pdf\shell\CombinePlus"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#MyAppExeName},0"; Tasks: contextmenu
Root: HKCR; Subkey: "SystemFileAssociations\.pdf\shell\CombinePlus\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Tasks: contextmenu

; 2. JPG
Root: HKCR; Subkey: "SystemFileAssociations\.jpg\shell\CombinePlus"; ValueType: string; ValueName: ""; ValueData: "Merge with Combine+"; Flags: uninsdeletekey; Tasks: contextmenu
Root: HKCR; Subkey: "SystemFileAssociations\.jpg\shell\CombinePlus"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#MyAppExeName},0"; Tasks: contextmenu
Root: HKCR; Subkey: "SystemFileAssociations\.jpg\shell\CombinePlus\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Tasks: contextmenu

; 3. JPEG
Root: HKCR; Subkey: "SystemFileAssociations\.jpeg\shell\CombinePlus"; ValueType: string; ValueName: ""; ValueData: "Merge with Combine+"; Flags: uninsdeletekey; Tasks: contextmenu
Root: HKCR; Subkey: "SystemFileAssociations\.jpeg\shell\CombinePlus"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#MyAppExeName},0"; Tasks: contextmenu
Root: HKCR; Subkey: "SystemFileAssociations\.jpeg\shell\CombinePlus\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Tasks: contextmenu

; 4. PNG
Root: HKCR; Subkey: "SystemFileAssociations\.png\shell\CombinePlus"; ValueType: string; ValueName: ""; ValueData: "Merge with Combine+"; Flags: uninsdeletekey; Tasks: contextmenu
Root: HKCR; Subkey: "SystemFileAssociations\.png\shell\CombinePlus"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#MyAppExeName},0"; Tasks: contextmenu
Root: HKCR; Subkey: "SystemFileAssociations\.png\shell\CombinePlus\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Tasks: contextmenu

; 5. WEBP
Root: HKCR; Subkey: "SystemFileAssociations\.webp\shell\CombinePlus"; ValueType: string; ValueName: ""; ValueData: "Merge with Combine+"; Flags: uninsdeletekey; Tasks: contextmenu
Root: HKCR; Subkey: "SystemFileAssociations\.webp\shell\CombinePlus"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#MyAppExeName},0"; Tasks: contextmenu
Root: HKCR; Subkey: "SystemFileAssociations\.webp\shell\CombinePlus\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Tasks: contextmenu

; 6. AVIF
Root: HKCR; Subkey: "SystemFileAssociations\.avif\shell\CombinePlus"; ValueType: string; ValueName: ""; ValueData: "Merge with Combine+"; Flags: uninsdeletekey; Tasks: contextmenu
Root: HKCR; Subkey: "SystemFileAssociations\.avif\shell\CombinePlus"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#MyAppExeName},0"; Tasks: contextmenu
Root: HKCR; Subkey: "SystemFileAssociations\.avif\shell\CombinePlus\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Tasks: contextmenu

; 7. BMP
Root: HKCR; Subkey: "SystemFileAssociations\.bmp\shell\CombinePlus"; ValueType: string; ValueName: ""; ValueData: "Merge with Combine+"; Flags: uninsdeletekey; Tasks: contextmenu
Root: HKCR; Subkey: "SystemFileAssociations\.bmp\shell\CombinePlus"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#MyAppExeName},0"; Tasks: contextmenu
Root: HKCR; Subkey: "SystemFileAssociations\.bmp\shell\CombinePlus\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Tasks: contextmenu

; 8. GIF
Root: HKCR; Subkey: "SystemFileAssociations\.gif\shell\CombinePlus"; ValueType: string; ValueName: ""; ValueData: "Merge with Combine+"; Flags: uninsdeletekey; Tasks: contextmenu
Root: HKCR; Subkey: "SystemFileAssociations\.gif\shell\CombinePlus"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#MyAppExeName},0"; Tasks: contextmenu
Root: HKCR; Subkey: "SystemFileAssociations\.gif\shell\CombinePlus\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Tasks: contextmenu

; 9. SVG
Root: HKCR; Subkey: "SystemFileAssociations\.svg\shell\CombinePlus"; ValueType: string; ValueName: ""; ValueData: "Merge with Combine+"; Flags: uninsdeletekey; Tasks: contextmenu
Root: HKCR; Subkey: "SystemFileAssociations\.svg\shell\CombinePlus"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#MyAppExeName},0"; Tasks: contextmenu
Root: HKCR; Subkey: "SystemFileAssociations\.svg\shell\CombinePlus\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Tasks: contextmenu

; 10. TIF
Root: HKCR; Subkey: "SystemFileAssociations\.tif\shell\CombinePlus"; ValueType: string; ValueName: ""; ValueData: "Merge with Combine+"; Flags: uninsdeletekey; Tasks: contextmenu
Root: HKCR; Subkey: "SystemFileAssociations\.tif\shell\CombinePlus"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#MyAppExeName},0"; Tasks: contextmenu
Root: HKCR; Subkey: "SystemFileAssociations\.tif\shell\CombinePlus\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Tasks: contextmenu

; 11. TIFF
Root: HKCR; Subkey: "SystemFileAssociations\.tiff\shell\CombinePlus"; ValueType: string; ValueName: ""; ValueData: "Merge with Combine+"; Flags: uninsdeletekey; Tasks: contextmenu
Root: HKCR; Subkey: "SystemFileAssociations\.tiff\shell\CombinePlus"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#MyAppExeName},0"; Tasks: contextmenu
Root: HKCR; Subkey: "SystemFileAssociations\.tiff\shell\CombinePlus\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Tasks: contextmenu

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Clean up application directory and user data
Type: filesandordirs; Name: "{app}"
Type: filesandordirs; Name: "{userappdata}\{#MyAppName}"
Type: filesandordirs; Name: "{localappdata}\{#MyAppName}"

; NOTE: You do NOT need to delete Registry keys here. 
; Inno Setup automatically removes any registry keys it created in the [Registry] section.