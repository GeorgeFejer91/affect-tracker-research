#define ProductName "Flubbercorder"
#define ProductVersion "0.1.1"

[Setup]
AppId={{BC3E7064-C346-43F4-8A68-66D8BC995670}
AppName={#ProductName}
AppVersion={#ProductVersion}
AppPublisher=George Fejer
DefaultDirName={localappdata}\Programs\Flubbercorder
DefaultGroupName=Flubbercorder
OutputDir=build\tauri-package\out
OutputBaseFilename=Flubbercorder_Setup_0.1.1_x64
Compression=zip/1
SolidCompression=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
LicenseFile=..\..\LICENSE
UninstallDisplayName=Flubbercorder (VLC experiment runner)

[Files]
Source: "flubbercorder-tauri\src-tauri\target\release\flubbercorder-tauri.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "flubbercorder-tauri\src-tauri\resources\*"; DestDir: "{app}\resources"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\Flubbercorder"; Filename: "{app}\flubbercorder-tauri.exe"; WorkingDir: "{app}"
Name: "{userdesktop}\Flubbercorder"; Filename: "{app}\flubbercorder-tauri.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Run]
Filename: "{app}\flubbercorder-tauri.exe"; Description: "Open Flubbercorder"; Flags: nowait postinstall skipifsilent
