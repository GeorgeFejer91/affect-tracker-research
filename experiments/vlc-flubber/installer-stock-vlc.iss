#define ProductName "VLC with Flubber"
#define ProductVersion "0.3.0"

[Setup]
AppId={{C4F5585E-B88F-43B0-A1DB-F7E4C16D9390}
AppName={#ProductName}
AppVersion={#ProductVersion}
AppPublisher=George Fejer
DefaultDirName={localappdata}\Programs\VLCWithFlubber
DefaultGroupName=VLC with Flubber
OutputDir=build\stock-vlc-package\out
OutputBaseFilename=VLC_with_Flubber_Setup_0.3.0_x64
Compression=zip/1
SolidCompression=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
LicenseFile=..\..\LICENSE
UninstallDisplayIcon={app}\vlc.exe

[Files]
Source: "build\stock-vlc-package\stage\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\VLC with Flubber"; Filename: "{app}\vlc.exe"; WorkingDir: "{app}"
Name: "{userdesktop}\VLC with Flubber"; Filename: "{app}\vlc.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut for video drag-and-drop"; GroupDescription: "Additional shortcuts:"

[Run]
Filename: "{app}\vlc.exe"; Description: "Open VLC with Flubber"; Flags: nowait postinstall skipifsilent
